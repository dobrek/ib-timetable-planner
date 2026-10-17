import { isAuthSessionMissingError, isAuthWeakPasswordError, type AuthError } from "@supabase/supabase-js";
import { DomainError } from "@/shared/lib/errors";
import {
  PASSWORD_REUSED_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  RATE_LIMITED_MESSAGE,
  SESSION_ENDED_MESSAGE,
} from "./constants";

/**
 * Unwrap a supabase-js Auth result the way `unwrapRow` unwraps a PostgREST one: the data, or the
 * error translated into a `DomainError`. supabase-js returns Auth errors rather than throwing them.
 *
 * Private to the account slice, and it maps only what `updateUser({ password })` can reach. A
 * hosted toggle flipped on (`reauthentication_needed`, `current_password_required`) falls through
 * to GoTrue's own message on purpose; `docs/runbooks/hosted-auth-settings.md` names those codes.
 * Promote this to `shared/api` when S-402 brings a second caller.
 */
export function unwrapAuth<R extends { data: unknown; error: AuthError | null }>(result: R): SuccessData<R> {
  if (result.error) throw toDomainError(result.error);
  return result.data;
}

// supabase-js Auth responses are unions of a success arm (`error: null`) and an error arm whose
// data is emptied (`user: null`); the success arm's data is what a caller gets back.
type SuccessData<R extends { data: unknown }> = Extract<R, { error: null }>["data"];

function toDomainError(error: AuthError): DomainError {
  // No cookie session, or a session revoked by a password change elsewhere (`session_not_found`).
  if (isAuthSessionMissingError(error)) return new DomainError("UNAUTHORIZED", SESSION_ENDED_MESSAGE);
  switch (error.code) {
    case "weak_password":
      return new DomainError("UNPROCESSABLE_CONTENT", weakPasswordMessage(error));
    case "same_password":
      return new DomainError("UNPROCESSABLE_CONTENT", PASSWORD_REUSED_MESSAGE);
    case "over_request_rate_limit":
      return new DomainError("TOO_MANY_REQUESTS", RATE_LIMITED_MESSAGE);
    default:
      return new DomainError("INTERNAL_SERVER_ERROR", error.message);
  }
}

// Only the length rule is configured; any other reason (a leaked password, if HIBP is ever enabled)
// keeps GoTrue's own wording.
const weakPasswordMessage = (error: AuthError): string =>
  isAuthWeakPasswordError(error) && error.reasons.includes("length") ? PASSWORD_TOO_SHORT_MESSAGE : error.message;
