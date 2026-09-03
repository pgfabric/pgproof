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
