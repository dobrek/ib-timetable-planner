import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, SupabaseClient } from "@/shared/api";
import {
  createAuthUser,
  createInvitedUser,
  createSignedInUser,
  type SignedInUser,
  strongPassword,
  teardown,
} from "@/test/factories";
import { urlsIn } from "./email-links";
import { registerUser } from "./factories/teardown";
import { deleteMessages, type MailSummary, messagesTo, readMessage, waitForMessageTo } from "./mailpit";
import { connectPostgres } from "./postgres-client";
import { signedOutClient } from "./publishable-client";
import { readPublishableKey } from "./publishable-key";

/**
 * The `admin-users` Edge Function's HTTP surface (S-409), against the local stack's edge runtime: the
 * same requests the Worker sends, judged by status code only (a body's shape is the function's
 * business, and `verify_jwt` is false, so the SDK's own answers reach the caller unchanged).
 *
 * The claims, in the order the function enforces them:
 *
 * - **Who gets in.** Only a genuine token reaches the function (401 otherwise), and only a live admin
 *   gets past it: a role-less user, a viewer, an author, an admin still on a temporary password, a
 *   deactivated admin (S-408) and the solver's machine token are all refused (403).
 * - **What `create` does.** One admin request makes the account, fences it, records it and grants the
 *   role, and the response is the only place the password appears. A forced failure after the account
 *   exists undoes it and returns no password.
 * - **What `reissue` does.** Only for an account that is still pending: a new password, the flag on
 *   again, and a record. Never for an account that chose its own password, a machine user, an active
 *   admin or an invitee.
 * - **What `invite` does (S-410).** It makes the account, fences it, records it and grants the role
 *   before it sends the one email, and a forced failure before the send leaves no account and no
 *   mail. A pending address is re-sent (with the role chosen now), at most once a minute; any other
 *   account at that address is refused with nothing sent.
 * - **What `resend` and `revoke` do.** Re-send only while the invitation is unaccepted; revoke until
 *   the person chooses a password, deleting the never-used account and killing its link.
 *
 * Needs the stack's edge runtime and Mailpit, which CI's `supabase-stack` action includes. Users the
 * function creates are registered for teardown as they appear, and mail is deleted by id.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

// supabase-js's local default JWT secret: the legacy HS256 key a forged token could be signed with.
const LEGACY_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

type CreatedAccount = { userId: string; password: string };

type Invitation = { userId: string; resent: boolean };

/** What an invitation email carries: its one link, split as the confirm page reads it. */
type InviteLink = { url: URL; type: string | null; tokenHash: string | null };

/** GoTrue's answer for an expired, used, replaced or deleted link (probe.md P2). */
const OTP_EXPIRED = "otp_expired";

