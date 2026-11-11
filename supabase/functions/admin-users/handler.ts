// The five operations, `create`, `reissue` (S-409), `invite`, `resend` and `revoke` (S-410), and
// the order every security-relevant step runs in.
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
//   5. The invitation email is sent last, after the account is fenced, recorded and granted. A new
//      address is made by `generateLink({ type: "invite" })`, which sends nothing, and the email comes
//      from `inviteUserByEmail`, whose newer link kills the first (probe.md P2). Any failure up to
//      and including the send deletes the account, so no live link ever belongs to a half-made or
//      unfenced account. The re-send path sets the flag again before it sends, so an invitation made
//      earlier from the dashboard, with no flag, cannot be accepted unfenced either.
//
// TWO IDENTITIES. `ctx.supabase` is the admin's own session: anything RLS or a trigger should judge
// goes through it, so the role grant is attributed to the admin by S-406's trigger. `ctx.supabaseAdmin`
// is the secret-key client, used only for what truly needs it: the Auth Admin API, the directory flag
// and lookups, and the access records it alone may write.
//
// AN INVITATION IS PENDING while it is unaccepted: `invited_at` set, `email_confirmed_at` null, not a
// machine. Only then can it be re-sent: GoTrue refuses to invite a confirmed address. It can be
// revoked until the person chooses a password (still flagged), so the admin always has a stop.
// Revoke deletes the never-used account. Its check and its delete are not atomic: an invitee who
// chooses a password in that instant loses the account they just finished. Accepted, for a handful
// of invitations; S-411 owns removing confirmed accounts.
//
// THE RE-SEND COOLDOWN is ours to enforce: GoTrue's per-user interval does not cover invites, and
// every email spends the shared daily sending cap. `invited_at` moves on every send.
//
// NEVER LOG OR RETURN THE PASSWORD anywhere but the success body, and never log an email address or a
// token. Failures log the operation, a step name and an error code, nothing from a request or
// response body.
import type { SupabaseContext } from "@supabase/server";
import { generatePassword } from "./password.ts";
import { type AdminRequest, parseRequest, type Role } from "./request.ts";

type Admin = SupabaseContext["supabaseAdmin"];
type Session = SupabaseContext["supabase"];

// A request body is a few dozen characters; refuse anything absurd before parsing it.
const MAX_BODY_CHARS = 4096;

/** How soon after the newest invitation another may be sent. */
export const RESEND_COOLDOWN_SECONDS = 60;

export async function handle(req: Request, ctx: SupabaseContext): Promise<Response> {
  if (req.method !== "POST") return reply(405, "method_not_allowed");

  const refusal = await requireAdmin(ctx.supabase);
  if (refusal) return refusal;
  const actorId = ctx.userClaims?.id;
  if (!actorId) return reply(401, "unauthorized");

  const request = await readRequest(req);
  if (!request) return reply(422, "invalid_input");

  switch (request.op) {
    case "create":
      return await create(ctx, actorId, request);
    case "reissue":
      return await reissue(ctx.supabaseAdmin, actorId, request);
    case "invite":
      return await invite(ctx, actorId, request);
    case "resend":
      return await resend(ctx, actorId, request);
    case "revoke":
      return await revoke(ctx.supabaseAdmin, actorId, request);
  }
}

// create ----------------------------------------------------------------------------------------

type Create = Extract<AdminRequest, { op: "create" }>;

/** Create, flag, record, grant, then reveal. */
const create = async (ctx: SupabaseContext, actorId: string, { email, role }: Create): Promise<Response> => {
  const admin = ctx.supabaseAdmin;
  const password = generatePassword();

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) return authFailure("create", "createUser", created.error);
  const userId = created.data.user.id;

  // On a failure, `discard` deletes the account and, by cascade, its directory and role rows. An
  // `account_created` record already written stays, its target set to null: the record of an attempt.
  const failedStep = await firstFailure([
    ["flag", () => setPending(admin, userId)],
    ["record", () => recordAccess(admin, { kind: "account_created", actorId, targetId: userId, newRole: role })],
    ["grant", () => grantRole(ctx.supabase, userId, role)],
  ]);
  if (failedStep) {
    await discard(admin, "create", userId);
    return failure("create", failedStep);
  }
  return reveal(userId, password);
};

// reissue ---------------------------------------------------------------------------------------

type Reissue = Extract<AdminRequest, { op: "reissue" }>;

