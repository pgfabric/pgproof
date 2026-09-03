import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const run = promisify(execFile);

export interface DumpInfo {
  dbname: string | null;
  sourceMajor: number | null;
  dumpedByMajor: number | null;
  createdAt: string | null;
}

/** Parse the comment header of `pg_restore -l` output. Fields are optional. */
export function parseDumpListHeader(text: string): DumpInfo {
  const grab = (re: RegExp): string | null => text.match(re)?.[1]?.trim() ?? null;
  const major = (s: string | null): number | null => {
    const m = s?.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  };
  return {
    dbname: grab(/^;\s*dbname:\s*(.+)$/m),
    sourceMajor: major(grab(/^;\s*Dumped from database version:\s*(.+)$/m)),
    dumpedByMajor: major(grab(/^;\s*Dumped by pg_dump version:\s*(.+)$/m)),
    createdAt: grab(/^;\s*Archive created at\s*(.+)$/m),
  };
}

/** Read a dump file's header via pg_restore -l (validates it is a real archive). */
export async function readDumpInfo(file: string, binDir: string): Promise<DumpInfo> {
  const { stdout } = await run(join(binDir, "pg_restore"), ["-l", file], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseDumpListHeader(stdout);
}
