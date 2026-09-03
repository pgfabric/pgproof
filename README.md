# pgProof

**A backup is a hypothesis. A restore is proof.**

`pgproof` dumps your Postgres database, restores the dump into a **disposable
local cluster**, and verifies the result: table and row counts against a
manifest captured at dump time, foreign-key constraints, sequences,
extensions, RLS policies, and your own probe queries. Then it destroys the
evidence and tells you the truth.

```
$ npx pgproof drill "postgresql://user:pass@host:5432/mydb"

✓ DRILL PASSED — postgresql://user:***@host:5432/mydb
────────────────────────────────────────────────────────────
  server        Postgres 15.1
  tools         v15 · /Applications/Postgres.app/Contents/Versions/15/bin
  tables        12 · 1,184,302 rows
  rls policies  17
  extensions    plpgsql, pgcrypto
  sha256        9f2c…e1a7
  timings       dump 2140 ms · restore 940 ms · verify 380 ms
```

Works with Supabase (use the **Session Pooler** string), Neon (use the
**direct**, non-pooled string), Railway, Render, RDS, and self-hosted
Postgres 13–17.

## Why

Every restore disaster starts with months of dumps that "worked". Truncated
uploads, missing extensions, version mismatches and silently-empty tables all
look identical in a bucket listing. The only proof is a restore — so `pgproof`
does one, every time, in seconds, without Docker and without touching your
source database beyond a read.

## Install

```
npm install -g pgproof     # or: npx pgproof …
```

Requires Node ≥ 20 and local Postgres client/server binaries at a version ≥
your database's major (Postgres.app, Homebrew, or apt `postgresql-N` all
work; auto-discovered, or point `PGPROOF_PG_BIN` at a bin directory).

## Usage

```
# full drill: dump + restore + verify
pgproof drill "$DATABASE_URL"

# keep the (verified) dump — this is your backup now
pgproof drill "$DATABASE_URL" --keep --out backups/today.dump

# verify a RECENT backup file against the live database's manifest
pgproof drill "$DATABASE_URL" --file backups/today.dump

# verify an OLD ARCHIVE with no live source (or one that changed since):
# restores it, validates constraints, runs probes, reports what it contains
pgproof verify backups/2026-07-01.dump --probe "SELECT count(*) > 0 FROM clients"

# domain probes: prove the data is not just present but sane
pgproof drill "$DATABASE_URL" \
  --probe "SELECT count(*) > 0 FROM users" \
  --probe "SELECT max(created_at) > now() - interval '7 days' FROM orders"

# machine-readable, for CI
pgproof drill "$DATABASE_URL" --json
```

Exit codes: `0` drill passed · `1` drill failed · `2` could not run.

## What the drill checks

1. **Restore completes** with `--exit-on-error` in a throwaway cluster built
   with version-matched tools (never older than the source).
2. **Manifest match**: every table present, exact row counts equal, no
   unexpected tables, sequences and extensions present, RLS policy count
   not lower.
3. **Constraints**: zero `pg_constraint` rows left unvalidated.
4. **Your probes**: each query must return a truthy first column.
5. **sha256** of the dump, so a truncated upload can never impersonate a
   verified backup.

## Hosted: drills on every backup, while you sleep

`pgproof` proves one backup when you run it. **[pgproof.com](https://pgproof.com)**
runs the schedule for you: encrypted storage, a drill on *every* backup,
immediate alerts on failure, and a weekly proof report — for Supabase, Neon,
Railway, Render and self-hosted (agent mode: your credentials never leave
your box). Free for one project.

## License

AGPL-3.0-only. The CLI is free forever; if you offer it as a service, your
service must be open too.
