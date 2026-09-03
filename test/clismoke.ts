// Smoke test of the BUILT CLI against a throwaway source cluster.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TempCluster } from "../src/localcluster.js";
import { discoverBinaryDirs } from "../src/pgbin.js";

const bins = discoverBinaryDirs();
const workdir = mkdtempSync(join(tmpdir(), "pgproof-smoke-"));
const source = await TempCluster.create({ binDir: bins[bins.length - 1].dir, dataRoot: workdir });
await source.createDb("demo");
await source.psql("demo", `
  CREATE TABLE invoices (id serial PRIMARY KEY, amount numeric NOT NULL);
  INSERT INTO invoices (amount) SELECT g * 10 FROM generate_series(1, 42) g;
`);

try {
  const out = execFileSync("node", [
    "dist/cli.js", "drill", source.urlFor("demo"),
    "--probe", "SELECT count(*) = 42 FROM invoices",
  ], { encoding: "utf8" });
  console.log(out);
  if (!out.includes("DRILL PASSED")) throw new Error("expected DRILL PASSED");
  console.log("CLI SMOKE OK");
} finally {
  await source.destroy();
  rmSync(workdir, { recursive: true, force: true });
}
