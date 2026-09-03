import pg from "pg";
import type { Manifest, TableCount } from "./manifest.js";

/** Capture the verification manifest from a live database. Exact counts. */
export async function captureManifest(url: string): Promise<Manifest> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const version = await client.query("SHOW server_version");
    const serverVersion: string = version.rows[0].server_version;

    const tablesRes = await client.query(`
      SELECT n.nspname AS schema, c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p')
        AND n.nspname NOT IN ('pg_catalog','information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
      ORDER BY 1, 2
    `);

    const tables: TableCount[] = [];
    for (const row of tablesRes.rows) {
      const ident = `"${row.schema}"."${row.name}"`;
      const c = await client.query(`SELECT count(*)::bigint AS n FROM ${ident}`);
      tables.push({ schema: row.schema, name: row.name, rows: Number(c.rows[0].n) });
    }

    const ext = await client.query("SELECT extname FROM pg_extension ORDER BY 1");
    const pol = await client.query("SELECT count(*)::int AS n FROM pg_policies");
    const seq = await client.query(
      "SELECT count(*)::int AS n FROM pg_class WHERE relkind = 'S'",
    );

    return {
      serverVersion,
      tables,
      extensions: ext.rows.map((r) => r.extname),
      rlsPolicies: pol.rows[0].n,
      sequences: seq.rows[0].n,
    };
  } finally {
    await client.end();
  }
}

/** Constraints that failed validation after a restore (should be zero). */
export async function invalidConstraints(url: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query("SELECT conname FROM pg_constraint WHERE NOT convalidated");
    return res.rows.map((r) => r.conname);
  } finally {
    await client.end();
  }
}

/** Run a probe query; it passes iff it returns at least one row whose first column is truthy. */
export async function runProbe(url: string, sql: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query(sql);
    if (res.rows.length === 0) return false;
    const v = Object.values(res.rows[0])[0];
    return v === true || v === "t" || (typeof v === "number" && v > 0) || (typeof v === "string" && v !== "0" && v !== "f" && v !== "false");
  } finally {
    await client.end();
  }
}
