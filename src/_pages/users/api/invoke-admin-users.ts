import { FunctionsHttpError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import type { TemporaryPassword } from "../model/schemas";
import { toAccountError, type AccountOperation } from "./account-error";
import { CREATE_ACCOUNT_FAILURE, REISSUE_FAILURE } from "./constants";

type AdminUsersBody = { op: "create"; email: string; role: string | null } | { op: "reissue"; userId: string };

/**
 * Call the `admin-users` Edge Function as the admin, with their own session: `functions.invoke`
 * forwards the session's access token, which is all the function trusts. The Worker is a courier. It
 * holds no secret key and adds no environment: the function holds the privilege, and refuses anyone
 * who is not a live admin.
 *
 * Returns the one-time password the function reveals. Any refusal throws a `DomainError` with fixed
 * wording (see `toAccountError`); a response body is never read into a message, and the password
 * is never logged.
 */
export async function invokeAdminUsers(supabase: SupabaseClient, body: AdminUsersBody): Promise<TemporaryPassword> {
  const operation: AccountOperation = body.op;
  const result = await supabase.functions.invoke<unknown>("admin-users", { body });
  // Typed `any` by the library: narrowed here, so nothing downstream reads an unchecked value.
  const error: unknown = result.error;
  const data: unknown = result.data;
  if (error) throw toAccountError(operation, error instanceof FunctionsHttpError ? statusOf(error) : null);
  return revealed(data, operation);
}

const statusOf = (error: FunctionsHttpError): number | null => {
  const context: unknown = error.context;
  return context instanceof Response ? context.status : null;
};

// The success body, narrowed to the two strings it must hold. Anything else is a failure, never a
// half-answer: an account whose password nobody saw is the case to refuse loudly.
const revealed = (data: unknown, operation: AccountOperation): TemporaryPassword => {
  if (isRecord(data) && typeof data.userId === "string" && typeof data.password === "string") {
    return { userId: data.userId, password: data.password };
  }
  throw new DomainError("INTERNAL_SERVER_ERROR", operation === "create" ? CREATE_ACCOUNT_FAILURE : REISSUE_FAILURE);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
