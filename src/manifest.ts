export interface TableCount {
  schema: string;
  name: string;
  rows: number;
}

export interface Manifest {
  serverVersion: string;
  tables: TableCount[];
  extensions: string[];
  rlsPolicies: number;
  sequences: number;
}

export interface CompareResult {
  ok: boolean;
  problems: string[];
}

const key = (t: TableCount) => `${t.schema}.${t.name}`;

/**
 * Compare the manifest captured at dump time (expected) with the manifest
 * read from the restored drill target (actual).
 */
export function compareManifests(expected: Manifest, actual: Manifest): CompareResult {
  const problems: string[] = [];

  const actualByKey = new Map(actual.tables.map((t) => [key(t), t]));
  const expectedKeys = new Set(expected.tables.map(key));

  for (const t of expected.tables) {
    const got = actualByKey.get(key(t));
    if (!got) {
      problems.push(`table ${key(t)} is missing after restore`);
    } else if (got.rows !== t.rows) {
      problems.push(`table ${key(t)} row count mismatch: expected ${t.rows}, got ${got.rows}`);
    }
  }

  for (const t of actual.tables) {
    if (!expectedKeys.has(key(t))) {
      problems.push(`table ${key(t)} is unexpected in the drill target`);
    }
  }

  for (const ext of expected.extensions) {
    if (!actual.extensions.includes(ext)) {
      problems.push(`extension ${ext} is missing after restore`);
    }
  }

  if (actual.rlsPolicies < expected.rlsPolicies) {
    problems.push(`RLS policies lost in restore: expected ${expected.rlsPolicies}, got ${actual.rlsPolicies}`);
  }

  if (actual.sequences < expected.sequences) {
    problems.push(`sequences lost in restore: expected ${expected.sequences}, got ${actual.sequences}`);
  }

  return { ok: problems.length === 0, problems };
}
