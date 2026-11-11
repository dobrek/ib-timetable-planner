import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, SupabaseClient } from "@/shared/api";
import { createAuthUser, createSignedInUser, teardown } from "@/test/factories";
import { decodeAccessClaims } from "./access-claims";
import { connectPostgres } from "./postgres-client";
import { createPublishableClient } from "./publishable-client";
import { readPublishableKey } from "./publishable-key";

/**
 * The directory's Auth trigger, driven through GoTrue's own write sequence (S-406).
 *
 * Simulated SQL cannot prove this: GoTrue's `createUser` INSERTs `auth.users` without custom
 * `app_metadata` and writes it in a second UPDATE, and sign-in and verification rewrite columns of
 * their own. So every case goes through the Admin API or a real sign-in, and reads the mirror back
 * as the service role, which bypasses the read policy (the role matrix owns who sees which row).
 *
 * The trigger must stay off the sign-in path, because a raising trigger there would lock every
 * user out. That is proven twice: structurally (the UPDATE trigger carries a column list and a
 * `WHEN`), and behaviourally (a sign-in leaves the row's tuple untouched: its `xmin` is unchanged).
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

type DirectoryRow = { email: string | null; is_machine: boolean; is_service_account: boolean };

(hasEnv ? describe : describe.skip)("user directory mirror (local Supabase, real GoTrue)", () => {
  let admin: SupabaseClient;
  let pg: Client;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    pg = await connectPostgres();
  });

  afterAll(async () => {
    try {
      await teardown(admin);
    } finally {
      await pg.end();
    }
  });

  it("createUser mirrors a human with is_machine = false", async () => {
    const { id, email } = await createAuthUser(admin);
    expect(await directoryRowOf(admin, id)).toEqual({ email, is_machine: false, is_service_account: false });
  });

  it("createUser with app_metadata.machine_role mirrors a machine: the second write sets the flag", async () => {
    const { id } = await createAuthUser(admin, { appMetadata: { machine_role: "solver_job_writer" } });
    expect(await directoryRowOf(admin, id)).toMatchObject({ is_machine: true, is_service_account: false });
  });

  it("updateUserById mirrors an email change", async () => {
    const { id } = await createAuthUser(admin);
    const email = `renamed-${randomUUID()}@example.test`;
    expect((await admin.auth.admin.updateUserById(id, { email, email_confirm: true })).error).toBeNull();
    expect(await directoryRowOf(admin, id)).toMatchObject({ email });
  });

  it("updateUserById mirrors app_metadata.service_account = true", async () => {
    const { id } = await createAuthUser(admin);
    expect((await admin.auth.admin.updateUserById(id, { app_metadata: { service_account: true } })).error).toBeNull();
    expect(await directoryRowOf(admin, id)).toMatchObject({ is_machine: false, is_service_account: true });
  });

  it("a non-boolean service_account never raises: the write succeeds and the flag stays false", async () => {
    const { id } = await createAuthUser(admin);
    const { error } = await admin.auth.admin.updateUserById(id, { app_metadata: { service_account: "yes" } });
    expect(error).toBeNull();
    expect(await directoryRowOf(admin, id)).toMatchObject({ is_service_account: false });
  });

  it("a flagged user signs in as plain authenticated, and the sign-in leaves its row untouched", async () => {
    const user = await createSignedInUser(admin);
    expect(
      (await admin.auth.admin.updateUserById(user.id, { app_metadata: { service_account: true } })).error,
    ).toBeNull();
    const before = await tupleVersionOf(pg, user.id);

    const session = await signIn(user.email, user.password);

    const claims = decodeAccessClaims(session.access_token);
    // The Custom Access Token Hook trusts `machine_role` alone; the label never becomes a role.
    expect(claims.role).toBe("authenticated");
    expect(claims.app_metadata?.service_account).toBe(true);
    // Sign-in rewrites `last_sign_in_at` (and may rewrite `raw_app_meta_data`); the `WHEN` keeps the
    // mirror off that path, so the row is the same tuple, not a rewrite with equal values.
    expect(await tupleVersionOf(pg, user.id)).toBe(before);
  });

  it("deleteUser removes the row, by the cascade", async () => {
    const { id } = await createAuthUser(admin);
    expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
    expect(await directoryRowOf(admin, id)).toBeNull();
  });

  it("the UPDATE trigger names its columns and carries a WHEN, so sign-in never reaches the function", async () => {
    const { rows } = await pg.query<{ name: string; columns: string[]; has_when: boolean }>(
      `select t.tgname as name,
              array(select a.attname::text
                      from unnest(t.tgattr) as k(attnum)
                      join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = k.attnum
                     order by a.attname) as columns,
              t.tgqual is not null as has_when
         from pg_trigger t
        where t.tgrelid = 'auth.users'::regclass
          and t.tgname like 'user_directory_mirror_%'
        order by t.tgname`,
    );
    expect(rows).toEqual([
      { name: "user_directory_mirror_insert", columns: [], has_when: false },
      // S-410 added the invitation state: `invited_at` and `email_confirmed_at`.
      {
        name: "user_directory_mirror_update",
        columns: ["email", "email_confirmed_at", "invited_at", "raw_app_meta_data"],
        has_when: true,
      },
    ]);
  });

  it("every user created through GoTrue here has exactly one directory row", async () => {
    // Scoped to this file's users, not a global count: the role matrix, running in parallel,
    // deletes a fresh user's row on purpose to probe INSERT. The migration's post-condition proves
    // the backfill's global count; this proves the trigger never misses a user GoTrue creates.
    const users = await Promise.all([createAuthUser(admin), createSignedInUser(admin)]);
    const ids = users.map(({ id }) => id);
    const { rows } = await pg.query<{ user_id: string; mirrored: number }>(
      `select u.id::text as user_id, count(d.user_id)::int as mirrored
         from auth.users u
         left join public.user_directory d on d.user_id = u.id
        where u.id = any ($1::uuid[])
        group by u.id`,
      [ids],
    );
    expect(Object.fromEntries(rows.map(({ user_id, mirrored }) => [user_id, mirrored]))).toEqual(
      Object.fromEntries(ids.map((id) => [id, 1])),
    );
  });
});

/** `userId`'s directory row as the service role sees it, or null. Throws on any error. */
const directoryRowOf = async (admin: SupabaseClient, userId: string): Promise<DirectoryRow | null> => {
  const { data, error } = await admin
    .from("user_directory")
    .select("email, is_machine, is_service_account")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`read-back failed: ${error.message}`);
  return data;
};

/** The row's `xmin`: any write to it, even one with equal values, makes a new tuple with a new one. */
const tupleVersionOf = async (pg: Client, userId: string): Promise<string> => {
  const { rows } = await pg.query<{ xmin: string }>(
    "select xmin::text as xmin from public.user_directory where user_id = $1",
    [userId],
  );
  const xmin = rows[0]?.xmin;
  if (!xmin) throw new Error(`no directory row for ${userId}`);
  return xmin;
};

/** A fresh session for `email`, through a password grant: the sign-in path the trigger must stay off. */
const signIn = async (email: string, password: string) => {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) throw new Error("signIn: no SUPABASE_URL or publishable key");
  const { data, error } = await createPublishableClient(SUPABASE_URL, PUBLISHABLE_KEY).auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error(`signIn: ${error.message}`);
  return data.session;
};