/** Recover a lost or timed-out temporary password, for an account that is still pending. */
const reissue = async (admin: Admin, actorId: string, { userId }: Reissue): Promise<Response> => {
  const target = await directoryById(admin, userId);
  if (target.error) return failure("reissue", `lookup:${target.error}`);
  if (!target.row) return reply(404, "not_found");
  // A machine user is never pending; an account that chose its own password is no longer pending; an
  // invitee's answer is a re-send or a revoke, never a password nobody asked for.
  const { is_machine, must_change_password, invited_at } = target.row;
  if (is_machine || !must_change_password || invited_at !== null) return reply(409, "not_pending");

  const password = generatePassword();
  const written = await admin.auth.admin.updateUserById(userId, { password });
  if (written.error) return failure("reissue", `updateUser:${codeOf(written.error)}`);

  // The password write cleared the flag (the Auth trigger sees a real password change), so set it
  // again; `setPending` tries twice. If both attempts fail, the account is left unfenced with a
  // password nobody holds, and a re-issue is refused from then on, because the cleared flag reads as a
  // chosen password. The person recovers by a reset email, or an admin removes the role. The log
  // names the step `flag-lost`.
  const failedStep = await firstFailure([
    ["flag-lost", () => setPending(admin, userId)],
    ["record", () => recordAccess(admin, { kind: "password_reissued", actorId, targetId: userId, newRole: null })],
  ]);
  if (failedStep) return failure("reissue", failedStep);
  return reveal(userId, password);
};

// invite ----------------------------------------------------------------------------------------

type Invite = Extract<AdminRequest, { op: "invite" }>;

/**
 * Invite an address with a role. A pending invitation to the same address is re-sent, with the role
 * the admin chose now (FR-401). Any other account at that address is refused, with nothing sent.
 */
const invite = async (ctx: SupabaseContext, actorId: string, { email, role }: Invite): Promise<Response> => {
  const admin = ctx.supabaseAdmin;
  const existing = await directoryByEmail(admin, email);
  if (existing.error) return failure("invite", `lookup:${existing.error}`);
  if (existing.row) {
    if (!isPendingInvitation(existing.row)) return reply(409, "email_exists");
    const resent = await resendTo(ctx, actorId, "invite", existing.row, role);
    return resent ?? reply(200, { userId: existing.row.user_id, resent: true });
  }

  // Creates the unconfirmed user and sends nothing. Its token is never read: the email carries a newer one.
  const linked = await admin.auth.admin.generateLink({ type: "invite", email });
  if (linked.error) return authFailure("invite", "generateLink", linked.error);
  const userId = linked.data.user.id;

  const failedStep = await firstFailure([
    ["flag", () => setPending(admin, userId)],
    ["record", () => recordAccess(admin, { kind: "invitation_sent", actorId, targetId: userId, newRole: role })],
    ["grant", () => setRole(ctx.supabase, userId, role)],
    ["send", () => sendInvitation(admin, "invite", userId, email)],
  ]);
  if (failedStep) {
    await discard(admin, "invite", userId);
    return failure("invite", failedStep);
  }
  return reply(200, { userId, resent: false });
};

// resend ----------------------------------------------------------------------------------------

type Resend = Extract<AdminRequest, { op: "resend" }>;

/** Send a pending invitation again: a new link, and the old one dies. */
const resend = async (ctx: SupabaseContext, actorId: string, { userId }: Resend): Promise<Response> => {
  const target = await directoryById(ctx.supabaseAdmin, userId);
  if (target.error) return failure("resend", `lookup:${target.error}`);
  if (!target.row) return reply(404, "not_found");
  if (!isPendingInvitation(target.row)) return reply(409, "not_pending");
  const resent = await resendTo(ctx, actorId, "resend", target.row, null);
  return resent ?? reply(200, { userId });
};

/**
 * The re-send path, shared by `resend` and an `invite` to a pending address: cooldown, then fence,
 * then the role when an invite names one, then record, then send. Answers null on success. A
 * failure deletes nothing: the account was whole before this, and stays so.
 */
const resendTo = async (
  ctx: SupabaseContext,
  actorId: string,
  op: "invite" | "resend",
  target: DirectoryRow,
  role: Role | null,
): Promise<Response | null> => {
  if (withinCooldown(target.invited_at)) return reply(429, "too_soon");
  const admin = ctx.supabaseAdmin;
  const userId = target.user_id;
  const email = target.email;
  if (email === null) return failure(op, "lookup:no-email");

  // Fenced only while still unaccepted: someone who accepted and chose a password since the lookup
  // (or whose invitation was revoked) is no longer pending, and must not be fenced again.
  const fenced = await fenceUnaccepted(admin, userId);
  if (fenced === NOT_PENDING) return reply(409, "not_pending");
  if (fenced) return failure(op, `flag:${fenced}`);

  const failedStep = await firstFailure([
    ["grant", () => (role === null ? Promise.resolve(null) : changeRoleIfDifferent(ctx.supabase, userId, role))],
    ["record", () => recordAccess(admin, { kind: "invitation_resent", actorId, targetId: userId, newRole: role })],
    ["send", () => sendInvitation(admin, op, userId, email)],
  ]);
  return failedStep ? failure(op, failedStep) : null;
};

