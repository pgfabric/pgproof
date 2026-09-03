#!/usr/bin/env node
import { Command } from "commander";
import { mkdtempSync, rmSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runDrill, type DrillResult } from "./drill.js";

const program = new Command();

program
  .name("pgproof")
  .description("Postgres backups that prove they restore.\nDump → restore into a disposable cluster → verify counts, constraints, RLS.")
  .version("0.1.0");

function printReport(r: DrillResult, urlShown: string): void {
  const rows = r.manifest.tables.reduce((a, t) => a + t.rows, 0);
  const head = r.ok ? "✓ DRILL PASSED" : "✗ DRILL FAILED";
  console.log("");
  console.log(`${head} — ${urlShown}`);
  console.log("─".repeat(60));
  console.log(`  server        Postgres ${r.manifest.serverVersion}`);
  console.log(`  tools         v${r.binaries.major}${r.binaries.exact ? "" : " (newer than source — ok)"} · ${r.binaries.dir}`);
  console.log(`  tables        ${r.manifest.tables.length} · ${rows.toLocaleString("en-US")} rows`);
  console.log(`  rls policies  ${r.manifest.rlsPolicies}`);
  console.log(`  extensions    ${r.manifest.extensions.join(", ") || "none"}`);
  console.log(`  sha256        ${r.sha256}`);
  console.log(`  timings       dump ${r.durations.dumpMs} ms · restore ${r.durations.restoreMs} ms · verify ${r.durations.verifyMs} ms`);
  if (!r.ok) {
    console.log("");
    for (const p of r.problems) console.log(`  ✗ ${p}`);
    console.log("");
    console.log("  A failed drill today beats a failed restore the night you need it.");
  }
  console.log("");
}

program
  .command("drill")
  .description("dump a database (or take an existing dump), restore it into a throwaway local cluster, and verify it")
  .argument("<url>", "postgresql:// connection string of the SOURCE database")
  .option("--file <dump>", "verify this existing pg_dump custom-format file instead of dumping")
  .option("--probe <sql...>", "sanity queries run on the restored copy; pass = first column of first row is truthy")
  .option("--keep", "keep the dump file after the drill (prints its path)")
  .option("--out <path>", "with --keep: where to save the dump")
  .option("--json", "machine-readable output")
  .action(async (url: string, opts: { file?: string; probe?: string[]; keep?: boolean; out?: string; json?: boolean }) => {
    const workdir = mkdtempSync(join(tmpdir(), "pgproof-"));
    try {
      const result = await runDrill({
        url,
        workdir,
        dumpFile: opts.file ? resolve(opts.file) : undefined,
        probes: opts.probe ?? [],
      });
      if (opts.keep && !opts.file) {
        const dest = opts.out ? resolve(opts.out) : join(process.cwd(), `pgproof-${new Date().toISOString().slice(0, 10)}.dump`);
        copyFileSync(result.dumpFile, dest);
        result.dumpFile = dest;
      }
      if (opts.json) {
        console.log(JSON.stringify({ ...result, dumpFile: opts.keep || opts.file ? result.dumpFile : undefined }, null, 2));
      } else {
        printReport(result, url.replace(/:\/\/([^:@/]+)(:[^@]*)?@/, "://$1:***@"));
        if ((opts.keep || opts.file) && existsSync(result.dumpFile)) console.log(`  dump: ${result.dumpFile}\n`);
      }
      process.exitCode = result.ok ? 0 : 1;
    } catch (e) {
      console.error(`pgproof: ${e instanceof Error ? e.message : e}`);
      process.exitCode = 2;
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

program
  .command("verify")
  .description("verify an ARCHIVED dump with no live source: restore it into a throwaway cluster, validate constraints, run probes, report what it contains")
  .argument("<file>", "pg_dump custom-format archive (.dump)")
  .option("--probe <sql...>", "sanity queries run on the restored copy; pass = first column of first row is truthy")
  .option("--json", "machine-readable output")
  .action(async (file: string, opts: { probe?: string[]; json?: boolean }) => {
    const { runFileVerify } = await import("./verifyfile.js");
    const workdir = mkdtempSync(join(tmpdir(), "pgproof-"));
    try {
      const r = await runFileVerify({ file: resolve(file), workdir, probes: opts.probe ?? [] });
      if (opts.json) {
        console.log(JSON.stringify(r, null, 2));
      } else {
        const rows = r.manifest.tables.reduce((a, t) => a + t.rows, 0);
        const head = r.ok ? "✓ ARCHIVE VERIFIED" : "✗ ARCHIVE FAILED";
        console.log("");
        console.log(`${head} — ${resolve(file)}`);
        console.log("─".repeat(60));
        if (r.info.dbname) console.log(`  dumped from   ${r.info.dbname}${r.info.createdAt ? " · " + r.info.createdAt : ""}`);
        if (r.info.dumpedByMajor) console.log(`  dump tool     pg_dump v${r.info.dumpedByMajor}`);
        console.log(`  tools         v${r.binaries.major} · ${r.binaries.dir}`);
        console.log(`  contains      ${r.manifest.tables.length} tables · ${rows.toLocaleString("en-US")} rows`);
        console.log(`  rls policies  ${r.manifest.rlsPolicies}`);
        console.log(`  extensions    ${r.manifest.extensions.join(", ") || "none"}`);
        console.log(`  sha256        ${r.sha256}`);
        console.log(`  timings       restore ${r.durations.restoreMs} ms · verify ${r.durations.verifyMs} ms`);
        if (!r.ok) {
          console.log("");
          for (const p of r.problems) console.log(`  ✗ ${p}`);
        }
        console.log("");
      }
      process.exitCode = r.ok ? 0 : 1;
    } catch (e) {
      console.error(`pgproof: ${e instanceof Error ? e.message : e}`);
      process.exitCode = 2;
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

program.parseAsync();
