import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { computeSnapshotHash } from "@/entities/timetable";
import { createPlan, teardown } from "@/test/factories";
import { connectPostgres, heldPrivileges } from "./postgres-client";

/**
 * `generation_jobs` posture and behaviour, proven against a live stack.
 *
 * Two halves, and the split is deliberate:
 *
 *   • GRANT-layer posture via `has_table_privilege`. `lessons.md` records a migration that
 *     commented "anon is intentionally excluded" while `anon` still held INSERT — the revoke had
 *     never been written. So the claim in this table's migration header is asserted here from the
 *     catalog, never inferred from the SQL text. This table additionally revokes the four non-DML
 *     privileges Supabase's auto-grant leaves behind (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN), which
 *     is what lets its header claim full anon exclusion honestly — so the assertion is an exact set
 *     equality, not a subset check.
 *
 *   • The three behaviours S-303 -> S-310 build on: one active job per plan, `updated_at` moving on
 *     its own, and the FK semantics (source cascades, produced plans set null). Each of those is a
 *     forward-designed decision that a later slice would otherwise have to rediscover.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

const TABLE = "public.generation_jobs";

(hasEnv ? describe : describe.skip)("generation_jobs", () => {
  let supabase: SupabaseClient<Database>;
  let pg: Client;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    pg = await connectPostgres();
  });

  afterAll(async () => {
    await teardown(supabase);
    await pg.end();
  });

  describe("grant-layer posture", () => {
    it("leaves anon with NOTHING — all eight privileges, not just the four DML verbs", async () => {
      expect(await heldPrivileges(pg, "anon", TABLE)).toEqual([]);
    });

    it("keeps the four DML verbs reachable for authenticated and service_role", async () => {
      // A SUBSET check, and the looseness is recorded rather than papered over: Supabase's
      // auto-grant also leaves these two roles holding TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on
      // every public table, and the repo's `alter default privileges` only ever names the four DML
      // verbs. That residue is repo-wide and pre-existing — F-301 narrows it for `anon` (where it
      // made a migration comment false) and deliberately does not re-posture the two trusted roles.
      const dml = ["DELETE", "INSERT", "SELECT", "UPDATE"];
      expect(await heldPrivileges(pg, "authenticated", TABLE)).toEqual(expect.arrayContaining(dml));
      expect(await heldPrivileges(pg, "service_role", TABLE)).toEqual(expect.arrayContaining(dml));
    });

    it("has row level security enabled — the grant layer is only half the lock", async () => {
      const { rows } = await pg.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = $1::regclass`,
        [TABLE],
      );
      expect(rows[0]?.relrowsecurity).toBe(true);
    });
  });

  describe("one active job per plan (FR-308)", () => {
    it("rejects a second queued job but allows one once the first reaches a terminal status", async () => {
      const planId = await createPlan(supabase);
      const first = await insertJob(supabase, planId);

      const blocked = await supabase.from("generation_jobs").insert(await jobRow(planId));
      expect(blocked.error?.code).toBe("23505");

      // 'running' is still active — the partial index covers both non-terminal states.
      await supabase.from("generation_jobs").update({ status: "running" }).eq("id", first);
      const stillBlocked = await supabase.from("generation_jobs").insert(await jobRow(planId));
      expect(stillBlocked.error?.code).toBe("23505");

      await supabase.from("generation_jobs").update({ status: "succeeded" }).eq("id", first);
      const allowed = await supabase.from("generation_jobs").insert(await jobRow(planId));
      expect(allowed.error).toBeNull();
    });

    it("scopes the constraint to one plan — a different plan may have its own active job", async () => {
      const [planA, planB] = [await createPlan(supabase), await createPlan(supabase)];
      await insertJob(supabase, planA);

      expect((await supabase.from("generation_jobs").insert(await jobRow(planB))).error).toBeNull();
    });
  });

  it("moves updated_at on its own (moddatetime, deliberately re-adopted for a mutable row)", async () => {
    const planId = await createPlan(supabase);
    const jobId = await insertJob(supabase, planId);
    const before = await readJob(supabase, jobId);

    await supabase.from("generation_jobs").update({ status: "running", stage_index: 2 }).eq("id", jobId);
    const after = await readJob(supabase, jobId);

    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
    expect(after.created_at).toBe(before.created_at);
  });

  describe("foreign-key semantics", () => {
    it("cascades from the source plan — teardown's plan-rooted isolation stays intact", async () => {
      const planId = await createPlan(supabase);
      const jobId = await insertJob(supabase, planId);

      await supabase.from("plans").delete().eq("id", planId);

      const { data } = await supabase.from("generation_jobs").select("id").eq("id", jobId);
      expect(data).toEqual([]);
    });

    it("nulls the produced-plan links instead of taking the job with them", async () => {
      const planId = await createPlan(supabase);
      const proposalId = await createPlan(supabase);
      const deliveredId = await createPlan(supabase);
      const jobId = await insertJob(supabase, planId, {
        proposal_plan_id: proposalId,
        delivered_plan_id: deliveredId,
        status: "succeeded",
      });

      // S-306 deletes the working clone on auto-apply; a cascading FK would erase the record of
      // every successful job, which is why these two deviate from the house cascade convention.
      await supabase.from("plans").delete().in("id", [proposalId, deliveredId]);

      const job = await readJob(supabase, jobId);
      expect(job.proposal_plan_id).toBeNull();
      expect(job.delivered_plan_id).toBeNull();
      expect(job.plan_id).toBe(planId);
    });
  });

  it("rejects a status outside the declared vocabulary", async () => {
    const planId = await createPlan(supabase);
    const { error } = await supabase.from("generation_jobs").insert({ ...(await jobRow(planId)), status: "pending" });

    expect(error?.code).toBe("23514");
  });
});

/** A minimal but honest job row: `snapshot_hash` is the real canonical digest of `snapshot`. */
const jobRow = async (
  planId: string,
  overrides: Partial<Database["public"]["Tables"]["generation_jobs"]["Insert"]> = {},
): Promise<Database["public"]["Tables"]["generation_jobs"]["Insert"]> => {
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
    ...overrides,
  };
};

const insertJob = async (
  supabase: SupabaseClient<Database>,
  planId: string,
  overrides: Partial<Database["public"]["Tables"]["generation_jobs"]["Insert"]> = {},
): Promise<string> => {
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert(await jobRow(planId, overrides))
    .select("id")
    .single();
  if (error) throw new Error(`insertJob: ${error.message}`);
  return data.id;
};

/** The poll projection this table is designed around — never `.select()` with no argument, which
 *  would drag the ~124 KB TOASTed snapshot across on every read (migration header). */
const POLL_COLUMNS = "id, plan_id, proposal_plan_id, delivered_plan_id, status, created_at, updated_at";

const readJob = async (supabase: SupabaseClient<Database>, jobId: string) => {
  const { data, error } = await supabase.from("generation_jobs").select(POLL_COLUMNS).eq("id", jobId).single();
  if (error) throw new Error(`readJob: ${error.message}`);
  return data;
};
