import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, SupabaseClient } from "@/shared/api";
import type { AppRole } from "@/shared/config";
import { createAuthUser, teardown } from "@/test/factories";
import { connectPostgres } from "./postgres-client";

/**
 * The last-admin guard (S-406): no write leaves the school without an admin.
 *
 * The invariant is global, and integration files run in parallel against a database that may hold
 * the developer's real admin, so it cannot be tested by demoting admins for real. Each refusal runs
 * inside one `pg` transaction that always rolls back:
 *
 * 1. `lock table … in exclusive mode` stops every other session writing `user_roles` (reads still
 *    pass), so no parallel file can add or remove an admin mid-test. While it is held, every other
 *    file's role writes and teardown cascades wait, and the lane is already flaky under
 *    `--maxWorkers=2`, so only the asserts run inside it: users are created before, never during.
 * 2. Every admin but one file-owned target is demoted, in the transaction only.
 * 3. Each case runs in a savepoint and is rolled back to it, refused or not.
 *
 * These are the repo's first transactional `pg` tests. The connection is `postgres` (locally and
 * in CI, `SUPABASE_DB_URL`), so the first case proves that it may act as a signed-in session and
 * delete an auth user at all. The concurrency case uses separate connections, one per transaction.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

const LAST_ADMIN = "PT409";
const INSUFFICIENT_PRIVILEGE = "42501";
/** The guard's advisory-lock key (20261105080343_role_management.sql). */
const GUARD_LOCK_KEY = 406001;

/** One statement of a case, with its parameters. */
type Statement = { sql: string; params?: unknown[] };

(hasEnv ? describe : describe.skip)("last-admin guard (local Supabase)", () => {
  let admin: SupabaseClient;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    await teardown(admin);
  });

  it("the suite's postgres connection may act as a signed-in session and delete an auth user", async () => {
    await inRolledBackTransaction(async (pg) => {
      await pg.query("set local role authenticated");
      const { rows } = await pg.query<{ role: string }>("select current_user as role");
      await pg.query("reset role");
      const { rowCount } = await pg.query("delete from auth.users where id = $1", [randomUUID()]);
      expect({ role: rows[0]?.role, deleted: rowCount }).toEqual({ role: "authenticated", deleted: 0 });
    });
  });

  it("refuses every write that would leave no admin, and lets an account deletion through", async () => {
    const target = await userWithRole(admin, "admin");
    const secondAdmin = await userWithRole(admin, "author");
    const mover = await userWithRole(admin, "author");
    const roleless = (await createAuthUser(admin)).id;

    const outcomes = await inRolledBackTransaction(async (pg) => {
      await pg.query("set local lock_timeout = '5s'");
      await pg.query("lock table public.user_roles in exclusive mode");
      // From here the target is the only admin, in this transaction alone.
      await pg.query("update public.user_roles set role = 'author' where role = 'admin' and user_id <> $1", [target]);

      const recordsBefore = await recordsNaming(pg, [mover, roleless]);
      const lastRecordId = await lastAccessChangeId(pg);

      return {
        demotion: await sqlstateOf(pg, [demote(target)]),
        multiRowDemotion: await sqlstateOf(pg, [
          { sql: "update public.user_roles set role = 'admin' where user_id = $1", params: [secondAdmin] },
          {
            sql: "update public.user_roles set role = 'viewer' where user_id = any ($1::uuid[])",
            params: [[target, secondAdmin]],
          },
        ]),
        removal: await sqlstateOf(pg, [{ sql: "delete from public.user_roles where user_id = $1", params: [target] }]),
        moveToAnotherUser: await sqlstateOf(pg, [
          { sql: "update public.user_roles set user_id = $1 where user_id = $2", params: [roleless, mover] },
        ]),
        moveRecorded: (await recordsNaming(pg, [mover, roleless])) - recordsBefore,
        // The RLS-counted path: the guard counts the other admins as the admin's own session.
        adminSession: await sqlstateOf(pg, [
          { sql: "set local role authenticated" },
          { sql: "select set_config('request.jwt.claims', $1, true)", params: [claimsFor(target)] },
          demote(target),
        ]),
        accountDeletion: await sqlstateOf(pg, [{ sql: "delete from auth.users where id = $1", params: [target] }]),
        cascadeRecorded: await cascadeRecordsAfterDeletion(pg, target, lastRecordId),
        message: await messageOf(pg, demote(target)),
      };
    });

    expect(outcomes).toEqual({
      demotion: LAST_ADMIN,
      multiRowDemotion: LAST_ADMIN,
      removal: LAST_ADMIN,
      moveToAnotherUser: INSUFFICIENT_PRIVILEGE,
      moveRecorded: 0,
      adminSession: LAST_ADMIN,
      accountDeletion: null,
      cascadeRecorded: 0,
      message: "The school must keep at least one admin.",
    });
  });

  it("serialises concurrent demotions: the second waits on the guard's advisory lock", async () => {
    const first = await userWithRole(admin, "admin");
    const second = await userWithRole(admin, "admin");
    const [holder, waiter, observer] = await Promise.all([connectPostgres(), connectPostgres(), connectPostgres()]);
    try {
      const { rows } = await waiter.query<{ pid: number }>("select pg_backend_pid() as pid");
      const waiterPid = rows[0]?.pid;

      await holder.query("begin");
      await holder.query("update public.user_roles set role = 'author' where user_id = $1", [first]);

      await waiter.query("begin");
      await waiter.query("set local lock_timeout = '10s'");
      const blocked = waiter.query("update public.user_roles set role = 'author' where user_id = $1", [second]);

      const waited = await eventually(() => waitsOnGuardLock(observer, waiterPid));
      await holder.query("rollback");
      await blocked;

      expect(waited).toBe(true);
    } finally {
      await Promise.allSettled([holder.query("rollback"), waiter.query("rollback")]);
      await Promise.all([holder.end(), waiter.end(), observer.end()]);
    }
  });
});

