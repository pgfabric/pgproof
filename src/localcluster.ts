import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";

const run = promisify(execFile);

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
    await run(join(opts.binDir, "initdb"), [
      "-D", dataDir, "-U", "pgproof", "--auth=trust", "-E", "UTF8", "--no-locale",
    ]);
    await run(join(opts.binDir, "pg_ctl"), [
      "-D", dataDir, "-w", "-t", "30",
      "-o", `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='${dataDir}'`,
      "-l", join(dataDir, "server.log"),
      "start",
    ]);
    return new TempCluster(opts.binDir, dataDir, port);
  }

  urlFor(db: string): string {
    return `postgresql://${this.user}@127.0.0.1:${this.port}/${db}`;
  }

  async createDb(name: string): Promise<void> {
    await run(join(this.binDir, "createdb"), ["-h", "127.0.0.1", "-p", String(this.port), "-U", this.user, name]);
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
      await run(join(this.binDir, "pg_ctl"), ["-D", this.dataDir, "-m", "immediate", "-w", "stop"]);
    } catch {
      /* already stopped */
    }
  }
}
