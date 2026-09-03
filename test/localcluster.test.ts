import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TempCluster } from "../src/localcluster.js";
import { discoverBinaryDirs } from "../src/pgbin.js";

// macOS caps Unix socket paths at ~104 chars; the cluster must start under a
// deeply nested dataRoot regardless, since every connection is TCP on 127.0.0.1.
test("cluster starts under a dataRoot deeper than the Unix socket path limit", async () => {
  const bins = discoverBinaryDirs();
  assert.ok(bins.length > 0, "needs local Postgres binaries for this test");
  const base = mkdtempSync(join(tmpdir(), "pgproof-longpath-"));
  let deep = base;
  while (deep.length < 110) deep = join(deep, "deeply-nested-dir");
  mkdirSync(deep, { recursive: true });

  let cluster: TempCluster | undefined;
  try {
    cluster = await TempCluster.create({ binDir: bins[bins.length - 1].dir, dataRoot: deep });
    const out = await cluster.psql("postgres", "SELECT 41 + 1");
    assert.match(out, /42/);
  } finally {
    await cluster?.destroy();
    rmSync(base, { recursive: true, force: true });
  }
});
