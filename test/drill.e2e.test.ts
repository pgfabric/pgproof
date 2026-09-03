import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TempCluster } from "../src/localcluster.js";
import { runDrill } from "../src/drill.js";
import { discoverBinaryDirs } from "../src/pgbin.js";

// A real drill against a real (temporary) Postgres, no Docker required.
let source: TempCluster;
let workdir: string;

const SEED_SQL = `
  CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL);
  CREATE TABLE orders (
    id serial PRIMARY KEY,
    user_id int NOT NULL REFERENCES users(id),
    total numeric NOT NULL
  );
  INSERT INTO users (email) SELECT 'u' || g || '@x.dev' FROM generate_series(1, 50) g;
  INSERT INTO orders (user_id, total) SELECT (g % 50) + 1, g * 1.5 FROM generate_series(1, 200) g;
  ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
  CREATE POLICY orders_all ON orders FOR SELECT TO PUBLIC USING (true);
`;

before(async () => {
  const bins = discoverBinaryDirs();
  assert.ok(bins.length > 0, "needs local Postgres binaries for this test");
  workdir = mkdtempSync(join(tmpdir(), "pgproof-e2e-"));
  source = await TempCluster.create({ binDir: bins[bins.length - 1].dir, dataRoot: workdir });
  await source.createDb("app");
  await source.psql("app", SEED_SQL);
});

after(async () => {
  await source?.destroy();
  rmSync(workdir, { recursive: true, force: true });
});

test("drill on a healthy database passes with matching manifest", async () => {
  const result = await runDrill({
    url: source.urlFor("app"),
    workdir,
    probes: ["SELECT count(*) > 0 FROM users"],
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.problems.length, 0);
  assert.equal(result.manifest.tables.length, 2);
  assert.equal(result.manifest.tables.find((t) => t.name === "orders")?.rows, 200);
  assert.ok(result.manifest.rlsPolicies >= 1, "RLS policy must be counted");
  assert.ok(result.sha256.length === 64);
  assert.ok(result.durations.restoreMs > 0);
});

test("a failing probe fails the drill", async () => {
  const result = await runDrill({
    url: source.urlFor("app"),
    workdir,
    probes: ["SELECT count(*) > 999999 FROM users"],
  });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("probe")));
});

test("a truncated dump file fails the drill with a clear problem", async () => {
  const result = await runDrill({ url: source.urlFor("app"), workdir, probes: [] });
  assert.equal(result.ok, true);
  const truncated = join(workdir, "truncated.dump");
  const full = readFileSync(result.dumpFile);
  writeFileSync(truncated, full.subarray(0, Math.floor(full.length / 3)));

  const bad = await runDrill({ url: source.urlFor("app"), workdir, dumpFile: truncated, probes: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.length > 0);
});
