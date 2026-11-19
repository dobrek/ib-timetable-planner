import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, SupabaseClient } from "@/shared/api";
import {
  createAuthUser,
  createPlan,
  createSignedInMachineUser,
  generationJobRow,
  strongPassword,
  teardown,
  type SignedInMachineUser,
} from "@/test/factories";
import { decodeAccessClaims } from "./access-claims";
import { connectPostgres, heldColumnPrivileges, heldPrivileges } from "./postgres-client";
import { createPublishableClient } from "./publishable-client";
import { readPublishableKey } from "./publishable-key";

/**
 * The job-email notifier's credential (S-310): its guard test, mirroring the solver's.
 *
 * The cron signs in as a machine Auth user whose `app_metadata.machine_role` is `job_notifier`, and
 * the Custom Access Token Hook rewrites the token's role claim to the role of the same name. This
 * suite pins that role's whole posture, from the token and from the catalog:
 *
 * - **The claim.** The token says `job_notifier`, and an unrecognised `machine_role` still yields
 *   `authenticated`, which reaches no data since S-403.
 * - **Reach, by column.** SELECT on exactly the job, plan and recipient columns the sweep reads, and
 *   UPDATE on exactly the three email markers. Never `error` (free text holding ids) or `snapshot`
 *   (the only place student keys live), and nothing table-wide on any table.
 * - **Reach, by row.** Every job that asked for an email, settled or not: the SELECT policy cannot
 *   also say "unsettled", because PostgREST's UPDATE carries a RETURNING and Postgres checks the new
 *   row against SELECT policies, so every settle write would fail 42501 (measured for the solver,
 *   `20260812141459`). A person's directory and role rows, and a plan's name, only while a job of
 *   theirs still has an email to settle: a leaked credential reads a handful of addresses, not the
 *   staff directory.
 * - **The policies,** name and predicate, from `pg_policies`. The role matrix leaves machine-only
 *   policies out (`MACHINE_ROLES`), so this suite is where they are held.
 *
 * The sweep suite (`job-email.integration.test.ts`) runs the real sweep, which is global, in parallel
 * with this file. So every unsettled opted-in job here is `running` with a fresh heartbeat (the sweep
 * always waits on it), and every settled one is stamped by the service role.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

type JobInsert = Database["public"]["Tables"]["generation_jobs"]["Insert"];

/** The 18 columns the sweep reads: job facts, the email markers, and the board's diagnostics. */
const READABLE_JOB_COLUMNS = [
  "checkpoint",
  "checkpoint_stage_index",
  "created_at",
  "email_claimed_at",
  "email_outcome",
  "email_requested",
  "emailed_at",
  "finished_at",
  "heartbeat_at",
  "id",
  "plan_id",
  "policy",
  "proposal_plan_id",
  "requested_by",
  "result",
  "started_at",
  "status",
  "stop_requested_by",
];

/** The one predicate the lookup policies share: a job that asked for an email and is not settled. */
const DUE = "j.email_requested AND (j.emailed_at IS NULL)";