(hasEnv ? describe : describe.skip)("admin-users Edge Function (local Supabase)", { timeout: 30_000 }, () => {
  let admin: SupabaseClient;
  let pg: Client;
  let caller: SignedInUser;
  let tokens: {
    admin: string;
    author: string;
    viewer: string;
    noRole: string;
    pendingAdmin: string;
    deactivatedAdmin: string;
    machine: string;
  };
  const ownMail = new Set<string>();

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    pg = await connectPostgres();
    const [adminUser, author, viewer, noRole, pendingAdmin, deactivatedAdmin, machine] = await Promise.all([
      createSignedInUser(admin, { role: "admin" }),
      createSignedInUser(admin, { role: "author" }),
      createSignedInUser(admin, { role: "viewer" }),
      createSignedInUser(admin),
      createSignedInUser(admin, { role: "admin", mustChangePassword: true }),
      createSignedInUser(admin, { role: "admin", deactivated: true }),
      signedInMachine(admin),
    ]);
    caller = adminUser;
    tokens = {
      admin: await tokenOf(adminUser.client),
      author: await tokenOf(author.client),
      viewer: await tokenOf(viewer.client),
      noRole: await tokenOf(noRole.client),
      pendingAdmin: await tokenOf(pendingAdmin.client),
      deactivatedAdmin: await tokenOf(deactivatedAdmin.client),
      machine,
    };
  }, 30_000);

  afterAll(async () => {
    try {
      if (ownMail.size > 0) await deleteMessages([...ownMail]);
      await teardown(admin);
    } finally {
      await pg.end();
    }
  });

  describe("who gets in", () => {
    const create = { op: "create", email: "never-created@example.test", role: null };

    it("refuses the publishable key alone (401)", async () => {
      expect((await call({ apikey: PUBLISHABLE_KEY }, create)).status).toBe(401);
    });

    it("refuses the publishable key as a Bearer token (401)", async () => {
      expect((await call({ token: PUBLISHABLE_KEY }, create)).status).toBe(401);
    });

    it("refuses a request with no credential at all (401)", async () => {
      expect((await call({}, create)).status).toBe(401);
    });

    it("refuses a forged token: right claims, garbage signature (401)", async () => {
      const [header, payload] = tokens.admin.split(".");
      expect((await call({ token: `${header}.${payload}.${"A".repeat(86)}` }, create)).status).toBe(401);
    });

    it("refuses a token signed with the legacy HS256 secret, claiming the admin's identity (401)", async () => {
      expect((await call({ token: hs256Token({ sub: caller.id, role: "authenticated" }) }, create)).status).toBe(401);
    });

    for (const principal of ["noRole", "viewer", "author", "pendingAdmin", "deactivatedAdmin", "machine"] as const) {
      it(`refuses ${principal} (403), whatever it asks`, async () => {
        expect((await call({ token: tokens[principal] }, create)).status).toBe(403);
        expect((await call({ token: tokens[principal] }, { op: "reissue", userId: randomUUID() })).status).toBe(403);
        const invite = { op: "invite", email: "never-invited@example.test", role: "viewer" };
        expect((await call({ token: tokens[principal] }, invite)).status).toBe(403);
        expect((await call({ token: tokens[principal] }, { op: "resend", userId: randomUUID() })).status).toBe(403);
        expect((await call({ token: tokens[principal] }, { op: "revoke", userId: randomUUID() })).status).toBe(403);
        // Judged before the body: a refused caller learns nothing about the validator.
        expect((await call({ token: tokens[principal] }, { nonsense: true })).status).toBe(403);
      });
    }

    it("lets an admin in: bad input is the validator's 422, not a refusal", async () => {
      expect((await call({ token: tokens.admin }, { op: "nonsense" })).status).toBe(422);
    });

    it("answers 405 to anything but POST", async () => {
      expect((await call({ token: tokens.admin }, undefined, "GET")).status).toBe(405);
    });
  });

  describe("create", () => {
    it("makes the account, fences it, records it, grants the role, and reveals the password once", async () => {
      const email = freshEmail();

      const response = await call({ token: tokens.admin }, { op: "create", email, role: "author" });
      expect(response.status).toBe(200);
      const created = await accountOf(response);

      expect(created.password).toHaveLength(24);
      expect(await directoryRow(created.userId)).toEqual({ email, must_change_password: true });
      expect(await roleOf(created.userId)).toBe("author");
      // The two records, neither of them an operator's: the verified admin is the actor of both.
      expect(await recordsFor(created.userId)).toEqual([
        { kind: "account_created", actor_kind: "user", actor_id: caller.id, new_role: "author" },
        { kind: "role_granted", actor_kind: "user", actor_id: caller.id, new_role: "author" },
      ]);

      // The password works, and the session it opens holds no role until the person chooses their own.
      const session = signedOutClient();
      expect((await session.auth.signInWithPassword({ email, password: created.password })).error).toBeNull();
      expect((await session.rpc("own_app_role")).data).toBeNull();
    });

    it("creates an account with no role when the admin chooses none", async () => {
      const response = await call({ token: tokens.admin }, { op: "create", email: freshEmail(), role: null });
      expect(response.status).toBe(200);
      const created = await accountOf(response);

      expect(await roleOf(created.userId)).toBeNull();
      expect(await recordsFor(created.userId)).toEqual([
        { kind: "account_created", actor_kind: "user", actor_id: caller.id, new_role: null },
      ]);
    });

    it("refuses a duplicate address (409) and leaves the existing account untouched", async () => {
      const first = await accountOf(
        await call({ token: tokens.admin }, { op: "create", email: freshEmail(), role: "viewer" }),
      );
      const existing = await directoryRow(first.userId);

      const again = await call({ token: tokens.admin }, { op: "create", email: existing?.email, role: "admin" });

      expect(again.status).toBe(409);
      expect(await roleOf(first.userId)).toBe("viewer");
    });

    it("refuses a machine user's address (409) and changes nothing", async () => {
      const machine = await createAuthUser(admin, { appMetadata: { machine_role: "solver_job_writer" } });

      const response = await call({ token: tokens.admin }, { op: "create", email: machine.email, role: "admin" });

      // Scoped to this address, not a global count, which a suite running in parallel would move.
      expect(response.status).toBe(409);
      expect(await userCountWithEmail(machine.email)).toBe(1);
      expect(await roleOf(machine.id)).toBeNull();
    });

    it("refuses input that carries metadata or a chosen password (422)", async () => {
      const email = freshEmail();
      const withMetadata = { op: "create", email, role: "viewer", app_metadata: { machine_role: "solver_job_writer" } };
      expect((await call({ token: tokens.admin }, withMetadata)).status).toBe(422);
      expect(
        (await call({ token: tokens.admin }, { op: "create", email, role: "viewer", password: "chosen" })).status,
      ).toBe(422);
      expect(await userCountWithEmail(email)).toBe(0);
    });

    it("undoes the account and reveals no password when a step after creation fails (500)", async () => {
      const email = freshEmail();
      await failFlagWritesFor(email);
      try {
        const response = await call({ token: tokens.admin }, { op: "create", email, role: "viewer" });

        expect(response.status).toBe(500);
        expect(await response.text()).not.toMatch(/password/i);
        expect(await userCountWithEmail(email)).toBe(0);
      } finally {
        await stopFailingFlagWrites();
      }
    });
  });

  describe("reissue", () => {
    const pendingAccount = async (role: "viewer" | "admin" = "viewer"): Promise<CreatedAccount & { email: string }> => {
      const email = freshEmail();
      const created = await accountOf(await call({ token: tokens.admin }, { op: "create", email, role }));
      return { ...created, email };
    };

    it("gives a pending account a new password, keeps it fenced, and records it", async () => {
      const account = await pendingAccount();

      const response = await call({ token: tokens.admin }, { op: "reissue", userId: account.userId });
      expect(response.status).toBe(200);
      const reissued = await accountOf(response);

      expect(reissued.userId).toBe(account.userId);
      expect(reissued.password).not.toBe(account.password);
      // The password write cleared the flag; the function set it again.
      expect((await directoryRow(account.userId))?.must_change_password).toBe(true);
      expect(await recordsFor(account.userId, "password_reissued")).toEqual([
        { kind: "password_reissued", actor_kind: "user", actor_id: caller.id, new_role: null },
      ]);
      expect(
        (await signedOutClient().auth.signInWithPassword({ email: account.email, password: account.password })).error
          ?.code,
      ).toBe("invalid_credentials");
      const session = signedOutClient();
      expect(
        (await session.auth.signInWithPassword({ email: account.email, password: reissued.password })).error,
      ).toBeNull();
      expect((await session.rpc("own_app_role")).data).toBeNull();
    });

    it("ends a session opened with the old password, which can then choose no password of its own", async () => {
      const account = await pendingAccount();
      const old = signedOutClient();
      expect(
        (await old.auth.signInWithPassword({ email: account.email, password: account.password })).error,
      ).toBeNull();
      expect((await old.auth.getUser()).error).toBeNull();

      expect((await call({ token: tokens.admin }, { op: "reissue", userId: account.userId })).status).toBe(200);

      // Whoever held the old password must not finish the account with it: the Auth Admin API's
      // password write signs out every session, and the access token's session is gone with them.
      expect((await old.auth.getUser()).error).not.toBeNull();
      expect((await old.auth.updateUser({ password: strongPassword() })).error).not.toBeNull();
      expect((await directoryRow(account.userId))?.must_change_password).toBe(true);
    });

    it("works again and again on a pending account, and a pending admin is still pending", async () => {
      const account = await pendingAccount("admin");

      expect((await call({ token: tokens.admin }, { op: "reissue", userId: account.userId })).status).toBe(200);
      expect((await call({ token: tokens.admin }, { op: "reissue", userId: account.userId })).status).toBe(200);
      expect((await directoryRow(account.userId))?.must_change_password).toBe(true);
    });

    it("refuses an account that has chosen its own password (409)", async () => {
      const account = await pendingAccount();
      const session = signedOutClient();
      await session.auth.signInWithPassword({ email: account.email, password: account.password });
      expect((await session.auth.updateUser({ password: strongPassword() })).error).toBeNull();
      expect((await directoryRow(account.userId))?.must_change_password).toBe(false);

      expect((await call({ token: tokens.admin }, { op: "reissue", userId: account.userId })).status).toBe(409);
    });

    it("refuses an account that never was pending, an active admin included (409)", async () => {
      const author = await createSignedInUser(admin, { role: "author" });
      expect((await call({ token: tokens.admin }, { op: "reissue", userId: author.id })).status).toBe(409);
      expect((await call({ token: tokens.admin }, { op: "reissue", userId: caller.id })).status).toBe(409);
    });

    it("refuses a machine user (409)", async () => {
      const machine = await createAuthUser(admin, { appMetadata: { machine_role: "solver_job_writer" } });
      expect((await call({ token: tokens.admin }, { op: "reissue", userId: machine.id })).status).toBe(409);
    });

    it("refuses an invitee, accepted or not (409): their answer is a re-send or a revoke", async () => {
      const unaccepted = await invited();
      const accepted = await invited();
      await acceptInvitation(accepted.email);

      expect((await call({ token: tokens.admin }, { op: "reissue", userId: unaccepted.userId })).status).toBe(409);
      expect((await call({ token: tokens.admin }, { op: "reissue", userId: accepted.userId })).status).toBe(409);
    });

    it("answers 404 for a user that does not exist", async () => {
      expect((await call({ token: tokens.admin }, { op: "reissue", userId: randomUUID() })).status).toBe(404);
    });

    it("survives one lost flag write: the second attempt fences the account again (200)", async () => {
      const account = await pendingAccount();
      await failFlagWritesFor(account.email, { times: 1 });
      try {
        const response = await call({ token: tokens.admin }, { op: "reissue", userId: account.userId });

        expect(response.status).toBe(200);
        expect((await directoryRow(account.userId))?.must_change_password).toBe(true);
      } finally {
        await stopFailingFlagWrites();
      }
    });

    it("reveals no password when the flag cannot be set again (500), leaving the account unfenced", async () => {
      const account = await pendingAccount();
      await failFlagWritesFor(account.email);
      try {
        const response = await call({ token: tokens.admin }, { op: "reissue", userId: account.userId });

        expect(response.status).toBe(500);
        expect(await response.text()).not.toMatch(/password/i);
        // The known outcome, pinned: the password write cleared the flag and nothing set it again, so
        // the account reads as one that chose its own password, and a re-issue is refused from now on.
        expect((await directoryRow(account.userId))?.must_change_password).toBe(false);
      } finally {
        await stopFailingFlagWrites();
      }
    });
  });

  describe("invite", () => {
    it("makes the account, fences it, records it, grants the role, and sends exactly one invite email", async () => {
      const email = freshEmail();

      const response = await call({ token: tokens.admin }, { op: "invite", email, role: "viewer" });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Invitation;
      registerUser(body.userId);

      // The response names the account and nothing else: no token, no link, no password.
      expect(Object.keys(body).sort()).toEqual(["resent", "userId"]);
      expect(body.resent).toBe(false);
      expect(await invitationRow(body.userId)).toEqual({
        email,
        must_change_password: true,
        invited: true,
        email_confirmed: false,
      });
      expect(await roleOf(body.userId)).toBe("viewer");
      expect(await recordsFor(body.userId)).toEqual([
        { kind: "invitation_sent", actor_kind: "user", actor_id: caller.id, new_role: "viewer" },
        { kind: "role_granted", actor_kind: "user", actor_id: caller.id, new_role: "viewer" },
      ]);

      const message = await mailTo(email);
      expect(message.Subject).toBe("You're invited to IB Planner");
      const link = await inviteLinkIn(message);
      expect(link.type).toBe("invite");
      expect(link.url.pathname).toBe("/auth/confirm");
      expect(await mailCount(email)).toBe(1);

      // The emailed link is the live one: spending it confirms the account, which stays fenced.
      const session = signedOutClient();
      expect((await session.auth.verifyOtp({ type: "invite", token_hash: link.tokenHash ?? "" })).error).toBeNull();
      expect((await session.rpc("own_app_role")).data).toBeNull();
    });

    it("re-sends to a pending address only after the cooldown: a new email, the old link dead, recorded", async () => {
      const first = await invited();
      const firstMail = await mailTo(first.email);

      const tooSoon = await call({ token: tokens.admin }, { op: "invite", email: first.email, role: "viewer" });
      expect(tooSoon.status).toBe(429);
      expect(await mailCountAfterSettling(first.email)).toBe(1);

      await pastCooldown(first.userId);
      const again = await call({ token: tokens.admin }, { op: "invite", email: first.email, role: "viewer" });
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ userId: first.userId, resent: true });

      const secondMail = await mailTo(first.email, firstMail);
      expect(await spend(await inviteLinkIn(firstMail))).toBe(OTP_EXPIRED);
      expect((await inviteLinkIn(secondMail)).tokenHash).not.toBe((await inviteLinkIn(firstMail)).tokenHash);
      expect(await recordsFor(first.userId, "invitation_resent")).toEqual([
        { kind: "invitation_resent", actor_kind: "user", actor_id: caller.id, new_role: "viewer" },
      ]);
      // The role was already viewer: a re-invite with the same role writes no role change.
      expect(await recordsFor(first.userId, "role_changed")).toEqual([]);
    });

    it("applies a different role on a re-invite, recorded as a role change by the admin", async () => {
      const first = await invited("viewer");
      await mailTo(first.email);
      await pastCooldown(first.userId);

      const again = await call({ token: tokens.admin }, { op: "invite", email: first.email, role: "author" });

      expect(again.status).toBe(200);
      expect(await roleOf(first.userId)).toBe("author");
      expect(await recordsFor(first.userId, "role_changed")).toEqual([
        { kind: "role_changed", actor_kind: "user", actor_id: caller.id, new_role: "author" },
      ]);
      expect((await invitationRow(first.userId))?.must_change_password).toBe(true);
    });

    it("refuses an address that already has an account (409), and sends nothing", async () => {
      const confirmed = await createSignedInUser(admin, { role: "author" });
      const temporary = freshEmail();
      const created = await accountOf(
        await call({ token: tokens.admin }, { op: "create", email: temporary, role: "viewer" }),
      );
      const machine = await createAuthUser(admin, { appMetadata: { machine_role: "solver_job_writer" } });

      for (const email of [confirmed.email, temporary, machine.email]) {
        const response = await call({ token: tokens.admin }, { op: "invite", email, role: "admin" });
        expect(response.status, email).toBe(409);
        expect(await mailCountAfterSettling(email), email).toBe(0);
      }
      expect(await roleOf(confirmed.id)).toBe("author");
      expect(await roleOf(created.userId)).toBe("viewer");
      expect(await roleOf(machine.id)).toBeNull();
    });

    it("undoes the account and sends nothing when a step before the send fails (500)", async () => {
      const email = freshEmail();
      await failFlagWritesFor(email);
      try {
        const response = await call({ token: tokens.admin }, { op: "invite", email, role: "viewer" });

        expect(response.status).toBe(500);
        expect(await userCountWithEmail(email)).toBe(0);
        expect(await mailCountAfterSettling(email)).toBe(0);
      } finally {
        await stopFailingFlagWrites();
      }
    });
  });

  describe("resend", () => {
    it("re-sends a pending invitation: a new email, the flag still set, and a record", async () => {
      const first = await invited();
      const firstMail = await mailTo(first.email);
      await pastCooldown(first.userId);

      const response = await call({ token: tokens.admin }, { op: "resend", userId: first.userId });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ userId: first.userId });
      const secondMail = await mailTo(first.email, firstMail);
      expect((await inviteLinkIn(secondMail)).type).toBe("invite");
      expect((await invitationRow(first.userId))?.must_change_password).toBe(true);
      expect(await recordsFor(first.userId, "invitation_resent")).toEqual([
        { kind: "invitation_resent", actor_kind: "user", actor_id: caller.id, new_role: null },
      ]);
    });

    it("fences a dashboard-era invitee before it sends: every live link belongs to a fenced account", async () => {
      const dashboardInvite = await createInvitedUser(admin, { role: "viewer" });
      expect((await invitationRow(dashboardInvite.id))?.must_change_password).toBe(false);
      await pastCooldown(dashboardInvite.id);

      expect((await call({ token: tokens.admin }, { op: "resend", userId: dashboardInvite.id })).status).toBe(200);

      expect((await invitationRow(dashboardInvite.id))?.must_change_password).toBe(true);
      await mailTo(dashboardInvite.email);
    });

    it("refuses inside the cooldown (429), and sends nothing", async () => {
      const first = await invited();
      await mailTo(first.email);

      expect((await call({ token: tokens.admin }, { op: "resend", userId: first.userId })).status).toBe(429);
      expect(await mailCountAfterSettling(first.email)).toBe(1);
    });

    it("refuses an accepted invitee, an active account and a machine user (409)", async () => {
      const accepted = await invited();
      await acceptInvitation(accepted.email);
      await pastCooldown(accepted.userId);
      const active = await createSignedInUser(admin, { role: "viewer" });
      const machine = await createAuthUser(admin, { appMetadata: { machine_role: "solver_job_writer" } });

      for (const userId of [accepted.userId, active.id, machine.id]) {
        expect((await call({ token: tokens.admin }, { op: "resend", userId })).status, userId).toBe(409);
      }
    });

    it("answers 404 for a user that does not exist", async () => {
      expect((await call({ token: tokens.admin }, { op: "resend", userId: randomUUID() })).status).toBe(404);
    });

    it("deletes an account the send would create for an address with none, and fails (500)", async () => {
      const first = await invited();
      await mailTo(first.email);
      await pastCooldown(first.userId);
      // The directory now names an address with no account: what a target deleted between the
      // lookup and the send leaves behind. `inviteUserByEmail` creates a user for such an address,
      // with no flag and a live link, so the send must refuse the account it did not expect.
      const stray = freshEmail();
      await pg.query("update public.user_directory set email = $1 where user_id = $2", [stray, first.userId]);
      try {
        const response = await call({ token: tokens.admin }, { op: "resend", userId: first.userId });

        expect(response.status).toBe(500);
        expect(await userCountWithEmail(stray)).toBe(0);
      } finally {
        await mailCountAfterSettling(stray);
        await pg.query("delete from auth.users where email = $1", [stray]);
        await pg.query("update public.user_directory set email = $1 where user_id = $2", [first.email, first.userId]);
      }
    });
  });

  describe("revoke", () => {
    it("deletes an unaccepted invitee, keeps the record with its actor, and kills the emailed link", async () => {
      const first = await invited();
      const link = await inviteLinkIn(await mailTo(first.email));
      const revokedBefore = await revokedRecordsBy(caller.id);

      const response = await call({ token: tokens.admin }, { op: "revoke", userId: first.userId });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ userId: first.userId });
      expect(await userCountWithEmail(first.email)).toBe(0);
      // The target was deleted, so the record names nobody (S-406's ids-only rule): who and when stay.
      expect(await revokedRecordsBy(caller.id)).toBe(revokedBefore + 1);
      expect(await spend(link)).toBe(OTP_EXPIRED);
    });

    it("deletes an invitee who accepted but has not chosen a password", async () => {
      const first = await invited();
      await acceptInvitation(first.email);

      expect((await call({ token: tokens.admin }, { op: "revoke", userId: first.userId })).status).toBe(200);
      expect(await userCountWithEmail(first.email)).toBe(0);
    });

    it("refuses an active account, a temporary-password account and a machine user (409)", async () => {
      const active = await createSignedInUser(admin, { role: "viewer" });
      const created = await accountOf(
        await call({ token: tokens.admin }, { op: "create", email: freshEmail(), role: "viewer" }),
      );
      const machine = await createAuthUser(admin, { appMetadata: { machine_role: "solver_job_writer" } });

      for (const userId of [active.id, created.userId, machine.id]) {
        expect((await call({ token: tokens.admin }, { op: "revoke", userId })).status, userId).toBe(409);
      }
      expect(await roleOf(active.id)).toBe("viewer");
    });

    it("answers 404 for a user that does not exist", async () => {
      expect((await call({ token: tokens.admin }, { op: "revoke", userId: randomUUID() })).status).toBe(404);
    });
  });

  // helpers ---------------------------------------------------------------------------------------

  /** A user the function created: registered for teardown, so the suite leaves nothing behind. */
  const accountOf = async (response: Response): Promise<CreatedAccount> => {
    const body = (await response.json()) as CreatedAccount;
    expect(body.userId).toEqual(expect.any(String));
    registerUser(body.userId);
    return body;
  };

  const directoryRow = async (userId: string) => {
    const { data, error } = await admin
      .from("user_directory")
      .select("email, must_change_password")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`directoryRow: ${error.message}`);
    return data;
  };

  const roleOf = async (userId: string): Promise<string | null> => {
    const { data, error } = await admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`roleOf: ${error.message}`);
    return data?.role ?? null;
  };

  /** A user's access records, oldest first; `kind` narrows them. Ids only, no timestamps. */
  const recordsFor = async (userId: string, kind?: string) => {
    const { data, error } = await admin
      .from("access_changes")
      .select("id, kind, actor_kind, actor_id, new_role")
      .eq("target_id", userId)
      .order("id");
    if (error) throw new Error(`recordsFor: ${error.message}`);
    return data
      .filter((row) => kind === undefined || row.kind === kind)
      .map(({ kind: k, actor_kind, actor_id, new_role }) => ({ kind: k, actor_kind, actor_id, new_role }));
  };

  /** An invitation the function made: registered for teardown, its email not yet read. */
  const invited = async (role: "viewer" | "author" | "admin" = "viewer"): Promise<Invitation & { email: string }> => {
    const email = freshEmail();
    const response = await call({ token: tokens.admin }, { op: "invite", email, role });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Invitation;
    registerUser(body.userId);
    return { ...body, email };
  };

  /** The newest message to `email` (newer than `after`, when given), kept for deletion. */
  const mailTo = async (email: string, after?: MailSummary): Promise<MailSummary> => {
    const message = await waitForMessageTo(email, after ? { after: after.Created } : {});
    ownMail.add(message.ID);
    return message;
  };

  const mailCount = async (email: string): Promise<number> => (await messagesTo(email)).length;

  /** The count once anything already on its way has had time to land: nothing is sent asynchronously. */
  const mailCountAfterSettling = async (email: string): Promise<number> => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const messages = await messagesTo(email);
    messages.forEach((message) => ownMail.add(message.ID));
    return messages.length;
  };

  /** Spend the newest invite link to `email` in a fresh session: the invitee accepts, still fenced. */
  const acceptInvitation = async (email: string): Promise<void> => {
    expect(await spend(await inviteLinkIn(await mailTo(email)))).toBeNull();
  };

  /** Move the newest invitation past the cooldown, as a minute's wait would. The mirror follows. */
  const pastCooldown = async (userId: string): Promise<void> => {
    await pg.query("update auth.users set invited_at = invited_at - interval '2 minutes' where id = $1", [userId]);
  };

  const invitationRow = async (userId: string) => {
    const { data, error } = await admin
      .from("user_directory")
      .select("email, must_change_password, invited_at, email_confirmed_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`invitationRow: ${error.message}`);
    return data
      ? {
          email: data.email,
          must_change_password: data.must_change_password,
          invited: data.invited_at !== null,
          email_confirmed: data.email_confirmed_at !== null,
        }
      : null;
  };

  /** `invitation_revoked` records by `actorId` whose target is gone. */
  const revokedRecordsBy = async (actorId: string): Promise<number> => {
    const { count, error } = await admin
      .from("access_changes")
      .select("id", { count: "exact", head: true })
      .eq("kind", "invitation_revoked")
      .eq("actor_id", actorId)
      .is("target_id", null);
    if (error) throw new Error(`revokedRecordsBy: ${error.message}`);
    return count ?? 0;
  };

  const userCountWithEmail = async (email: string): Promise<number> =>
    Number(
      (await pg.query<{ n: string }>("select count(*) as n from auth.users where email = $1", [email])).rows[0]?.n,
    );

  /**
   * Make the flag write fail for one address, the way a database error would: a trigger that raises
   * when that account is fenced, for the first `times` writes (every write by default). The count is
   * a sequence, because a raised exception rolls back everything but `nextval`. It names a throwaway
   * address nobody else uses, so a parallel suite never meets it, and `stopFailingFlagWrites` always
   * removes it. Every object is replaced rather than created, so one left behind by a cleanup that
   * failed cannot fail the next case too.
   */
  const failFlagWritesFor = async (
    email: string,
    { times = Number.MAX_SAFE_INTEGER }: { times?: number } = {},
  ): Promise<void> => {
    if (!/^[a-z0-9.@-]+$/.test(email)) throw new Error(`refusing to embed an unexpected address: ${email}`);
    if (!Number.isSafeInteger(times) || times < 1) throw new Error(`refusing an unexpected count: ${times}`);
    await ddl("drop sequence if exists public.zz_admin_users_fail_flag_count");
    await ddl("create sequence public.zz_admin_users_fail_flag_count");
    await ddl(`
      create or replace function public.zz_admin_users_fail_flag() returns trigger language plpgsql as $$
      begin
        if nextval('public.zz_admin_users_fail_flag_count') <= ${times} then
          raise exception 'forced failure (admin-users suite)';
        end if;
        return new;
      end $$`);
    await ddl(`
      create or replace trigger zz_admin_users_fail_flag before update of must_change_password on public.user_directory
        for each row when (new.must_change_password and new.email = '${email}')
        execute function public.zz_admin_users_fail_flag()`);
  };

  const stopFailingFlagWrites = async (): Promise<void> => {
    await ddl("drop trigger if exists zz_admin_users_fail_flag on public.user_directory");
    await ddl("drop function if exists public.zz_admin_users_fail_flag()");
    await ddl("drop sequence if exists public.zz_admin_users_fail_flag_count");
  };

  /**
   * One DDL statement, retried when Postgres picks it as a deadlock victim (40P01). Its trigger takes
   * an ACCESS EXCLUSIVE lock on `user_directory`, which a parallel suite's account deletion cascades
   * into, and the loser is rolled back whole, so running it again is safe.
   */
  const ddl = async (sql: string, attempt = 1): Promise<void> => {
    try {
      await pg.query(sql);
    } catch (error) {
      if (attempt >= DDL_ATTEMPTS || !isDeadlock(error)) throw error;
      await ddl(sql, attempt + 1);
    }
  };
});

