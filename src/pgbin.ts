import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export interface BinaryDir {
  major: number;
  dir: string;
}

export interface BinaryPick extends BinaryDir {
  exact: boolean;
}

/** "15.1", "17.2 (Homebrew)", "9.6.24" → major int */
export function majorFromVersionString(v: string): number {
  const m = v.trim().match(/^(\d+)/);
  if (!m) throw new Error(`unparseable Postgres version: "${v}"`);
  return parseInt(m[1], 10);
}

/**
 * Client tools must be >= the dump's major. Prefer exact; else the smallest
 * newer major; older-only is unusable.
 */
export function pickBinaryDir(wantedMajor: number, available: BinaryDir[]): BinaryPick | null {
  const exact = available.find((b) => b.major === wantedMajor);
  if (exact) return { ...exact, exact: true };
  const newer = available
    .filter((b) => b.major > wantedMajor)
    .sort((a, b) => a.major - b.major)[0];
  return newer ? { ...newer, exact: false } : null;
}

/**
 * Directory-glob roots probed for versioned Postgres installs, beyond PATH:
 * Postgres.app, Homebrew keg-only (postgresql@N is NOT on PATH), EDB
 * installers, Debian/Ubuntu PGDG.
 */
/** "Postgres.app", "Postgres 2.app", "Postgres copie.app" — duplicated app bundles. */
export function isPostgresAppBundle(name: string): boolean {
  return /^Postgres( .+)?\.app$/.test(name);
}

/** Versions dirs of every Postgres.app bundle (copies included) in app folders. */
function postgresAppVersionRoots(): string[] {
  const roots: string[] = [];
  for (const apps of ["/Applications", join(process.env.HOME ?? "", "Applications")]) {
    if (!existsSync(apps)) continue;
    try {
      for (const entry of readdirSync(apps)) {
        if (isPostgresAppBundle(entry)) roots.push(join(apps, entry, "Contents/Versions"));
      }
    } catch {
      /* unreadable */
    }
  }
  return roots;
}

export function defaultProbeRoots(): string[] {
  return [
    ...postgresAppVersionRoots(),
    "/opt/homebrew/opt", // Homebrew Apple Silicon: postgresql@17/bin
    "/usr/local/opt", // Homebrew Intel
    "/Library/PostgreSQL", // EDB installer: <major>/bin
    "/usr/lib/postgresql", // Debian/Ubuntu PGDG: <major>/bin
  ];
}

/**
 * When PGPROOF_PG_BIN is set but yielded no usable tools, say so explicitly —
 * a user-provided path must never be ignored silently. Returns null when the
 * env is unset or its directory was successfully discovered.
 */
export function envBinDiagnostic(envDir: string | undefined, found: BinaryDir[]): string | null {
  if (!envDir) return null;
  if (found.some((b) => b.dir === envDir)) return null;
  return (
    `PGPROOF_PG_BIN=${envDir} was set, but no usable pg_dump/pg_ctl was found there ` +
    `(directory missing, or binaries absent/not executable) — it was ignored.`
  );
}

/** Discover local Postgres binary directories (PATH, roots above, PGPROOF_PG_BIN). */
export function discoverBinaryDirs(): BinaryDir[] {
  const found = new Map<string, BinaryDir>();

  const probe = (dir: string) => {
    const pgctl = join(dir, "pg_ctl");
    if (!existsSync(pgctl) || !existsSync(join(dir, "pg_dump"))) return;
    try {
      const out = execFileSync(join(dir, "pg_dump"), ["--version"], { encoding: "utf8" });
      const m = out.match(/(\d+)(?:\.\d+)?/);
      if (m) found.set(dir, { major: parseInt(m[1], 10), dir });
    } catch {
      /* unusable dir */
    }
  };

  if (process.env.PGPROOF_PG_BIN) probe(process.env.PGPROOF_PG_BIN);

  for (const root of defaultProbeRoots()) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      if (entry === "latest") continue;
      // Homebrew: only postgresql@N entries are Postgres; others (openssl…) are cheap to skip.
      if (root.endsWith("/opt") && !entry.startsWith("postgresql")) continue;
      probe(join(root, entry, "bin"));
    }
  }

  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir) probe(dir);
  }

  return [...found.values()].sort((a, b) => a.major - b.major);
}
