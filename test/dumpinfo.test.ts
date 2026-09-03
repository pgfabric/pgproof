import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDumpListHeader } from "../src/dumpinfo.js";

const SAMPLE = `;
; Archive created at 2026-07-07 03:00:12 EDT
;     dbname: t_altima77
;     TOC Entries: 812
;     Compression: gzip
;     Dump Version: 1.16-0
;     Format: CUSTOM
;     Integer: 4 bytes
;     Offset: 8 bytes
;     Dumped from database version: 17.6
;     Dumped by pg_dump version: 17.6
`;

test("parses dbname, source server major and dump tool major from pg_restore -l header", () => {
  const info = parseDumpListHeader(SAMPLE);
  assert.equal(info.dbname, "t_altima77");
  assert.equal(info.sourceMajor, 17);
  assert.equal(info.dumpedByMajor, 17);
  assert.equal(info.createdAt, "2026-07-07 03:00:12 EDT");
});

test("tolerates missing fields (older formats) and returns nulls", () => {
  const info = parseDumpListHeader("; Archive created at 2020-01-01\n; Format: CUSTOM\n");
  assert.equal(info.dbname, null);
  assert.equal(info.sourceMajor, null);
});
