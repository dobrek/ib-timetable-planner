import { DomainError } from "@/shared/lib/errors";
import { NOT_FOUND_ROW, UNIQUE_VIOLATION } from "./sqlstates";

export type PostgrestError = { code: string; message: string };

export type RowMessages = {
  /** CONFLICT message when the write hits a unique constraint; omit to fall through to `failure`. */
  conflict?: string;
  /** NOT_FOUND message when `.single()` matched no row; omit to fall through to `failure`. */
  notFound?: string;
  /** Prefix for any other error: surfaced as `${failure}: ${error.message}`. */
  failure: string;
};

export function toDomainError(error: PostgrestError, messages: RowMessages): DomainError {
  if (messages.conflict && error.code === UNIQUE_VIOLATION) return new DomainError("CONFLICT", messages.conflict);
  if (messages.notFound && error.code === NOT_FOUND_ROW) return new DomainError("NOT_FOUND", messages.notFound);
  return new DomainError("INTERNAL_SERVER_ERROR", `${messages.failure}: ${error.message}`);
}
