// The two operations, `create` and `reissue`, and the order every security-relevant step runs in.
//
// THE ORDER IS THE DESIGN.
//
//   1. `withSupabase({ auth: "user" })` has verified the JWT against the project's JWKS (index.ts).
//      That proves only that the token is genuine: the solver's machine token passes it too.
//   2. `own_app_role` must answer `admin`, live, as the caller. Nothing below touches the secret-key
//      client (`ctx.supabaseAdmin`) until it does, so a caller who is not an admin, or who is an
//      admin still on a temporary password, never reaches a privileged write.
//   3. Only then is the body read and validated, so a caller who is not an admin learns nothing about
//      the validator.
//   4. The password is revealed last, in the response, after every write has succeeded. A failure
//      undoes what it can and returns no password.
//
// TWO IDENTITIES. `ctx.supabase` is the admin's own session: anything RLS or a trigger should judge
// goes through it, so the role grant is attributed to the admin by S-406's trigger. `ctx.supabaseAdmin`
// is the secret-key client, used only for what truly needs it: the Auth Admin API, the directory flag
// and the two access records it alone may write.
//
// NEVER LOG OR RETURN THE PASSWORD anywhere but the success body. Failures log a step name and an
// error code, nothing from a request or response body.
import type { SupabaseContext } from "@supabase/server";
import { generatePassword } from "./password.ts";
import { type AdminRequest, parseRequest, type Role } from "./request.ts";

type Admin = SupabaseContext["supabaseAdmin"];
type Session = SupabaseContext["supabase"];

// A request body is a few dozen bytes; refuse anything absurd before parsing it.
const MAX_BODY_BYTES = 4096;

export async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== "POST") return reply(405, "method_not_allowed");

  const refusal = await requireAdmin(ctx.supabase);
  if (refusal) return refusal;
  const actorId = ctx.userClaims?.id;
  if (!actorId) return reply(401, "unauthorized");

  const parsed = await readRequest(req);
  if (!parsed.ok) return reply(422, "invalid_input");

  return parsed.request.op === "create"
    ? await create(ctx, actorId, parsed.request)
    : await reissue(ctx.supabaseAdmin, actorId, parsed.request);
}

// create ----------------------------------------------------------------------------------------

type Create = Extract<AdminRequest, { op: "create" }>;

/** Create, flag, record, grant, then reveal. */
const create = async (ctx: SupabaseContext, actorId: string, { email, role }: Create): Promise<Response> => {
  const admin = ctx.supabaseAdmin;
  const password = generatePassword();

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) return createFailure(created.error);
  const userId = created.data.user.id;

  const failedStep = await firstFailure([
    ["flag", () => setPending(admin, userId)],
    ["record", () => recordAccess(admin, { kind: "account_created", actorId, targetId: userId, newRole: role })],
    ["grant", () => grantRole(ctx.supabase, userId, role)],
  ]);
  if (failedStep) {
    await discard(admin, userId);
    return failure("create", failedStep);
  }
  return reveal(userId, password);
};

const createFailure = (error: { code?: string; status?: number }): Response => {
  if (error.code === "email_exists" || error.code === "user_already_exists") return reply(409, "email_exists");
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return reply(422, "invalid_input");
  return failure("create", `createUser:${error.code ?? error.status ?? "unknown"}`);
};

/**
 * Undo a half-made account. Deleting the Auth user cascades its directory row and role row. If even
 * that fails the account exists with a password nobody was given, and the log says so.
 */
const discard = async (admin: Admin, userId: string): Promise<void> => {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) console.error(JSON.stringify({ fn: "admin-users", step: "discard", code: error.code ?? error.status }));
};

// reissue ---------------------------------------------------------------------------------------

type Reissue = Extract<AdminRequest, { op: "reissue" }>;

