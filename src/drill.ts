import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { captureManifest, invalidConstraints, runProbe } from "./connect.js";
import { compareManifests, type Manifest } from "./manifest.js";
import { discoverBinaryDirs, majorFromVersionString, pickBinaryDir } from "./pgbin.js";
import { TempCluster } from "./localcluster.js";

const run = promisify(execFile);

export interface DrillOptions {
  url: string;
  workdir: string;
  /** Reuse an existing dump instead of dumping (verify an old backup). */
  dumpFile?: string;
  probes: string[];
  keepDump?: boolean;
}

export interface DrillResult {
  ok: boolean;
  problems: string[];
  manifest: Manifest;
  sha256: string;
  dumpFile: string;
  binaries: { dir: string; major: number; exact: boolean };
  durations: { dumpMs: number; restoreMs: number; verifyMs: number };
}

export async function runDrill(opts: DrillOptions): Promise<DrillResult> {
  const problems: string[] = [];
  const durations = { dumpMs: 0, restoreMs: 0, verifyMs: 0 };

  // 0. Manifest of the source, and binary selection matched to its version.
  const manifest = await captureManifest(opts.url);
  const sourceMajor = majorFromVersionString(manifest.serverVersion);
  const bins = discoverBinaryDirs();
  const pick = pickBinaryDir(sourceMajor, bins);
  if (!pick) {
    throw new Error(
      `no local Postgres binaries >= ${sourceMajor} found ` +
      `(available: ${bins.map((b) => b.major).join(", ") || "none"}). ` +
      `Install matching tools or set PGPROOF_PG_BIN.`,
    );
  }

  // 1. Dump (unless verifying an existing file).
  let dumpFile = opts.dumpFile;
  if (!dumpFile) {
    dumpFile = join(opts.workdir, `pgproof-${Date.now()}.dump`);
    const t0 = Date.now();
    await run(join(pick.dir, "pg_dump"), ["-Fc", "--no-owner", "-f", dumpFile, opts.url]);
    durations.dumpMs = Date.now() - t0;
  }

  // 2. Checksum.
  const sha256 = createHash("sha256").update(readFileSync(dumpFile)).digest("hex");

  // 3. Restore into a throwaway cluster.
  const t1 = Date.now();
  const drill = await TempCluster.create({ binDir: pick.dir, dataRoot: opts.workdir });
  try {
    await drill.createDb("drill");
    const drillUrl = drill.urlFor("drill");
    try {
      await run(join(pick.dir, "pg_restore"), [
        "--no-owner", "--no-privileges", "--exit-on-error",
        "-h", "127.0.0.1", "-p", String(drill.port), "-U", drill.user,
        "-d", "drill", dumpFile,
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n").slice(0, 3).join(" ") : String(e);
      problems.push(`restore failed: ${msg}`);
    }
    durations.restoreMs = Date.now() - t1;

    // 4. Verify, only meaningful if restore did not hard-fail.
    const t2 = Date.now();
    if (problems.length === 0) {
      const restored = await captureManifest(drillUrl);
      const cmp = compareManifests(manifest, restored);
      problems.push(...cmp.problems);

      const invalid = await invalidConstraints(drillUrl);
      for (const c of invalid) problems.push(`constraint ${c} is not validated after restore`);

      for (const probe of opts.probes) {
        try {
          const pass = await runProbe(drillUrl, probe);
          if (!pass) problems.push(`probe failed: ${probe}`);
        } catch (e) {
          problems.push(`probe errored: ${probe} (${e instanceof Error ? e.message : e})`);
        }
      }
    }
    durations.verifyMs = Date.now() - t2;
  } finally {
    await drill.destroy();
  }

  return {
    ok: problems.length === 0,
    problems,
    manifest,
    sha256,
    dumpFile,
    binaries: { dir: pick.dir, major: pick.major, exact: pick.exact },
    durations,
  };
}