/** The newest invitation went out less than the cooldown ago. `invited_at` moves on every send. */
const withinCooldown = (invitedAt: string | null): boolean =>
  invitedAt !== null && Date.now() - Date.parse(invitedAt) < RESEND_COOLDOWN_SECONDS * 1000;

// revoke ----------------------------------------------------------------------------------------

type Revoke = Extract<AdminRequest, { op: "revoke" }>;

/**
 * Withdraw an invitation the person has not finished: record it, then delete the never-used account.
 * The deleted account's link answers `otp_expired`, and the record's target becomes null (S-406's
 * ids-only rule): it keeps who revoked and when.
 */
const revoke = async (admin: Admin, actorId: string, { userId }: Revoke): Promise<Response> => {
  const target = await directoryById(admin, userId);
  if (target.error) return failure("revoke", `lookup:${target.error}`);
  if (!target.row) return reply(404, "not_found");
  if (!isRevocable(target.row)) return reply(409, "not_pending");

  const recorded = await recordAccess(admin, { kind: "invitation_revoked", actorId, targetId: userId, newRole: null });
  if (recorded) return failure("revoke", `record:${recorded}`);
  const deleted = await admin.auth.admin.deleteUser(userId);
  if (deleted.error) return failure("revoke", `delete:${codeOf(deleted.error)}`);
  return reply(200, { userId });
};

// the directory ---------------------------------------------------------------------------------

/** The mirror of `auth.users` the function judges an account by (S-406, S-409, S-410). */
type DirectoryRow = {
  user_id: string;
  email: string | null;
  is_machine: boolean;
  must_change_password: boolean;
  invited_at: string | null;
  email_confirmed_at: string | null;
};

type Lookup = { row: DirectoryRow | null; error: null } | { row: null; error: string };

const DIRECTORY_COLUMNS = "user_id, email, is_machine, must_change_password, invited_at, email_confirmed_at";

const directoryById = (admin: Admin, userId: string): Promise<Lookup> =>
  lookup(admin.from("user_directory").select(DIRECTORY_COLUMNS).eq("user_id", userId).maybeSingle());

/** GoTrue stores addresses lowercased, and the parser lowercases the request's. */
const directoryByEmail = (admin: Admin, email: string): Promise<Lookup> =>
  lookup(admin.from("user_directory").select(DIRECTORY_COLUMNS).eq("email", email).maybeSingle());

const lookup = async (query: PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<Lookup> => {
  const { data, error } = await query;
  if (error) return { row: null, error: codeOf(error) };
  return { row: (data as DirectoryRow | null) ?? null, error: null };
};

/** Invited, not yet accepted, and not a machine: the only state GoTrue will re-send to. */
const isPendingInvitation = (row: DirectoryRow): boolean =>
  !row.is_machine && row.invited_at !== null && row.email_confirmed_at === null;

/** Invited, and either unaccepted or accepted without a chosen password yet. */
const isRevocable = (row: DirectoryRow): boolean =>
  !row.is_machine && row.invited_at !== null && (row.email_confirmed_at === null || row.must_change_password);

// shared steps ----------------------------------------------------------------------------------

/** The caller must be an admin who can act now: `own_app_role` reads null for a pending admin. */
const requireAdmin = async (session: Session): Promise<Response | null> => {
  const { data, error } = await session.rpc("own_app_role");
  // 42501: the caller's database role has no EXECUTE on it, which is the solver's machine token.
  if (error?.code === "42501") return reply(403, "forbidden");
  if (error) return failure("admin-check", `rpc:${codeOf(error)}`);
  return data === "admin" ? null : reply(403, "forbidden");
};

const readRequest = async (req: Request): Promise<AdminRequest | null> => {
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) return null;
  try {
    return parseRequest(JSON.parse(text));
  } catch {
    return null;
  }
};

/** The Auth Admin API refused to make the account: a duplicate, bad input, or a failure. */
const authFailure = (op: string, step: string, error: { code?: string; status?: number }): Response => {
  if (error.code === "email_exists" || error.code === "user_already_exists") return reply(409, "email_exists");
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return reply(422, "invalid_input");
  return failure(op, `${step}:${codeOf(error)}`);
};

/**
 * Undo a half-made account. Deleting the Auth user cascades its directory row and role row. If even
 * that fails the account exists unfinished (a password nobody was given, or an invitation whose link
 * was never sent), and the log says so.
 */
