import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, SupabaseClient } from "@/shared/api";
import { createAuthUser, createSignedInUser, type SignedInUser, teardown } from "@/test/factories";
import { registerUser } from "./factories/teardown";
import { connectPostgres } from "./postgres-client";
import { createPublishableClient } from "./publishable-client";
import { readPublishableKey } from "./publishable-key";

/**
 * The `admin-users` Edge Function's HTTP surface (S-409), against the local stack's edge runtime: the
 * same requests the Worker sends, judged by status code only (a body's shape is the function's
 * business, and `verify_jwt` is false, so the SDK's own answers reach the caller unchanged).
 *
 * The claims, in the order the function enforces them:
 *
 * - **Who gets in.** Only a genuine token reaches the function (401 otherwise), and only a live admin
 *   gets past it: a role-less user, a viewer, an author, an admin still on a temporary password and
 *   the solver's machine token are all refused (403).
 * - **What `create` does.** One admin request makes the account, fences it, records it and grants the
 *   role, and the response is the only place the password appears. A forced failure after the account
 *   exists undoes it and returns no password.
 * - **What `reissue` does.** Only for an account that is still pending: a new password, the flag on
 *   again, and a record. Never for an account that chose its own password, a machine user or an
 *   active admin.
 *
 * Needs the stack's edge runtime, which CI's `supabase-stack` action includes (S-409 Phase 2). Users
 * the function creates are registered for teardown as they appear.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

// supabase-js's local default JWT secret: the legacy HS256 key a forged token could be signed with.
const LEGACY_JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

type CreatedAccount = { userId: string; password: string };

(hasEnv ? describe : describe.skip)("admin-users Edge Function (local Supabase)", { timeout: 30_000 }, () => {
  let admin: SupabaseClient;
  let pg: Client;
  let caller: SignedInUser;
  let tokens: { admin: string; author: string; viewer: string; noRole: string; pendingAdmin: string; machine: string };

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    pg = await connectPostgres();
    const [adminUser, author, viewer, noRole, pendingAdmin, machine] = await Promise.all([
      createSignedInUser(admin, { role: "admin" }),
      createSignedInUser(admin, { role: "author" }),
      createSignedInUser(admin, { role: "viewer" }),
      createSignedInUser(admin),
      createSignedInUser(admin, { role: "admin", mustChangePassword: true }),
      signedInMachine(admin),
    ]);
    caller = adminUser;
    tokens = {
      admin: await tokenOf(adminUser.client),
      author: await tokenOf(author.client),
      viewer: await tokenOf(viewer.client),
      noRole: await tokenOf(noRole.client),
      pendingAdmin: await tokenOf(pendingAdmin.client),
      machine,
    };
  }, 30_000);

  afterAll(async () => {
    try {
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

    for (const principal of ["noRole", "viewer", "author", "pendingAdmin", "machine"] as const) {
      it(`refuses ${principal} (403), whatever it asks`, async () => {
        expect((await call({ token: tokens[principal] }, create)).status).toBe(403);
        expect((await call({ token: tokens[principal] }, { op: "reissue", userId: randomUUID() })).status).toBe(403);
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
      const before = await countUsers();

      const response = await call({ token: tokens.admin }, { op: "create", email: machine.email, role: "admin" });

      expect(response.status).toBe(409);
      expect(await countUsers()).toBe(before);
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
      expect((await session.auth.updateUser({ password: `${randomUUID()}Aa1!` })).error).toBeNull();
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

    it("answers 404 for a user that does not exist", async () => {
      expect((await call({ token: tokens.admin }, { op: "reissue", userId: randomUUID() })).status).toBe(404);
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

  const countUsers = async (): Promise<number> =>
    Number((await pg.query<{ n: string }>("select count(*) as n from auth.users")).rows[0]?.n);

  const userCountWithEmail = async (email: string): Promise<number> =>
    Number(
      (await pg.query<{ n: string }>("select count(*) as n from auth.users where email = $1", [email])).rows[0]?.n,
    );

  /**
   * Make the flag write fail for one address, the way a database error would: a trigger that raises
   * when that account is fenced. It names a throwaway address nobody else uses, so a parallel suite
   * never meets it, and `stopFailingFlagWrites` always removes it.
   */
  const failFlagWritesFor = async (email: string): Promise<void> => {
    if (!/^[a-z0-9.@-]+$/.test(email)) throw new Error(`refusing to embed an unexpected address: ${email}`);
    await pg.query(`
      create or replace function public.zz_admin_users_fail_flag() returns trigger language plpgsql as $$
      begin raise exception 'forced failure (admin-users suite)'; end $$`);
    await pg.query(`
      create trigger zz_admin_users_fail_flag before update of must_change_password on public.user_directory
        for each row when (new.must_change_password and new.email = '${email}')
        execute function public.zz_admin_users_fail_flag()`);
  };

  const stopFailingFlagWrites = async (): Promise<void> => {
    await pg.query("drop trigger if exists zz_admin_users_fail_flag on public.user_directory");
    await pg.query("drop function if exists public.zz_admin_users_fail_flag()");
  };
});

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

const tokenOf = async (client: SupabaseClient): Promise<string> => {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error("no session to take a token from");
  return data.session.access_token;
};

/** The solver's machine token: a plain JWT that passes `auth: "user"` and must still be refused. */
const signedInMachine = async (admin: SupabaseClient): Promise<string> => {
  const password = `${randomUUID()}Aa1!`;
  const machine = await createAuthUser(admin, { password, appMetadata: { machine_role: "solver_job_writer" } });
  const { data, error } = await signedOutClient().auth.signInWithPassword({ email: machine.email, password });
  if (error) throw new Error(`machine sign-in: ${error.message}`);
  return data.session.access_token;
};

const signedOutClient = (): SupabaseClient => {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) throw new Error("no local Supabase env");
  return createPublishableClient(SUPABASE_URL, PUBLISHABLE_KEY);
};

const hs256Token = (claims: Record<string, unknown>): string => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${part({ alg: "HS256", typ: "JWT" })}.${part({ aud: "authenticated", iat: now, exp: now + 600, ...claims })}`;
  return `${unsigned}.${createHmac("sha256", LEGACY_JWT_SECRET).update(unsigned).digest("base64url")}`;
};
