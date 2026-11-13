import { FunctionsHttpError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@/shared/api";
import type { AppRole } from "@/shared/config";
import type { AccountTarget, InvitationSent, InvitationTarget, TemporaryPassword } from "../model/schemas";
import { isClosedConflict, outcomeUnknown, toAccountError, type AccountOperation } from "./account-error";

/** The function's request shapes, one per operation (its `request.ts` accepts exactly these). */
export type AdminUsersBody =
  | { op: "create"; email: string; role: AppRole | null }
  | { op: "reissue"; userId: string }
  | { op: "invite"; email: string; role: AppRole }
  | { op: "resend"; userId: string }
  | { op: "revoke"; userId: string }
  | { op: "ban"; userId: string }
  | { op: "unban"; userId: string }
  | { op: "delete"; userId: string }
  | { op: "change_email"; userId: string; email: string };

/** What each operation answers on success. */
type AdminUsersResults = {
  create: TemporaryPassword;
  reissue: TemporaryPassword;
  invite: InvitationSent;
  resend: InvitationTarget;
  revoke: InvitationTarget;
  ban: AccountTarget;
  unban: AccountTarget;
  delete: AccountTarget;
  change_email: AccountTarget;
};

/**
 * Call the `admin-users` Edge Function as the admin, with their own session: `functions.invoke`
 * forwards the session's access token, which is all the function trusts. The Worker is a courier. It
 * holds no secret key and adds no environment: the function holds the privilege, and refuses anyone
 * who is not a live admin.
 *
 * Returns the operation's own result: the one-time password for `create` and `reissue`, the account
 * (and whether it was a re-send) for the invitation operations. Any refusal throws a `DomainError`
 * with fixed wording (see `toAccountError`); a response body is never read into a message, and a
 * password is never logged.
 */
export async function invokeAdminUsers<Body extends AdminUsersBody>(
  supabase: SupabaseClient,
  body: Body,
): Promise<AdminUsersResults[Body["op"]]> {
  const operation: Body["op"] = body.op;
  const result = await supabase.functions.invoke<unknown>("admin-users", { body });
  // Typed `any` by the library: narrowed here, so nothing downstream reads an unchecked value.
  const error: unknown = result.error;
  const data: unknown = result.data;
  if (error) {
    const status = error instanceof FunctionsHttpError ? statusOf(error) : null;
    const conflict = error instanceof FunctionsHttpError && status === 409 ? await conflictCodeOf(error) : null;
    throw toAccountError(operation, status, conflict);
  }
  const read: Reader<Body["op"]> = READERS[operation];
  const answer = read(data);
  if (answer === null) throw outcomeUnknown(operation);
  return answer;
}

const statusOf = (error: FunctionsHttpError): number | null => {
  const context: unknown = error.context;
  return context instanceof Response ? context.status : null;
};

/**
 * A 409's closed code, or null. The function's other text is dropped: only `last_admin`,
 * `email_exists` and `not_allowed` are read, and each is mapped to a local sentence.
 */
const conflictCodeOf = async (error: FunctionsHttpError): Promise<string | null> => {
  const context: unknown = error.context;
  if (!(context instanceof Response)) return null;
  try {
    const body: unknown = await context.clone().json();
    return isRecord(body) && typeof body.error === "string" && isClosedConflict(body.error) ? body.error : null;
  } catch {
    return null;
  }
};

type Reader<Operation extends AccountOperation> = (data: unknown) => AdminUsersResults[Operation] | null;

// Each success body, narrowed to the fields it must hold. Anything else is a failure, never a
// half-answer: an account whose password nobody saw is the case to refuse loudly.
const readPassword = (data: unknown): TemporaryPassword | null =>
  isRecord(data) && typeof data.userId === "string" && typeof data.password === "string"
    ? { userId: data.userId, password: data.password }
    : null;

const readInvitation = (data: unknown): InvitationSent | null =>
  isRecord(data) && typeof data.userId === "string" && typeof data.resent === "boolean"
    ? { userId: data.userId, resent: data.resent }
    : null;

const readTarget = (data: unknown): InvitationTarget | null =>
  isRecord(data) && typeof data.userId === "string" ? { userId: data.userId } : null;

const READERS: { readonly [Operation in AccountOperation]: Reader<Operation> } = {
  create: readPassword,
  reissue: readPassword,
  invite: readInvitation,
  resend: readTarget,
  revoke: readTarget,
  ban: readTarget,
  unban: readTarget,
  delete: readTarget,
  change_email: readTarget,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
