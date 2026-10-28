/**
 * Framework-free domain error. The domain layer (`src/lib/**`) throws these instead of
 * Astro's `ActionError`, so domain functions stay decoupled from `astro:actions` (which
 * doesn't resolve under Vitest) and remain unit-testable. The action layer catches a
 * `DomainError` and re-throws it as an `ActionError` — the codes are a 1:1 subset.
 */

/** A subset of Astro's `ActionError` codes — the ones the domain layer raises. */
export type DomainErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE_CONTENT"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_SERVER_ERROR";

/**
 * What a caller is told when their role does not cover a write (S-403): by the action guard before
 * the domain runs, and by `toDomainError` when RLS refuses one with SQLSTATE 42501.
 */
export const FORBIDDEN_MESSAGE = "You don't have permission to do that.";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
