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