const discard = async (admin: Admin, op: string, userId: string): Promise<void> => {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) logFailure(op, `discard:${codeOf(error)}`);
};

/**
 * Fence the account: `private.current_app_role()` reads null while the flag is set. Tried twice,
 * because after a re-issue's password write a lost flag cannot be retried by the admin.
 */
const setPending = async (admin: Admin, userId: string): Promise<string | null> => {
  const first = await writePending(admin, userId);
  return first === null ? null : await writePending(admin, userId);
};

/** `fenceUnaccepted` matched no row: the invitation was accepted or revoked since the lookup. */
const NOT_PENDING = "not-pending";

/**
 * The re-send path's fence: the flag, set only on a row whose invitation is still unaccepted, in
 * one conditional write, so the check and the write cannot be split by an acceptance.
 */
const fenceUnaccepted = async (admin: Admin, userId: string): Promise<string | null> => {
  const { data, error } = await admin
    .from("user_directory")
    .update({ must_change_password: true })
    .eq("user_id", userId)
    .is("email_confirmed_at", null)
    .select("user_id");
  if (error) return `db:${codeOf(error)}`;
  return data.length === 1 ? null : NOT_PENDING;
};

const writePending = async (admin: Admin, userId: string): Promise<string | null> => {
  const { data, error } = await admin
    .from("user_directory")
    .update({ must_change_password: true })
    .eq("user_id", userId)
    .select("user_id");
  if (error) return `db:${codeOf(error)}`;
  return data.length === 1 ? null : "db:no-directory-row";
};

type AccessRecord = {
  kind: "account_created" | "password_reissued" | "invitation_sent" | "invitation_resent" | "invitation_revoked";
  actorId: string;
  targetId: string;
  newRole: Role | null;
};

/**
 * The record an admin cannot write for themselves: the secret-key client, with the actor taken from
 * the verified token, so it reads "by <admin>" and never "Operator".
 */
const recordAccess = async (
  admin: Admin,
  { kind, actorId, targetId, newRole }: AccessRecord,
): Promise<string | null> => {
  const { error } = await admin.from("access_changes").insert({
    kind,
    actor_kind: "user",
    actor_id: actorId,
    target_id: targetId,
    new_role: newRole,
  });
  return error ? `db:${codeOf(error)}` : null;
};

/** Through the admin's own session: S-406's trigger records the grant against the admin. */
const grantRole = async (session: Session, userId: string, role: Role | null): Promise<string | null> => {
  if (role === null) return null;
  const { error } = await session.from("user_roles").insert({ user_id: userId, role });
  return error ? `db:${codeOf(error)}` : null;
};

/**
 * The Users page's role write: an upsert under the admin's session, recorded `role_granted` or
 * `role_changed` by S-406's trigger. An invite uses it rather than `grantRole`'s insert, so two
 * admins inviting one new address at once both succeed (two emails, the newer link wins) instead of
 * the second hitting the primary key and deleting the account the first is about to email.
 */
const setRole = async (session: Session, userId: string, role: Role): Promise<string | null> => {
  const { error } = await session.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id" });
  return error ? `db:${codeOf(error)}` : null;
};

/** A re-invite applies the role the admin chose now, and writes nothing when it is unchanged. */
const changeRoleIfDifferent = async (session: Session, userId: string, role: Role): Promise<string | null> => {
  const { data, error } = await session.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (error) return `db:${codeOf(error)}`;
  return (data as { role: Role } | null)?.role === role ? null : await setRole(session, userId, role);
};

/**
 * The only send: GoTrue's re-send path for an unconfirmed user, with a new link. No metadata, no
 * redirect. `inviteUserByEmail` also creates a user when the address has none, so a target deleted
 * since its lookup (a concurrent revoke, or another request's `discard`) would get a fresh account
 * in its place, with no flag and a live link. That account is deleted at once and the step fails.
 */
const sendInvitation = async (admin: Admin, op: string, userId: string, email: string): Promise<string | null> => {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
  if (error) return `auth:${codeOf(error)}`;
  if (data.user.id === userId) return null;
  await discard(admin, op, data.user.id);
  return "target-gone";
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
  logFailure(op, step);
  return reply(500, "failed");
};

/** The one log line a failure writes: the operation, the step and an error code, never a body. */
const logFailure = (op: string, step: string): void => {
  console.error(JSON.stringify({ fn: "admin-users", op, step }));
};

/** An Auth or database error's code, or its HTTP status: never its message, which can echo input. */
const codeOf = (error: { code?: string; status?: number }): string => String(error.code ?? error.status ?? "unknown");

const reply = (status: number, body: string | Record<string, string | boolean>): Response =>
  Response.json(typeof body === "string" ? { error: body } : body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
