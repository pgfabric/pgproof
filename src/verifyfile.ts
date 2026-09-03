import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { captureManifest, invalidConstraints, runProbe } from "./connect.js";
import type { Manifest } from "./manifest.js";
import { discoverBinaryDirs, pickBinaryDir, envBinDiagnostic, defaultProbeRoots } from "./pgbin.js";
import { readDumpInfo, type DumpInfo } from "./dumpinfo.js";
import { TempCluster } from "./localcluster.js";

const run = promisify(execFile);

export interface FileVerifyOptions {
  file: string;
  workdir: string;
  probes: string[];
}

export interface FileVerifyResult {
  ok: boolean;
  problems: string[];
  /** Manifest OF THE RESTORED DUMP — there is no live source to compare against. */
  manifest: Manifest;
  info: DumpInfo;
  sha256: string;
  binaries: { dir: string; major: number; exact: boolean };
  durations: { restoreMs: number; verifyMs: number };
}

/**
 * Verify an ARCHIVED dump with no live source: restore into a throwaway
 * cluster (--exit-on-error), validate constraints, run probes, and report the
 * manifest of what the dump contains. No count comparison against a live
 * database — for that, use the drill with --file.
 */
export async function runFileVerify(opts: FileVerifyOptions): Promise<FileVerifyResult> {
  const problems: string[] = [];
  const durations = { restoreMs: 0, verifyMs: 0 };

  const sha256 = createHash("sha256").update(readFileSync(opts.file)).digest("hex");

  const bins = discoverBinaryDirs();
  if (bins.length === 0) {
    const envNote = envBinDiagnostic(process.env.PGPROOF_PG_BIN, bins);
    throw new Error(
      (envNote ? envNote + "\n" : "") +
      `no local Postgres tools found. Searched PATH and: ${defaultProbeRoots().join(", ")}.`,
    );
  }

  // Read the archive header with the newest tools (also validates the format);
  // then pick tools matched to the pg_dump that wrote the file.
  const newest = bins[bins.length - 1];
  let info: DumpInfo;
  try {
    info = await readDumpInfo(opts.file, newest.dir);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n").slice(0, 2).join(" ") : String(e);
    return {
      ok: false,
      problems: [`not a readable pg_dump archive: ${msg}`],
      manifest: { serverVersion: "", tables: [], extensions: [], rlsPolicies: 0, sequences: 0 },
      info: { dbname: null, sourceMajor: null, dumpedByMajor: null, createdAt: null },
      sha256,
      binaries: { dir: newest.dir, major: newest.major, exact: false },
      durations,
    };
  }
  const wanted = info.dumpedByMajor ?? info.sourceMajor ?? newest.major;
  const pick = pickBinaryDir(wanted, bins) ?? { ...newest, exact: false };

  const t0 = Date.now();
  const drill = await TempCluster.create({ binDir: pick.dir, dataRoot: opts.workdir });
  let manifest: Manifest = { serverVersion: "", tables: [], extensions: [], rlsPolicies: 0, sequences: 0 };
  try {
    await drill.createDb("verify");
    const url = drill.urlFor("verify");
    try {
      await run(join(pick.dir, "pg_restore"), [
        "--no-owner", "--no-privileges", "--exit-on-error",
        "-h", "127.0.0.1", "-p", String(drill.port), "-U", drill.user,
        "-d", "verify", opts.file,
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n").slice(0, 3).join(" ") : String(e);
      problems.push(`restore failed: ${msg}`);
    }
    durations.restoreMs = Date.now() - t0;

    const t1 = Date.now();
    if (problems.length === 0) {
      manifest = await captureManifest(url);
      if (manifest.tables.length === 0) problems.push("restored database contains no tables");

      const invalid = await invalidConstraints(url);
      for (const c of invalid) problems.push(`constraint ${c} is not validated after restore`);

      for (const probe of opts.probes) {
        try {
          const pass = await runProbe(url, probe);
          if (!pass) problems.push(`probe failed: ${probe}`);
        } catch (e) {
          problems.push(`probe errored: ${probe} (${e instanceof Error ? e.message : e})`);
        }
      }
    }
    durations.verifyMs = Date.now() - t1;
  } finally {
    await drill.destroy();
  }

  return {
    ok: problems.length === 0,
    problems,
    manifest,
    info,
    sha256,
    binaries: pick,
    durations,
  };
}