const DDL_ATTEMPTS = 3;

const isDeadlock = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "40P01";

type Credentials = { token?: string; apikey?: string };

/** One request to the function, as the Worker sends it: the caller's token as the Bearer. */
const call = (credentials: Credentials, body?: unknown, method = "POST"): Promise<Response> => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (credentials.token) headers.authorization = `Bearer ${credentials.token}`;
  if (credentials.apikey) headers.apikey = credentials.apikey;
  return fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

const freshEmail = (): string => `created-${randomUUID()}@example.test`;

/** An invitation email's one link. Throws unless there is exactly one. */
const inviteLinkIn = async (message: MailSummary): Promise<InviteLink> => {
  const urls = urlsIn((await readMessage(message.ID)).HTML);
  if (urls.length !== 1) throw new Error(`expected one link in message ${message.ID}, found ${urls.length}`);
  const url = new URL(urls[0] ?? "");
  return { url, type: url.searchParams.get("type"), tokenHash: url.searchParams.get("token_hash") };
};

/** Spend an invite link in a fresh session: null on success, else GoTrue's error code. */
const spend = async ({ tokenHash }: InviteLink): Promise<string | null> => {
  const { error } = await signedOutClient().auth.verifyOtp({ type: "invite", token_hash: tokenHash ?? "" });
  return error ? (error.code ?? "unknown") : null;
};

const tokenOf = async (client: SupabaseClient): Promise<string> => {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error("no session to take a token from");
  return data.session.access_token;
};

/** The solver's machine token: a plain JWT that passes `auth: "user"` and must still be refused. */
const signedInMachine = async (admin: SupabaseClient): Promise<string> => {
  const password = strongPassword();
  const machine = await createAuthUser(admin, { password, appMetadata: { machine_role: "solver_job_writer" } });
  const { data, error } = await signedOutClient().auth.signInWithPassword({ email: machine.email, password });
  if (error) throw new Error(`machine sign-in: ${error.message}`);
  return data.session.access_token;
};

const hs256Token = (claims: Record<string, unknown>): string => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${part({ alg: "HS256", typ: "JWT" })}.${part({ aud: "authenticated", iat: now, exp: now + 600, ...claims })}`;
  return `${unsigned}.${createHmac("sha256", LEGACY_JWT_SECRET).update(unsigned).digest("base64url")}`;
};
