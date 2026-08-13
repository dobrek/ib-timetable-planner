import { Client } from "pg";

/**
 * A direct Postgres connection to the LOCAL stack, for the handful of integration assertions that
 * PostgREST structurally cannot make.
 *
 * Grant-layer posture is the motivating case: `has_table_privilege(role, table, verb)` is the only
 * honest way to prove which privileges a role actually holds, and `lessons.md` ("granting a role is
 * not excluding the others") exists precisely because reading a migration's revoke statements is
 * NOT proof. PostgREST speaks rows, not catalog introspection, and it cannot answer for TRUNCATE /
 * REFERENCES / TRIGGER / MAINTAIN at all — the four privileges Supabase's auto-grant leaves behind.
 *
 * Test lane only. Nothing in `src/` runtime code may import this: the app is a Cloudflare Worker
 * and `pg` is a Node-socket client, so it could not run there even if someone tried.
 */

/** The Supabase CLI's fixed local Postgres endpoint (`supabase/config.toml` -> `[db] port`). */
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export const connectPostgres = async (): Promise<Client> => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL ?? LOCAL_DB_URL });
  await client.connect();
  return client;
};

/** The eight privilege verbs `has_table_privilege` understands (MAINTAIN is Postgres 17+). */
export const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
] as const;

export type TablePrivilege = (typeof TABLE_PRIVILEGES)[number];

/**
 * Which of the eight privileges `role` holds on `table` AT THE TABLE LEVEL, straight from the catalog.
 * Returns them sorted so a failing expectation reads as a set difference rather than an ordering
 * accident.
 *
 * Table level is the whole subtlety: `has_table_privilege` does NOT see column-scoped grants.
 * Verified against the local stack — with SELECT granted on three columns of `generation_jobs` and
 * revoked table-wide, `has_table_privilege(role, table, 'SELECT')` is **false** while
 * `has_column_privilege(role, table, 'id', 'SELECT')` is **true**. So an empty result here does not
 * mean "unreachable", it means "no table-wide grant" — pair it with
 * :func:`heldColumnPrivileges` to state the actual reachable surface.
 */
export const heldPrivileges = async (client: Client, role: string, table: string): Promise<TablePrivilege[]> => {
  const { rows } = await client.query<{ verb: TablePrivilege; held: boolean }>(
    `select verb, has_table_privilege($1, $2, verb) as held from unnest($3::text[]) as verb`,
    [role, table, [...TABLE_PRIVILEGES]],
  );
  return rows
    .filter((row) => row.held)
    .map((row) => row.verb)
    .sort();
};

/**
 * Which columns of `table` the role holds `verb` on, straight from the catalog.
 *
 * The complement of :func:`heldPrivileges`, which is blind to column grants entirely: this is the only
 * probe that can enumerate a column-scoped surface. `has_column_privilege` counts the table-level
 * grant too, so a table-wide grant shows up here as every column. Returns sorted names.
 */
export const heldColumnPrivileges = async (
  client: Client,
  role: string,
  table: string,
  verb: TablePrivilege,
): Promise<string[]> => {
  const { rows } = await client.query<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema = split_part($2, '.', 1)
        and table_name = split_part($2, '.', 2)
        and has_column_privilege($1, $2, column_name, $3)
      order by column_name`,
    [role, table, verb],
  );
  return rows.map((row) => row.column_name);
};
