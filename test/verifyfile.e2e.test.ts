import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { TempCluster } from "../src/localcluster.js";
import { discoverBinaryDirs } from "../src/pgbin.js";
import { runFileVerify } from "../src/verifyfile.js";

let workdir: string;
let dumpFile: string;

before(async () => {
  const bins = discoverBinaryDirs();
  workdir = mkdtempSync(join(tmpdir(), "pgproof-vf-"));
  const src = await TempCluster.create({ binDir: bins[bins.length - 1].dir, dataRoot: workdir });
  await src.createDb("arch");
  await src.psql("arch", `
    CREATE TABLE clients (id serial PRIMARY KEY, name text NOT NULL);
    INSERT INTO clients (name) SELECT 'c' || g FROM generate_series(1, 77) g;
  `);
  dumpFile = join(workdir, "archive.dump");
  execFileSync(join(bins[bins.length - 1].dir, "pg_dump"), ["-Fc", "--no-owner", "-f", dumpFile, src.urlFor("arch")]);
  await src.destroy(); // la base source n'existe plus : c'est une ARCHIVE
});

after(() => rmSync(workdir, { recursive: true, force: true }));

test("verifies an archived dump with no live source: restore + constraints + probes + manifest of the dump", async () => {
  const r = await runFileVerify({ file: dumpFile, workdir, probes: ["SELECT count(*) = 77 FROM clients"] });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.manifest.tables.find((t) => t.name === "clients")?.rows, 77);
  assert.ok(r.sha256.length === 64);
  assert.ok(r.info.dbname === "arch");
});

test("a truncated archive fails with a clear problem", async () => {
  const full = readFileSync(dumpFile);
  const bad = join(workdir, "trunc.dump");
  writeFileSync(bad, full.subarray(0, Math.floor(full.length / 3)));
  const r = await runFileVerify({ file: bad, workdir, probes: [] });
  assert.equal(r.ok, false);
  assert.ok(r.problems.length > 0);
});

test("a failing probe fails the verify", async () => {
  const r = await runFileVerify({ file: dumpFile, workdir, probes: ["SELECT count(*) > 1000 FROM clients"] });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("probe")));
});
