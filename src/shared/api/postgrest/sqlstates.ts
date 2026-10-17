/** PostgREST surfaces a Postgres unique-constraint violation with this SQLSTATE. */
export const UNIQUE_VIOLATION = "23505";

/** A row refused by a CHECK constraint. */
export const CHECK_VIOLATION = "23514";

/** PostgREST when `.single()` matches zero rows (e.g. update of a missing id). */
export const NOT_FOUND_ROW = "PGRST116";
