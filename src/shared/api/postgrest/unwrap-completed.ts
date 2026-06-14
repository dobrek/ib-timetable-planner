import { toDomainError, type PostgrestError } from "./to-domain-error";

/** Unwrap a no-row mutation result (e.g. delete). Any error maps to INTERNAL_SERVER_ERROR. */
export function unwrapCompleted(result: { error: PostgrestError | null }, failure: string): { ok: true } {
  if (result.error) throw toDomainError(result.error, { failure });
  return { ok: true as const };
}