(hasEnv ? describe : describe.skip)("job notifier credential", () => {
  let admin: SupabaseClient;
  let notifier: SignedInMachineUser;
  let pg: Client;
  /** Requests the due job: the notifier sees their directory and role rows. */
  let requesterId: string;
  /** Requests only a settled job: the notifier sees neither of their rows. */
  let settledRequesterId: string;
  /** Requests only a job that never asked for an email: likewise unseen. */
  let bystanderId: string;
  let sourcePlanId: string;
  let proposalPlanId: string;
  let settledPlanId: string;
  let optedOutPlanId: string;
  let settlePlanId: string;
  let dueJobId: string;
  let settledJobId: string;
  let optedOutJobId: string;
  /** Unsettled and opted in, for the notifier to settle under its own session. */
  let settleJobId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    pg = await connectPostgres();

    [notifier, { id: requesterId }, { id: settledRequesterId }, { id: bystanderId }] = await Promise.all([
      createSignedInMachineUser(admin, "job_notifier"),
      createAuthUser(admin),
      createAuthUser(admin),
      createAuthUser(admin),
    ]);
    await giveRoles(admin, [requesterId, settledRequesterId, bystanderId]);

    [sourcePlanId, proposalPlanId, settledPlanId, optedOutPlanId, settlePlanId] = await Promise.all(
      Array.from({ length: 5 }, () => createPlan(admin)),
    );
    const now = new Date().toISOString();
    const running = { status: "running", started_at: now, heartbeat_at: now } as const;
    [dueJobId, settledJobId, optedOutJobId, settleJobId] = await Promise.all([
      insertJob(admin, sourcePlanId, {
        ...running,
        proposal_plan_id: proposalPlanId,
        requested_by: requesterId,
        email_requested: true,
        error: "never readable",
      }),
      insertJob(admin, settledPlanId, {
        status: "succeeded",
        finished_at: now,
        requested_by: settledRequesterId,
        email_requested: true,
        emailed_at: now,
        email_outcome: "sent",
      }),
      insertJob(admin, optedOutPlanId, { status: "succeeded", finished_at: now, requested_by: bystanderId }),
      insertJob(admin, settlePlanId, { ...running, requested_by: requesterId, email_requested: true }),
    ]);
  }, 30_000);

  afterAll(async () => {
    try {
      await teardown(admin);
    } finally {
      await pg.end();
    }
  });

  describe("the token", () => {
    it("carries the job_notifier role claim", () => {
      expect(decodeAccessClaims(notifier.accessToken).role).toBe("job_notifier");
    });

    it("stays authenticated for an unrecognised machine_role: the hook maps exactly two values", async () => {
      const password = strongPassword();
      const { email } = await createAuthUser(admin, { password, appMetadata: { machine_role: "job_notifier_x" } });
      const client = createPublishableClient(SUPABASE_URL ?? "", PUBLISHABLE_KEY ?? "");
      const { data, error } = await client.auth.signInWithPassword({ email, password });

      expect(error).toBeNull();
      expect(decodeAccessClaims(data.session?.access_token ?? "").role).toBe("authenticated");
    });
  });

  describe("reach, by column", () => {
    it("holds no table-wide privilege on any public table", async () => {
      const { rows } = await pg.query<{ table: string }>(
        `select format('public.%I', table_name) as table
           from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'
          order by 1`,
      );
      const held = await Promise.all(
        rows.map(async ({ table }) => ({ table, held: await heldPrivileges(pg, "job_notifier", table) })),
      );

      expect(held.filter(({ held: verbs }) => verbs.length > 0)).toEqual([]);
    });

    it("reaches exactly four tables, and only through column grants", async () => {
      // By oid from `pg_class`, not by name from `information_schema`: the planner may evaluate the
      // privilege check before the schema filter, and a name outside `public` does not resolve.
      const { rows } = await pg.query<{ relname: string }>(
        `select c.relname
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind in ('r', 'p')
            and has_any_column_privilege('job_notifier', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
          order by 1`,
      );

      expect(rows.map(({ relname }) => relname)).toEqual(["generation_jobs", "plans", "user_directory", "user_roles"]);
    });

    it("reads exactly the job columns the sweep needs", async () => {
      expect(await heldColumnPrivileges(pg, "job_notifier", "public.generation_jobs", "SELECT")).toEqual(
        READABLE_JOB_COLUMNS,
      );
    });

    it("writes exactly the three email markers", async () => {
      expect(await heldColumnPrivileges(pg, "job_notifier", "public.generation_jobs", "UPDATE")).toEqual([
        "email_claimed_at",
        "email_outcome",
        "emailed_at",
      ]);
    });

    it("reads a plan's name, a recipient's address and fences, and nothing else of theirs", async () => {
      expect(await heldColumnPrivileges(pg, "job_notifier", "public.plans", "SELECT")).toEqual(["id", "name"]);
      expect(await heldColumnPrivileges(pg, "job_notifier", "public.user_directory", "SELECT")).toEqual([
        "email",
        "must_change_password",
        "user_id",
      ]);
      expect(await heldColumnPrivileges(pg, "job_notifier", "public.user_roles", "SELECT")).toEqual([
        "deactivated_at",
        "user_id",
      ]);
      for (const table of ["public.plans", "public.user_directory", "public.user_roles"]) {
        expect(await heldColumnPrivileges(pg, "job_notifier", table, "UPDATE"), table).toEqual([]);
        expect(await heldColumnPrivileges(pg, "job_notifier", table, "INSERT"), table).toEqual([]);
      }
    });

    it("cannot read the error text, the snapshot, or a bare select=*", async () => {
      for (const column of ["error", "snapshot", "notified_at"] as const) {
        const { error } = await notifier.client.from("generation_jobs").select(column).eq("id", dueJobId);
        expect(error?.code, `${column} should be unreadable`).toBe("42501");
      }
      const { error: star } = await notifier.client.from("generation_jobs").select().eq("id", dueJobId);
      expect(star?.code).toBe("42501");
    });

    it("cannot read any other table", async () => {
      for (const table of ["courses", "students", "teachers", "placements"] as const) {
        const { error } = await notifier.client.from(table).select("id");
        expect(error?.code, `${table} should be unreachable`).toBe("42501");
      }
      const profiles = await notifier.client.from("profiles").select("user_id");
      expect(profiles.error?.code, "profiles should be unreachable").toBe("42501");
      const changes = await notifier.client.from("access_changes").select("id");
      expect(changes.error?.code, "access_changes should be unreachable").toBe("42501");
    });

    it("cannot write a job's status or its badge marker, nor insert or delete a job", async () => {
      const status = await notifier.client.from("generation_jobs").update({ status: "failed" }).eq("id", dueJobId);
      expect(status.error?.code).toBe("42501");
      const notified = await notifier.client
        .from("generation_jobs")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", dueJobId);
      expect(notified.error?.code).toBe("42501");

      const inserted = await notifier.client.from("generation_jobs").insert(await generationJobRow(sourcePlanId));
      expect(inserted.error?.code).toBe("42501");
      const deleted = await notifier.client.from("generation_jobs").delete().eq("id", dueJobId);
      expect(deleted.error?.code).toBe("42501");

      expect(await jobOf(admin, dueJobId)).toMatchObject({ status: "running", notified_at: null });
    });

    it("has no BYPASSRLS and cannot log in: the policies are load-bearing", async () => {
      const { rows } = await pg.query<{ rolbypassrls: boolean; rolcanlogin: boolean }>(
        `select rolbypassrls, rolcanlogin from pg_roles where rolname = 'job_notifier'`,
      );
      expect(rows[0]).toEqual({ rolbypassrls: false, rolcanlogin: false });
    });
  });

  describe("reach, by row", () => {
    it("sees every job that asked for an email, settled ones included, and none that did not", async () => {
      const { data, error } = await notifier.client
        .from("generation_jobs")
        .select("id")
        .in("id", [dueJobId, settledJobId, optedOutJobId]);

      expect(error).toBeNull();
      expect(data?.map(({ id }) => id).sort()).toEqual([dueJobId, settledJobId].sort());
    });

    it("claims and settles an unsettled job under its own session, and cannot settle it twice", async () => {
      const claimedAt = new Date().toISOString();
      const claim = await notifier.client
        .from("generation_jobs")
        .update({ email_claimed_at: claimedAt })
        .eq("id", settleJobId)
        .is("emailed_at", null)
        .select("id");
      expect(claim.error).toBeNull();
      expect(claim.data).toHaveLength(1);

      const settle = await notifier.client
        .from("generation_jobs")
        .update({ emailed_at: new Date().toISOString(), email_outcome: "expired" })
        .eq("id", settleJobId)
        .is("emailed_at", null)
        .select("id");
      expect(settle.error).toBeNull();
      expect(settle.data).toHaveLength(1);

      // USING requires an unsettled row, so a second settle matches nothing: no error, no change.
      const again = await notifier.client
        .from("generation_jobs")
        .update({ email_outcome: "sent" })
        .eq("id", settleJobId)
        .select("id");
      expect(again.error).toBeNull();
      expect(again.data).toEqual([]);
      expect(await jobOf(admin, settleJobId)).toMatchObject({ email_outcome: "expired" });
    });

    it("cannot touch a job that never asked for an email", async () => {
      const { data, error } = await notifier.client
        .from("generation_jobs")
        .update({ emailed_at: new Date().toISOString(), email_outcome: "sent" })
        .eq("id", optedOutJobId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect(await jobOf(admin, optedOutJobId)).toMatchObject({ emailed_at: null, email_outcome: null });
    });

    it("sees the directory row of a requester with an email due, and nobody else's", async () => {
      const { data, error } = await notifier.client
        .from("user_directory")
        .select("user_id, email, must_change_password")
        .in("user_id", [requesterId, settledRequesterId, bystanderId]);

      expect(error).toBeNull();
      expect(data?.map(({ user_id }) => user_id)).toEqual([requesterId]);
    });

    it("sees the role row of a requester with an email due, and nobody else's", async () => {
      const { data, error } = await notifier.client
        .from("user_roles")
        .select("user_id, deactivated_at")
        .in("user_id", [requesterId, settledRequesterId, bystanderId]);

      expect(error).toBeNull();
      expect(data?.map(({ user_id }) => user_id)).toEqual([requesterId]);
    });

    it("sees the source plan of a job with an email due, and no other plan, its proposal included", async () => {
      const { data, error } = await notifier.client
        .from("plans")
        .select("id, name")
        .in("id", [sourcePlanId, proposalPlanId, settledPlanId, optedOutPlanId]);

      expect(error).toBeNull();
      expect(data?.map(({ id }) => id)).toEqual([sourcePlanId]);
    });
  });

  it("pins every job_notifier policy's name and predicate", async () => {
    const { rows } = await pg.query<{
      tablename: string;
      policyname: string;
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `select tablename, policyname, cmd,
              regexp_replace(qual, '\\s+', ' ', 'g') as qual,
              regexp_replace(with_check, '\\s+', ' ', 'g') as with_check
         from pg_policies
        where schemaname = 'public' and roles = '{job_notifier}'
        order by tablename, cmd, policyname`,
    );

    expect(rows).toEqual([
      {
        tablename: "generation_jobs",
        policyname: "Notifier reads jobs that asked for an email",
        cmd: "SELECT",
        qual: "email_requested",
        with_check: null,
      },
      {
        tablename: "generation_jobs",
        policyname: "Notifier settles a job's email once",
        cmd: "UPDATE",
        qual: "(email_requested AND (emailed_at IS NULL))",
        with_check: "email_requested",
      },
      {
        tablename: "plans",
        policyname: "Notifier reads the plans of jobs with an email due",
        cmd: "SELECT",
        qual: `(EXISTS ( SELECT 1 FROM generation_jobs j WHERE (${DUE} AND (j.plan_id = plans.id))))`,
        with_check: null,
      },
      {
        tablename: "user_directory",
        policyname: "Notifier reads requesters with an email due",
        cmd: "SELECT",
        qual: `(EXISTS ( SELECT 1 FROM generation_jobs j WHERE (${DUE} AND (j.requested_by = user_directory.user_id))))`,
        with_check: null,
      },
      {
        tablename: "user_roles",
        policyname: "Notifier reads the roles of requesters with an email due",
        cmd: "SELECT",
        qual: `(EXISTS ( SELECT 1 FROM generation_jobs j WHERE (${DUE} AND (j.requested_by = user_roles.user_id))))`,
        with_check: null,
      },
    ]);

    // No policy anywhere names the role beside another one: machine-only policies stay machine-only.
    const { rows: mixed } = await pg.query(
      `select policyname from pg_policies where 'job_notifier' = any(roles) and roles <> '{job_notifier}'`,
    );
    expect(mixed).toEqual([]);
  });
});

/** Give each user an author role, as an admin would: the requesters are real, unfenced people. */
const giveRoles = async (admin: SupabaseClient, userIds: string[]): Promise<void> => {
  const { error } = await admin.from("user_roles").insert(userIds.map((user_id) => ({ user_id, role: "author" })));
  if (error) throw new Error(`setup: assign roles: ${error.message}`);
};

/** A job on `planId`, inserted by the service role with `fields` over the minimal row. */
const insertJob = async (admin: SupabaseClient, planId: string, fields: Partial<JobInsert>): Promise<string> => {
  const id = randomUUID();
  const { error } = await admin.from("generation_jobs").insert({ id, ...(await generationJobRow(planId)), ...fields });
  if (error) throw new Error(`setup: insert job: ${error.message}`);
  return id;
};

const jobOf = async (admin: SupabaseClient, jobId: string) => {
  const { data, error } = await admin
    .from("generation_jobs")
    .select("status, notified_at, emailed_at, email_outcome")
    .eq("id", jobId)
    .single();
  if (error) throw new Error(`read-back: ${error.message}`);
  return data;
};
