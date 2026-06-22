import { toDomainError, type PostgrestError, type RowMessages } from "./to-domain-error";

/** Unwrap a single-row mutation result, translating PostgREST errors into DomainErrors. */
export function unwrapRow<R extends { data: unknown; error: PostgrestError | null }>(
  result: R,
  messages: RowMessages,
): NonNullable<R["data"]> {
  if (result.error) throw toDomainError(result.error, messages);
  return result.data as NonNullable<R["data"]>;
}
