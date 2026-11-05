/** PostgREST surfaces a Postgres unique-constraint violation with this SQLSTATE. */
export const UNIQUE_VIOLATION = "23505";

/** A row refused by a CHECK constraint. */
export const CHECK_VIOLATION = "23514";

/**
 * A refused privilege: a missing grant, or a row an RLS policy rejects on INSERT or UPDATE (S-403's
 * viewer). A refused DELETE raises nothing; it matches 0 rows.
 */
export const INSUFFICIENT_PRIVILEGE = "42501";

/** PostgREST when `.single()` matches zero rows (e.g. update of a missing id). */
export const NOT_FOUND_ROW = "PGRST116";

/**
 * A custom status a trigger raises on purpose. PostgREST answers a `PTxyz` SQLSTATE with HTTP
 * status `xyz` and puts the SQLSTATE in the body's `code`, where `P0*` would be a 500. The
 * last-admin guard on `user_roles` raises it (S-406, `20261105080343_role_management.sql`). It is
 * the repo's first custom errcode.
 */
export const RAISED_CONFLICT = "PT409";
