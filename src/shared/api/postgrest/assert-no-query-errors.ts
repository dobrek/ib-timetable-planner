import { DomainError } from "@/shared/lib/errors";

/** Throw a DomainError when any of a batch of parallel PostgREST reads failed. */
export function assertNoQueryErrors(label: string, results: readonly { error: { message: string } | null }[]): void {
  for (const result of results) {
    if (result.error) {
      throw new DomainError("INTERNAL_SERVER_ERROR", `${label} lookup failed: ${result.error.message}`);
    }
  }
}
