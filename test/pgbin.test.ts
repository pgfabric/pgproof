import { test } from "node:test";
import assert from "node:assert/strict";
import { majorFromVersionString, pickBinaryDir } from "../src/pgbin.js";

test("extracts major version from server_version strings", () => {
  assert.equal(majorFromVersionString("15.1"), 15);
  assert.equal(majorFromVersionString("17.2 (Homebrew)"), 17);
  assert.equal(majorFromVersionString("16.4 (Ubuntu 16.4-1.pgdg22.04+1)"), 16);
  assert.equal(majorFromVersionString("9.6.24"), 9);
});

test("picks exact major match when available", () => {
  const dirs = [
    { major: 14, dir: "/v/14/bin" },
    { major: 15, dir: "/v/15/bin" },
    { major: 16, dir: "/v/16/bin" },
  ];
  const pick = pickBinaryDir(15, dirs);
  assert.equal(pick?.dir, "/v/15/bin");
  assert.equal(pick?.exact, true);
});

test("falls back to the smallest newer major when exact is absent", () => {
  const dirs = [
    { major: 13, dir: "/v/13/bin" },
    { major: 16, dir: "/v/16/bin" },
    { major: 17, dir: "/v/17/bin" },
  ];
  const pick = pickBinaryDir(15, dirs);
  assert.equal(pick?.dir, "/v/16/bin");
  assert.equal(pick?.exact, false);
});

test("returns null when only older majors exist (cannot restore newer dumps)", () => {
  const dirs = [{ major: 13, dir: "/v/13/bin" }];
  assert.equal(pickBinaryDir(15, dirs), null);
});

test("default probe roots include Homebrew keg-only and EDB locations", async () => {
  const { defaultProbeRoots } = await import("../src/pgbin.js");
  const roots = defaultProbeRoots();
  assert.ok(roots.some((r) => r.startsWith("/opt/homebrew/opt")), "homebrew arm64");
  assert.ok(roots.some((r) => r.startsWith("/usr/local/opt")), "homebrew intel");
  assert.ok(roots.some((r) => r.startsWith("/Library/PostgreSQL")), "EDB installer");
});

test("envBinDiagnostic explains an unusable PGPROOF_PG_BIN explicitly", async () => {
  const { envBinDiagnostic } = await import("../src/pgbin.js");
  const found = [{ major: 15, dir: "/v/15/bin" }];
  const msg = envBinDiagnostic("/does/not/exist/bin", found);
  assert.ok(msg && msg.includes("/does/not/exist/bin"));
  assert.ok(msg && msg.toLowerCase().includes("pg_dump"));
  assert.equal(envBinDiagnostic("/v/15/bin", found), null);
  assert.equal(envBinDiagnostic(undefined, found), null);
});

test("isPostgresAppBundle matches renamed copies like 'Postgres 2.app'", async () => {
  const { isPostgresAppBundle } = await import("../src/pgbin.js");
  assert.equal(isPostgresAppBundle("Postgres.app"), true);
  assert.equal(isPostgresAppBundle("Postgres 2.app"), true);
  assert.equal(isPostgresAppBundle("Postgres copie.app"), true);
  assert.equal(isPostgresAppBundle("PostgresOutil.app"), false);
  assert.equal(isPostgresAppBundle("Postman.app"), false);
});

test("buildDumpArgs excludes known unrestorable extensions when tools support it", async () => {
  const { buildDumpArgs } = await import("../src/drill.js");
  const args17 = buildDumpArgs(17, "/tmp/f.dump", "postgresql://u@h/db");
  assert.ok(args17.includes("--exclude-extension=supabase_vault"));
  const args13 = buildDumpArgs(13, "/tmp/f.dump", "postgresql://u@h/db");
  assert.ok(!args13.some((a) => a.startsWith("--exclude-extension")), "pg_dump 13 lacks the flag");
});

test("captureManifest exclusions are reflected in the manifest contract", async () => {
  const { UNRESTORABLE } = await import("../src/drill.js");
  assert.ok(UNRESTORABLE.extensions.includes("supabase_vault"));
  assert.ok(UNRESTORABLE.schemas.includes("vault"));
});
