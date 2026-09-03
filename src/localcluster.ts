import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";

const run = promisify(execFile);

/**
 * Env for spawned Postgres tools. When the environment defines no locale at
 * all, default LC_ALL/LANG to "C": on macOS, postmaster 13-17 aborts with
 * "postmaster became multithreaded during startup" in a locale-less
 * environment (CoreFoundation fallback spawns a thread); slim containers can
 * hit the same class of failure. Explicit user locales are left untouched.
 */
function toolEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const hasLocale = Object.keys(env).some((k) => k === "LANG" || k.startsWith("LC_"));
  if (!hasLocale) {
    env["LC_ALL"] = "C";
    env["LANG"] = "C";
  }
  return env;
}

async function runTool(cmd: string, args: string[]): Promise<{ stdout: string }> {
  return run(cmd, args, { env: toolEnv() });
}


async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export interface TempClusterOptions {
  binDir: string;
  dataRoot: string;
}

/**
 * A throwaway Postgres cluster on a free localhost port, built with local
 * binaries via initdb. No Docker, no root, destroyed after use.
 */
export class TempCluster {
  readonly port: number;
  readonly user = "pgproof";
  private constructor(
    private binDir: string,
    private dataDir: string,
    port: number,
  ) {
    this.port = port;
  }

  static async create(opts: TempClusterOptions): Promise<TempCluster> {
    const dataDir = mkdtempSync(join(opts.dataRoot, "cluster-"));
    const port = await freePort();
    await runTool(join(opts.binDir, "initdb"), [
      "-D", dataDir, "-U", "pgproof", "--auth=trust", "-E", "UTF8", "--no-locale",
    ]);
    await runTool(join(opts.binDir, "pg_ctl"), [
      "-D", dataDir, "-w", "-t", "30",
      // Unix sockets disabled: every connection is TCP on 127.0.0.1, and macOS
      // caps socket paths at ~104 chars, which breaks deeply nested dataRoots.
      "-o", `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''`,
      "-l", join(dataDir, "server.log"),
      "start",
    ]);
    return new TempCluster(opts.binDir, dataDir, port);
  }

  urlFor(db: string): string {
    return `postgresql://${this.user}@127.0.0.1:${this.port}/${db}`;
  }

  async createDb(name: string): Promise<void> {
    await runTool(join(this.binDir, "createdb"), ["-h", "127.0.0.1", "-p", String(this.port), "-U", this.user, name]);
  }

  async psql(db: string, sql: string): Promise<string> {
    const { stdout } = await run(
      join(this.binDir, "psql"),
      ["-h", "127.0.0.1", "-p", String(this.port), "-U", this.user, "-d", db, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-c", sql],
    );
    return stdout;
  }

  async destroy(): Promise<void> {
    try {
      await runTool(join(this.binDir, "pg_ctl"), ["-D", this.dataDir, "-m", "immediate", "-w", "stop"]);
    } catch {
      /* already stopped */
    }
  }
}
