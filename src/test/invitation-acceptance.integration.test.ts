import { createClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updatePassword } from "@/_pages/account/api/update-password";
import { requestPasswordReset, verifyEmailLink } from "@/_pages/password-recovery";
import type { Database, SupabaseClient } from "@/shared/api";
import { createAuthUser, createInvitedUser, type InvitedUser, strongPassword, teardown } from "@/test/factories";
import { linkIn } from "./email-links";
import { deleteMessages, waitForMessageTo } from "./mailpit";
import { connectPostgres } from "./postgres-client";
import { signedOutClient } from "./publishable-client";
import { readPublishableKey } from "./publishable-key";

/**
 * S-410's fence through acceptance, against the real local GoTrue. An invitee holds their role row
 * and the `must_change_password` flag from the moment they are invited, and must keep the flag
 * until they choose a password of their own:
 *
 * - **Accepting the link must not lift it.** GoTrue writes a random password while it confirms an
 *   invitee (`signupVerify`), which fired the clear trigger before the migration narrowed it to
 *   confirmed users (probe.md P3).
 * - **Neither must a reset link** spent by an invitee who never accepted (probe.md P4).
 * - **An accepted-but-unfinished admin** does not count for the last-admin guard: they are the role
 *   matrix's `pendingAdmin` principal, so the matrix needs no new column.
 *
 * Setup is the service role, which proves behaviour, not access control; the invitee's own view of
 * their role is a publishable-key session (`own_app_role`). Reads of the flag and the mirror go
 * through the service role: they are the subject here.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

const LAST_ADMIN = "PT409";

type DirectoryState = { must_change_password: boolean; invited_at: string | null; email_confirmed_at: string | null };

(hasEnv ? describe : describe.skip)("invitation acceptance (local Supabase)", { timeout: 30_000 }, () => {
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

  it("mirrors an invitation into the directory: invited, not yet confirmed, as GoTrue records it", async () => {
    const invitee = await createInvitedUser(admin);

    const row = await directoryOf(invitee);
    const { data, error } = await admin.auth.admin.getUserById(invitee.id);
    if (error) throw new Error(`getUserById: ${error.message}`);

    expect(row.invited_at).not.toBeNull();
    expect(Date.parse(row.invited_at ?? "")).toBe(Date.parse(data.user.invited_at ?? ""));
    expect(row.email_confirmed_at).toBeNull();
    expect(row.must_change_password).toBe(false);
  });

  it("keeps the fence when the invitee spends their link, and lifts it on the password they choose", async () => {
    const invitee = await createInvitedUser(admin, { role: "viewer", mustChangePassword: true });
    const session = signedOutClient();

    const { error } = await session.auth.verifyOtp({ type: "invite", token_hash: invitee.tokenHash });

    expect(error).toBeNull();
    const accepted = await directoryOf(invitee);
    expect(accepted.must_change_password).toBe(true);
    expect(accepted.email_confirmed_at).not.toBeNull();
    expect(await ownAppRole(session)).toBeNull();

    await updatePassword(session, { password: strongPassword() });

    expect((await directoryOf(invitee)).must_change_password).toBe(false);
    expect(await ownAppRole(session)).toBe("viewer");
  });

  it("keeps the fence when an unaccepted invitee spends a reset link instead, until they choose a password", async () => {
    const invitee = await createInvitedUser(admin, { role: "author", mustChangePassword: true });
    expect((await requestPasswordReset(signedOutClient(), invitee.email)).outcome).toBe("accepted");
    const message = await waitForMessageTo(invitee.email);
    ownMail.add(message.ID);
    const link = await linkIn(message);
    const session = signedOutClient();

    expect(link.type).toBe("recovery");
    expect(await verifyEmailLink(session, link)).toEqual({ ok: true });
    const recovered = await directoryOf(invitee);
    expect(recovered.email_confirmed_at).not.toBeNull();
    expect(recovered.must_change_password).toBe(true);
    expect(await ownAppRole(session)).toBeNull();

    await updatePassword(session, { password: strongPassword() });

    expect((await directoryOf(invitee)).must_change_password).toBe(false);
    expect(await ownAppRole(session)).toBe("author");
  });

  it("does not count an accepted-but-unfinished invited admin as an admin who can act", async () => {
    const active = await adminUser();
    const invitee = await createInvitedUser(admin, { role: "admin", mustChangePassword: true });
    const accepted = await signedOutClient().auth.verifyOtp({ type: "invite", token_hash: invitee.tokenHash });
    expect(accepted.error).toBeNull();
    expect((await directoryOf(invitee)).must_change_password).toBe(true);

    // The same isolation as last-admin-guard.integration.test.ts: one rolled-back transaction, with
    // `user_roles` locked so no parallel file adds or removes an admin, and every other admin demoted
    // in it alone. Users are created before the lock, never during.
    const outcomes = await inRolledBackTransaction(async (pg) => {
      await pg.query("set local lock_timeout = '5s'");
      await pg.query("lock table public.user_roles in exclusive mode");
      await pg.query(
        "update public.user_roles set role = 'author' where role = 'admin' and user_id <> all ($1::uuid[])",
        [[active, invitee.id]],
      );
      return {
        invitedAdminIsNotCounted: await sqlstateOf(pg, [demote(active)]),
        // The control: the same invitee, once their password clears the flag, keeps the school an admin.
        countsOnceFinished: await sqlstateOf(pg, [
          {
            sql: "update public.user_directory set must_change_password = false where user_id = $1",
            params: [invitee.id],
          },
          demote(active),
        ]),
      };
    });

    expect(outcomes).toEqual({ invitedAdminIsNotCounted: LAST_ADMIN, countsOnceFinished: null });
  });

  const directoryOf = async ({ id }: InvitedUser): Promise<DirectoryState> => {
    const { data, error } = await admin
      .from("user_directory")
      .select("must_change_password, invited_at, email_confirmed_at")
      .eq("user_id", id)
      .single();
    if (error) throw new Error(`directoryOf: ${error.message}`);
    return data;
  };

  /** A confirmed user holding `admin`, given by the service role (an operator write). */
  const adminUser = async (): Promise<string> => {
    const { id } = await createAuthUser(admin);
    const { error } = await admin.from("user_roles").insert({ user_id: id, role: "admin" });
    if (error) throw new Error(`adminUser: ${error.message}`);
    return id;
  };
});

