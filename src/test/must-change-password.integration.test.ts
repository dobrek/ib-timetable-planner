import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updatePassword } from "@/_pages/account/api/update-password";
import { parseEmailLink, requestPasswordReset, verifyEmailLink } from "@/_pages/password-recovery";
import type { Database, SupabaseClient } from "@/shared/api";
import { createAuthUser, createSignedInUser, type SignedInUser, teardown } from "@/test/factories";
import { deleteMessages, messagesTo, readMessage, waitForMessageTo } from "./mailpit";
import { createPublishableClient } from "./publishable-client";
import { readPublishableKey } from "./publishable-key";

/**
 * S-409's flag, end to end against the real local GoTrue: a user holds an `admin` row and the
 * `must_change_password` flag, and what the matrix cannot express is how the flag behaves over a
 * life. The matrix proves the fenced state denies everything (`pendingAdmin`); this proves what
 * moves the flag, and what must not.
 *
 * - **Moves it:** a real password change by the user, by the reset link, and by the Admin API (the
 *   re-issue path, which the Edge Function follows by setting the flag again).
 * - **Must not:** signing in, a refused password change (same password, too short), an email
 *   change, the user's own attempts to write the flag or their role.
 *
 * Every user is a `createSignedInUser` with a role and the flag, so each starts as the Edge
 * Function leaves a created account: role granted, flag set, never signed in with a password of
 * their own choosing. Reads of the flag go through the service role: the flag is the subject here,
 * and `own_app_role` is the session's own view of it.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

const INSUFFICIENT_PRIVILEGE = "42501";

(hasEnv ? describe : describe.skip)("must-change-password flag (local Supabase)", { timeout: 30_000 }, () => {
  let admin: SupabaseClient;
  const ownMail = new Set<string>();

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    try {
      if (ownMail.size > 0) await deleteMessages([...ownMail]);
    } finally {
      await teardown(admin);
    }
  });

  it("starts fenced: the role row exists, the session sees no role, and a new sign-in leaves the flag set", async () => {
    const user = await pendingAdmin();

    expect(await roleRowOf(user)).toBe("admin");
    expect(await flagOf(user)).toBe(true);
    expect(await ownAppRole(user.client)).toBeNull();

    const secondSession = signedOutClient();
    expect(
      (await secondSession.auth.signInWithPassword({ email: user.email, password: user.password })).error,
    ).toBeNull();
    expect(await ownAppRole(secondSession)).toBeNull();
    expect(await flagOf(user)).toBe(true);
  });

  it("refuses the user's own writes to the flag (42501) and to their role", async () => {
    const user = await pendingAdmin();

    const clearing = await user.client
      .from("user_directory")
      .update({ must_change_password: false })
      .eq("user_id", user.id);
    expect(clearing.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

    // The role write reaches no row: the update policy asks for `manage_users`, which a fenced admin lacks.
    await user.client.from("user_roles").update({ role: "author" }).eq("user_id", user.id);
    expect(await roleRowOf(user)).toBe("admin");
    expect(await flagOf(user)).toBe(true);
  });

  it("clears on a real password change, and the same session then holds the role", async () => {
    const user = await pendingAdmin();

    await updatePassword(user.client, { password: strongPassword() });

    expect(await flagOf(user)).toBe(false);
    expect(await ownAppRole(user.client)).toBe("admin");
  });

  it("clears on the Admin API's password write, the path a re-issue takes", async () => {
    const user = await pendingAdmin();

    const { error } = await admin.auth.admin.updateUserById(user.id, { password: strongPassword() });

    expect(error).toBeNull();
    expect(await flagOf(user)).toBe(false);
  });

  it("stays set when the new password is the same as the temporary one", async () => {
    const user = await pendingAdmin();

    const { error } = await user.client.auth.updateUser({ password: user.password });

    expect(error).not.toBeNull();
    expect(await flagOf(user)).toBe(true);
    expect(await ownAppRole(user.client)).toBeNull();
  });

  it("stays set when the new password is shorter than the policy's 15 characters", async () => {
    const user = await pendingAdmin();

    const { error } = await user.client.auth.updateUser({ password: "Short1!" });

    expect(error).not.toBeNull();
    expect(await flagOf(user)).toBe(true);
  });

  it("clears on the reset-link path: verify the link, then choose a password", async () => {
    const user = await pendingAdmin();
    const before = (await messagesTo(user.email)).at(0);
    expect((await requestPasswordReset(signedOutClient(), user.email)).outcome).toBe("accepted");
    const message = await waitForMessageTo(user.email, before ? { after: before.Created } : {});
    ownMail.add(message.ID);
    const url = [...(await readMessage(message.ID)).HTML.matchAll(/https?:\/\/[^\s"'<>)]+/g)]
      .map(([found]) => found.replaceAll("&amp;", "&"))
      .at(0);
    const link = url ? parseEmailLink(new URL(url).searchParams) : null;
    if (!link) throw new Error("the reset mail carries no link");
    const session = signedOutClient();

    expect(await verifyEmailLink(session, link)).toEqual({ ok: true });
    // Verifying spends the link and signs the user in, but chooses no password.
    expect(await flagOf(user)).toBe(true);
    expect(await ownAppRole(session)).toBeNull();

    await updatePassword(session, { password: strongPassword() });

    expect(await flagOf(user)).toBe(false);
    expect(await ownAppRole(session)).toBe("admin");
  });

  it("leaves the flag alone on an email change: the mirror's upsert never touches it", async () => {
    const user = await pendingAdmin();
    const newEmail = `moved-${randomUUID()}@example.test`;

    const { error } = await admin.auth.admin.updateUserById(user.id, { email: newEmail, email_confirm: true });

    expect(error).toBeNull();
    const { data } = await admin.from("user_directory").select("email, must_change_password").eq("user_id", user.id);
    expect(data).toEqual([{ email: newEmail, must_change_password: true }]);
  });

  it("is false for every user that existed before the flag: a plain user and an admin read as before", async () => {
    const author = await createSignedInUser(admin, { role: "author" });
    const plain = await createAuthUser(admin);

    expect(await flagOf(author)).toBe(false);
    expect(await ownAppRole(author.client)).toBe("author");
    expect(await flagOf(plain)).toBe(false);
  });

  /** A user in the state the Edge Function leaves a created account: role granted, flag set. */
  const pendingAdmin = (): Promise<SignedInUser> =>
    createSignedInUser(admin, { role: "admin", mustChangePassword: true });

  const flagOf = async ({ id }: { id: string }): Promise<boolean> => {
    const { data, error } = await admin
      .from("user_directory")
      .select("must_change_password")
      .eq("user_id", id)
      .single();
    if (error) throw new Error(`flagOf: ${error.message}`);
    return data.must_change_password;
  };

  const roleRowOf = async ({ id }: { id: string }): Promise<string | null> => {
    const { data, error } = await admin.from("user_roles").select("role").eq("user_id", id).maybeSingle();
    if (error) throw new Error(`roleRowOf: ${error.message}`);
    return data?.role ?? null;
  };
});

/** The session's own view of its role: what `private.current_app_role()` answers for it. */
const ownAppRole = async (client: SupabaseClient): Promise<string | null> => {
  const { data, error } = await client.rpc("own_app_role");
  if (error) throw new Error(`own_app_role: ${error.message}`);
  return data;
};

// 40 characters, all four classes, no `#`, quotes or whitespace — like `createSignedInUser`'s own.
const strongPassword = (): string => `${randomUUID()}Aa1!`;

const signedOutClient = (): SupabaseClient => {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) throw new Error("no local Supabase env");
  return createPublishableClient(SUPABASE_URL, PUBLISHABLE_KEY);
};
