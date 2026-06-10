/** PostgREST surfaces a Postgres unique-constraint violation with this SQLSTATE. */
export const UNIQUE_VIOLATION = "23505";

/** PostgREST when `.single()` matches zero rows (e.g. update of missing id). */
export const NOT_FOUND_ROW = "PGRST116";

export const DUPLICATE_TEACHER_MESSAGE = "A teacher with this code already exists.";