/** The session's own view of its role: what `private.current_app_role()` answers for it. */
const ownAppRole = async (client: SupabaseClient): Promise<string | null> => {
  const { data, error } = await client.rpc("own_app_role");
  if (error) throw new Error(`own_app_role: ${error.message}`);
  return data;
};

type Statement = { sql: string; params?: unknown[] };

const demote = (userId: string): Statement => ({
  sql: "update public.user_roles set role = 'author' where user_id = $1",
  params: [userId],
});

/** Run `work` on a fresh connection inside a transaction that always rolls back. */
const inRolledBackTransaction = async <T>(work: (pg: Client) => Promise<T>): Promise<T> => {
  const pg = await connectPostgres();
  try {
    await pg.query("begin");
    return await work(pg);
  } finally {
    await pg.query("rollback");
    await pg.end();
  }
};

/** Run statements in a savepoint, roll back to it whatever happened, and return the SQLSTATE that stopped them. */
const sqlstateOf = async (pg: Client, statements: Statement[]): Promise<string | null> => {
  await pg.query("savepoint invitation_case");
  try {
    await statements.reduce<Promise<unknown>>(async (previous, { sql, params }) => {
      await previous;
      return pg.query(sql, params);
    }, Promise.resolve());
    return null;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
      return error.code;
    }
    throw error;
  } finally {
    await pg.query("rollback to savepoint invitation_case");
  }
};
