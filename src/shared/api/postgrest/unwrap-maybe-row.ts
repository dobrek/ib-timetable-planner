import { toDomainError, type PostgrestError } from "./to-domain-error";

/**
 * Unwrap a `.maybeSingle()` read: returns the row, or `null` when zero rows matched
 * (a valid result, not an error). Any PostgREST error maps to a DomainError. Use this
 * instead of {@link unwrapRow} when zero rows is expected — `unwrapRow` models
 * `.single()` semantics, where the success arm is always a non-null row.
 */
export function unwrapMaybeRow<T>(result: { data: T | null; error: PostgrestError | null }, failure: string): T | null {
  if (result.error) throw toDomainError(result.error, { failure });
  return result.data;
}
