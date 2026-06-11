import { DomainError } from "../errors";

/** PostgREST surfaces a Postgres unique-constraint violation with this SQLSTATE. */
export const UNIQUE_VIOLATION = "23505";

/** PostgREST when `.single()` matches zero rows (e.g. update of a missing id). */
export const NOT_FOUND_ROW = "PGRST116";

type PostgrestError = { code: string; message: string };

type RowResult<T> = { data: T; error: null } | { data: null; error: PostgrestError };

type RowMessages = {
  /** CONFLICT message when the write hits a unique constraint; omit to fall through to `failure`. */
  conflict?: string;
  /** NOT_FOUND message when `.single()` matched no row; omit to fall through to `failure`. */
  notFound?: string;
  /** Prefix for any other error: surfaced as `${failure}: ${error.message}`. */
  failure: string;
};

/** Unwrap a single-row mutation result, translating PostgREST errors into DomainErrors. */
export function unwrapRow<T>(result: RowResult<T>, messages: RowMessages): T {
  if (result.error) throw toDomainError(result.error, messages);
  return result.data;
}

/** Unwrap a no-row mutation result (e.g. delete). Any error maps to INTERNAL_SERVER_ERROR. */
export function unwrapCompleted(result: { error: PostgrestError | null }, failure: string): { ok: true } {
  if (result.error) throw toDomainError(result.error, { failure });
  return { ok: true as const };
}

function toDomainError(error: PostgrestError, messages: RowMessages): DomainError {
  if (messages.conflict && error.code === UNIQUE_VIOLATION) return new DomainError("CONFLICT", messages.conflict);
  if (messages.notFound && error.code === NOT_FOUND_ROW) return new DomainError("NOT_FOUND", messages.notFound);
  return new DomainError("INTERNAL_SERVER_ERROR", `${messages.failure}: ${error.message}`);
}
