import { toDomainError, type PostgrestError } from "./to-domain-error";

/** Unwrap a multi-row read result, translating PostgREST errors into DomainErrors. */
export function unwrapMany<T>(result: { data: T[] | null; error: PostgrestError | null }, failure: string): T[] {
  if (result.error) throw toDomainError(result.error, { failure });
  return result.data ?? [];
}
