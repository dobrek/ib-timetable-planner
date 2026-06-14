import { toDomainError, type PostgrestError, type RowMessages } from "./to-domain-error";

type RowResult<T> = { data: T; error: null } | { data: null; error: PostgrestError };

/** Unwrap a single-row mutation result, translating PostgREST errors into DomainErrors. */
export function unwrapRow<T>(result: RowResult<T>, messages: RowMessages): T {
  if (result.error) throw toDomainError(result.error, messages);
  return result.data;
}