/** Recover a lost or timed-out temporary password, for an account that is still pending. */
const reissue = async (admin: Admin, actorId: string, { userId }: Reissue): Promise<Response> => {
  const target = await admin
    .from("user_directory")
    .select("is_machine, must_change_password")
    .eq("user_id", userId)
    .maybeSingle();
  if (target.error) return failure("reissue", `lookup:${target.error.code}`);
  if (!target.data) return reply(404, "not_found");
  // A machine user is never pending; an account that chose its own password is no longer pending.
  if (target.data.is_machine || !target.data.must_change_password) return reply(409, "not_pending");

  const password = generatePassword();
  const written = await admin.auth.admin.updateUserById(userId, { password });
  if (written.error) return failure("reissue", `updateUser:${written.error.code ?? written.error.status}`);

  // The password write cleared the flag (the Auth trigger sees a real password change), so set it
  // again. If this fails the account is left with a password nobody holds, and a retry fixes it.
  const failedStep = await firstFailure([
    ["flag", () => setPending(admin, userId)],
    ["record", () => recordAccess(admin, { kind: "password_reissued", actorId, targetId: userId, newRole: null })],
  ]);
  if (failedStep) return failure("reissue", failedStep);
  return reveal(userId, password);
};

// shared steps ----------------------------------------------------------------------------------

/** The caller must be an admin who can act now: `own_app_role` reads null for a pending admin. */
const requireAdmin = async (session: Session): Promise<Response | null> => {
  const { data, error } = await session.rpc("own_app_role");
  // 42501: the caller's database role has no EXECUTE on it, which is the solver's machine token.
  if (error?.code === "42501") return reply(403, "forbidden");
  if (error) return failure("admin-check", `rpc:${error.code ?? "unknown"}`);
  return data === "admin" ? null : reply(403, "forbidden");
};

const readRequest = async (req: Request) => {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false as const };
  try {
    return parseRequest(JSON.parse(text));
  } catch {
    return { ok: false as const };
  }
};

/** Fence the account: `private.current_app_role()` reads null while the flag is set. */
const setPending = async (admin: Admin, userId: string): Promise<string | null> => {
  const { data, error } = await admin
    .from("user_directory")
    .update({ must_change_password: true })
    .eq("user_id", userId)
    .select("user_id");
  if (error) return `db:${error.code}`;
  return data.length === 1 ? null : "db:no-directory-row";
};

type AccessRecord = {
  kind: "account_created" | "password_reissued";
  actorId: string;
  targetId: string;
  newRole: Role | null;
};

/**
 * The record an admin cannot write for themselves: the secret-key client, with the actor taken from
 * the verified token, so it reads "by <admin>" and never "Operator".
 */
const recordAccess = async (admin: Admin, { kind, actorId, targetId, newRole }: AccessRecord) => {
  const { error } = await admin.from("access_changes").insert({
    kind,
    actor_kind: "user",
    actor_id: actorId,
    target_id: targetId,
    new_role: newRole,
  });
  return error ? `db:${error.code}` : null;
};

/** Through the admin's own session: S-406's trigger records the grant against the admin. */
const grantRole = async (session: Session, userId: string, role: Role | null): Promise<string | null> => {
  if (role === null) return null;
  const { error } = await session.from("user_roles").insert({ user_id: userId, role });
  return error ? `db:${error.code}` : null;
};

/** Runs the steps in order and stops at the first that fails, naming it. */
const firstFailure = async (steps: readonly (readonly [string, () => Promise<string | null>])[]) => {
  for (const [name, run] of steps) {
    const detail = await run();
    if (detail) return `${name}:${detail}`;
  }
  return null;
};

// responses -------------------------------------------------------------------------------------

/** The only response that carries a password. Never cached. */
const reveal = (userId: string, password: string): Response => reply(200, { userId, password });

/** Logs a step and a code only, and answers 500 with no detail and no password. */
const failure = (op: string, step: string): Response => {
  console.error(JSON.stringify({ fn: "admin-users", op, step }));
  return reply(500, "failed");
};

const reply = (status: number, body: string | Record<string, string>): Response =>
  Response.json(typeof body === "string" ? { error: body } : body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
