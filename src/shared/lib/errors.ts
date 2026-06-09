/**
 * Framework-free domain error. The domain layer (`src/lib/**`) throws these instead of
 * Astro's `ActionError`, so domain functions stay decoupled from `astro:actions` (which
 * doesn't resolve under Vitest) and remain unit-testable. The action layer catches a
 * `DomainError` and re-throws it as an `ActionError` — the codes are a 1:1 subset.
 */

/** A subset of Astro's `ActionError` codes — the ones the domain layer raises. */
export type DomainErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE_CONTENT"
  | "INTERNAL_SERVER_ERROR";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
