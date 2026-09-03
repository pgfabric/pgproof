import { test } from "node:test";
import assert from "node:assert/strict";
import { compareManifests, type Manifest } from "../src/manifest.js";

const base: Manifest = {
  serverVersion: "15.1",
  tables: [
    { schema: "public", name: "users", rows: 100 },
    { schema: "public", name: "orders", rows: 2500 },
  ],
  extensions: ["plpgsql"],
  rlsPolicies: 3,
  sequences: 2,
};

test("identical manifests compare as ok", () => {
  const r = compareManifests(base, structuredClone(base));
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
});

test("missing table is reported as a problem", () => {
  const actual = structuredClone(base);
  actual.tables = actual.tables.filter((t) => t.name !== "orders");
  const r = compareManifests(base, actual);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("orders") && p.includes("missing")));
});

test("row count mismatch is reported with both counts", () => {
  const actual = structuredClone(base);
  actual.tables[1].rows = 2400;
  const r = compareManifests(base, actual);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("orders") && p.includes("2500") && p.includes("2400")));
});

test("missing extension is reported, extra extension is not a problem", () => {
  const missing = structuredClone(base);
  missing.extensions = [];
  assert.equal(compareManifests(base, missing).ok, false);

  const extra = structuredClone(base);
  extra.extensions = ["plpgsql", "pgcrypto"];
  assert.equal(compareManifests(base, extra).ok, true);
});

test("fewer RLS policies after restore is a problem", () => {
  const actual = structuredClone(base);
  actual.rlsPolicies = 1;
  const r = compareManifests(base, actual);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.toLowerCase().includes("rls")));
});

test("extra table in restore target is reported (drill target must start empty)", () => {
  const actual = structuredClone(base);
  actual.tables.push({ schema: "public", name: "stowaway", rows: 1 });
  const r = compareManifests(base, actual);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("stowaway") && p.includes("unexpected")));
});