/** A fresh user holding `role`, given by the service role (an operator write), and its id. */
const userWithRole = async (admin: SupabaseClient, role: AppRole): Promise<string> => {
  const { id } = await createAuthUser(admin);
  const { error } = await admin.from("user_roles").insert({ user_id: id, role });
  if (error) throw new Error(`setup failed: ${error.message}`);
  return id;
};

const demote = (userId: string): Statement => ({
  sql: "update public.user_roles set role = 'author' where user_id = $1",
  params: [userId],
});

/** The JWT claims a signed-in session carries, as `auth.uid()` reads them. */
const claimsFor = (userId: string): string => JSON.stringify({ sub: userId, role: "authenticated" });

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

/**
 * Run a case's statements in a savepoint, then roll back to it whatever happened. Returns the
 * SQLSTATE that stopped them, or null when every statement succeeded.
 */
const sqlstateOf = async (pg: Client, statements: Statement[]): Promise<string | null> =>
  inSavepoint(pg, async () => {
    try {
      await statements.reduce<Promise<unknown>>(async (previous, { sql, params }) => {
        await previous;
        return pg.query(sql, params);
      }, Promise.resolve());
      return null;
    } catch (error) {
      return sqlstateFrom(error);
    }
  });

/** The message a refused statement raises. Throws when the statement succeeds. */
const messageOf = async (pg: Client, { sql, params }: Statement): Promise<string> =>
  inSavepoint(pg, async () => {
    try {
      await pg.query(sql, params);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error(`expected a refusal: ${sql}`);
  });

const inSavepoint = async <T>(pg: Client, work: () => Promise<T>): Promise<T> => {
  await pg.query("savepoint guard_case");
  try {
    return await work();
  } finally {
    await pg.query("rollback to savepoint guard_case");
  }
};

const sqlstateFrom = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  throw error;
};

const recordsNaming = async (pg: Client, userIds: string[]): Promise<number> => {
  const { rows } = await pg.query<{ count: number }>(
    "select count(*)::int as count from public.access_changes where target_id = any ($1::uuid[])",
    [userIds],
  );
  return rows[0]?.count ?? 0;
};

const lastAccessChangeId = async (pg: Client): Promise<number> => {
  const { rows } = await pg.query<{ id: number }>("select coalesce(max(id), 0)::int as id from public.access_changes");
  return rows[0]?.id ?? 0;
};

/**
 * Records a cascaded removal would have left: `role_removed` rows newer than `afterId` naming the
 * deleted user, or naming nobody, since the FK sets the target to null as the user goes. Runs in
 * its own savepoint, after deleting the user there. A parallel file cannot add one: its role writes
 * wait on this transaction's table lock, and its direct record inserts always name a live user.
 */
const cascadeRecordsAfterDeletion = async (pg: Client, userId: string, afterId: number): Promise<number> =>
  inSavepoint(pg, async () => {
    await pg.query("delete from auth.users where id = $1", [userId]);
    const { rows } = await pg.query<{ count: number }>(
      `select count(*)::int as count
         from public.access_changes
        where id > $1 and kind = 'role_removed' and (target_id is null or target_id = $2)`,
      [afterId, userId],
    );
    return rows[0]?.count ?? 0;
  });

const waitsOnGuardLock = async (observer: Client, pid: number | undefined): Promise<boolean> => {
  const { rows } = await observer.query<{ waiting: boolean }>(
    `select exists (
       select 1 from pg_locks
        where locktype = 'advisory' and not granted and pid = $1 and classid = 0 and objid = $2
     ) as waiting`,
    [pid, GUARD_LOCK_KEY],
  );
  return rows[0]?.waiting ?? false;
};

/** Polls `check` every 50 ms for up to 5 s; true as soon as it holds. */
const eventually = async (check: () => Promise<boolean>, deadline = Date.now() + 5_000): Promise<boolean> => {
  if (await check()) return true;
  if (Date.now() > deadline) return false;
  await new Promise((resolve) => setTimeout(resolve, 50));
  return eventually(check, deadline);
};
