import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { computeSnapshotHash } from "@/entities/timetable";
import { createPlan, teardown } from "@/test/factories";
import { connectPostgres, heldPrivileges } from "./postgres-client";
import { readPublishableKey } from "./publishable-key";

/**
 * The solver credential's guard test — load-bearing, not hardening.
 *
 * The design (machine Auth user -> Custom Access Token Hook -> `solver_job_writer`) has one
 * failure mode, and it is silent: if the hook is disabled or errors, GoTrue mints the machine
 * user a plain `authenticated` token, which — given `alter default privileges` and the
 * `using (true)` policy on every table — reaches the ENTIRE database. The spike proved it by
 * returning real plan names. Nothing about that failure looks like a failure: the container
 * connects, reads its job, and works perfectly while holding far too much.
 *
 * So this suite asserts the claim AND the denial, because either alone can false-negative: a role
 * claim could be right while a grant is too wide, and a `plans` denial could come from RLS rather
 * than from the grant layer. `has_table_privilege` settles the second question from the catalog,
 * per lessons.md ("prove the posture, don't read the migration text").
 *
 * The kill-switch drill for this is in docs/runbooks/solver-credential.md: disable the hook in
 * config.toml, restart, and confirm this file goes RED. A guard test that cannot be shown to fail
 * is not yet a guard.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();

// In CI the stack is always present, so a missing publishable key means the workflow stopped
// exporting it — fail the run loudly rather than let the guard silently skip (the silent-zero-
// coverage trap that `load-test-env.ts` guards the other two vars against).
if (process.env.CI === "true" && SUPABASE_URL && !PUBLISHABLE_KEY) {
  throw new Error(
    "The solver-credential guard needs the stack's publishable key as SUPABASE_KEY. Set " +
      "`export-anon-key: 'true'` on the integration job's supabase-stack step.",
  );
}

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

(hasEnv ? describe : describe.skip)("solver credential", () => {
  let admin: SupabaseClient<Database>;
  /** The container's view of the world: publishable key + a password grant, nothing else. */
  let solver: SupabaseClient<Database>;
  let pg: Client;
  let machineUserId: string;
  let accessToken: string;
  let planId: string;
  let jobId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY || !PUBLISHABLE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    pg = await connectPostgres();

    const email = `solver-guard-${randomUUID()}@example.test`;
    const password = randomUUID();
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // Admin-API-only, never user-writable — which is what makes it safe for the hook to trust.
      app_metadata: { machine_role: "solver_job_writer" },
    });
    if (created.error) throw new Error(`machine user: ${created.error.message}`);
    machineUserId = created.data.user.id;

    solver = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await solver.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`password grant: ${signedIn.error.message}`);
    accessToken = signedIn.data.session.access_token;

    planId = await createPlan(admin);
    jobId = await insertJob(admin, planId);
  });

  afterAll(async () => {
    if (machineUserId) await admin.auth.admin.deleteUser(machineUserId);
    await teardown(admin);
    await pg.end();
  });

  it("mints a token whose role claim is solver_job_writer, not authenticated", () => {
    expect(decodeClaims(accessToken).role).toBe("solver_job_writer");
  });

  it("cannot read plans — the escalation the hook-misfire fallback would hand it", async () => {
    const { data, error } = await solver.from("plans").select("id, name");

    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("cannot read any other table either — reachability is scoped to exactly one", async () => {
    for (const table of ["students", "teachers", "courses", "placements"] as const) {
      const { error } = await solver.from(table).select("id");
      expect(error?.code, `${table} should be unreachable`).toBe("42501");
    }
  });

  it("reads its job and advances it within the policy", async () => {
    const read = await solver.from("generation_jobs").select("id, status").eq("id", jobId).single();
    expect(read.error).toBeNull();
    expect(read.data?.status).toBe("queued");

    const advanced = await solver.from("generation_jobs").update({ status: "running" }).eq("id", jobId);
    expect(advanced.error).toBeNull();
  });

  it("cannot insert or delete a job — the Worker enqueues, and a run's record is not erasable", async () => {
    const inserted = await solver.from("generation_jobs").insert(await jobRow(planId));
    expect(inserted.error?.code).toBe("42501");

    const deleted = await solver.from("generation_jobs").delete().eq("id", jobId);
    expect(deleted.error?.code).toBe("42501");
  });

  it("cannot re-queue a job or touch one that already reached a terminal state", async () => {
    // WITH CHECK: 'queued' is not a state the solver may declare.
    const requeued = await solver.from("generation_jobs").update({ status: "queued" }).eq("id", jobId);
    expect(requeued.error?.code).toBe("42501");

    // USING: once terminal, the row is outside the policy's window entirely. A no-op update is
    // not an error in PostgREST — it matches zero rows — so assert on the row, not on `error`.
    await admin.from("generation_jobs").update({ status: "succeeded" }).eq("id", jobId);
    await solver.from("generation_jobs").update({ status: "failed" }).eq("id", jobId);

    const after = await admin.from("generation_jobs").select("status").eq("id", jobId).single();
    expect(after.data?.status).toBe("succeeded");
  });

  it("holds SELECT and UPDATE on generation_jobs at the grant layer, and nothing on plans", async () => {
    expect(await heldPrivileges(pg, "solver_job_writer", "public.generation_jobs")).toEqual(["SELECT", "UPDATE"]);
    expect(await heldPrivileges(pg, "solver_job_writer", "public.plans")).toEqual([]);
  });

  it("has no BYPASSRLS attribute — the policies above are load-bearing", async () => {
    const { rows } = await pg.query<{ rolbypassrls: boolean; rolcanlogin: boolean }>(
      `select rolbypassrls, rolcanlogin from pg_roles where rolname = 'solver_job_writer'`,
    );
    expect(rows[0]).toEqual({ rolbypassrls: false, rolcanlogin: false });
  });
});

/** A JWT's payload, decoded without verification — the signature is GoTrue's business; the claim
 *  the container will be judged by is ours. */
const decodeClaims = (token: string): { role?: string } => {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("access token is not a JWT");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role?: string };
};

const jobRow = async (planId: string): Promise<Database["public"]["Tables"]["generation_jobs"]["Insert"]> => {
  const snapshot = {
    days: 5,
    periods: 10,
    availability: [],
    finishesEarlyByCourseId: [],
    cohorts: {
      dp1: { courses: [], pins: [], parkedCourseIds: [] },
      dp2: { courses: [], pins: [], parkedCourseIds: [] },
    },
  };
  return {
    plan_id: planId,
    policy: { budgetMs: 20_000, mode: "full" },
    snapshot,
    snapshot_hash: await computeSnapshotHash(snapshot),
  };
};

const insertJob = async (supabase: SupabaseClient<Database>, planId: string): Promise<string> => {
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert(await jobRow(planId))
    .select("id")
    .single();
  if (error) throw new Error(`insertJob: ${error.message}`);
  return data.id;
};
