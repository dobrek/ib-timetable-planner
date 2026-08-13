import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createSolverTransport } from "@/entities/timetable";
import { checkGeneration, startGeneration } from "@/_pages/plan-detail/api";
import { addCourse, addStudentWithChoices, addTeacher, createPlan, registerPlan, teardown } from "@/test/factories";

/**
 * S-301's north star, driven end to end on every push: Generate → real CP-SAT solve → server-side
 * oracle → id translation → a complete board on the proposal plan.
 *
 * Every other suite in this change cuts the chain somewhere. `generation-enqueue` fakes the transport;
 * `generation-delivery` fakes the solver by writing the row it would have written; `test_service.py`
 * fakes PostgREST. Each is right to — but a chain of individually-correct links is not a proven chain,
 * and the failure this exists to catch is the one at a JOIN: a snapshot the solver reads differently
 * than the app wrote it, a hash the two languages compute differently, a board whose course ids the
 * clone does not recognise. Nothing hermetic can see those.
 *
 * **A tiny fixture, deliberately.** The full catalog is a ~12-minute solve (measured twice: research,
 * and again during this slice at 10 m 43 s). Four courses across two cohorts exercise the identical
 * ten-tier ladder in seconds. Timing budgets are S-308's; this is a wiring proof.
 *
 * Gated on `SOLVER_URL` exactly like `solver-transport.integration.test.ts`, so it joins the CI
 * integration job that already boots the service — and fails loudly there if the wiring ever stops
 * exporting it, rather than skipping into a green tick with zero coverage.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOLVER_URL = process.env.SOLVER_URL;

if (process.env.CI === "true" && SUPABASE_URL && !SOLVER_URL) {
  throw new Error(
    "The generation proposal E2E needs SOLVER_URL. The integration job must launch the service and " +
      "export its URL to $GITHUB_ENV before vitest runs.",
  );
}

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && SOLVER_URL);

/** A hang detector, not a performance bar: the fixture solves in ~1-2 s. */
const SETTLE_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 250;

(hasEnv ? describe : describe.skip)("generation proposal (full chain)", () => {
  let admin: SupabaseClient<Database>;
  let planId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    planId = await createPlan(admin, { name: `E2E generation ${crypto.randomUUID()}` });

    // Two courses per cohort, disjoint teachers, one student each — completable, and every tier of
    // the ladder still runs. `hoursPerWeek: 2` gives the doubles tier something real to say.
    for (const cohort of ["dp1", "dp2"] as const) {
      for (const suffix of ["a", "b"]) {
        const { teacherId } = await addTeacher(admin, { planId, code: `T-${cohort}-${suffix}` });
        const { courseId } = await addCourse(admin, {
          planId,
          cohort,
          name: `Course ${cohort}-${suffix}`,
          hoursPerWeek: 2,
          teacherIds: [teacherId],
        });
        await addStudentWithChoices(admin, {
          planId,
          cohort,
          fullName: `Student ${cohort}-${suffix}`,
          courseIds: [courseId],
        });
      }
    }
  });

  afterAll(async () => {
    if (hasEnv) await teardown(admin);
  });

  it(
    "generates, verifies server-side, and lands a complete board on the proposal plan",
    async () => {
      if (!SOLVER_URL) throw new Error("unreachable: gated above");

      // The exact call the Generate button makes, through the exact transport production uses.
      const { jobId, proposalPlanId } = await startGeneration(
        admin,
        { planId },
        { getTransport: () => createSolverTransport(SOLVER_URL) },
      );
      registerPlan(proposalPlanId);

      // Test-side polling only. The APP does not poll — the author's next visit is the trigger
      // (S-303 owns polling) — but a test cannot revisit a page, so it waits here instead.
      const settled = await settle(admin, jobId);
      expect(settled.error).toBeNull();
      expect(settled.status).toBe("succeeded");

      // ...and now the delivery half, which is what a visit would have run.
      const view = await checkGeneration(admin, { planId });

      expect(view).toMatchObject({ jobId, status: "succeeded", delivered: true, proposalPlanId });
      // Clean mode is the shipped default and this fixture has no availability at all, so the floor
      // is 0 and the strict FR-302 reading applies.
      expect(view?.cleanLabel).toEqual({ kind: "clean" });

      // The proposal carries a COMPLETE board: 4 courses x 2 hours, all placed.
      const applied = await placementsOn(admin, proposalPlanId);
      expect(applied).toHaveLength(8);

      // Under the CLONE's course ids — the natural-key translation actually ran. Source ids are a
      // disjoint set (`clone_plan` re-mints every UUID), so an untranslated board would fail the FK
      // before it ever got here; this asserts the sets are disjoint as expected.
      const sourceCourseIds = new Set((await coursesOn(admin, planId)).map((row) => row.id));
      expect(applied.every((row) => !sourceCourseIds.has(row.course_id))).toBe(true);

      // The SOURCE plan is untouched. That is the whole promise of a proposal.
      expect(await placementsOn(admin, planId)).toHaveLength(0);

      // Delivery is recorded, so a second visit is a no-op rather than a second apply.
      const again = await checkGeneration(admin, { planId });
      expect(again).toMatchObject({ delivered: true, proposalPlanId });
      expect(await placementsOn(admin, proposalPlanId)).toHaveLength(8);
    },
    SETTLE_TIMEOUT_MS + 60_000,
  );
});

const placementsOn = async (supabase: SupabaseClient<Database>, planId: string) =>
  (await supabase.from("placements").select("cohort, course_id, day, period, week").eq("plan_id", planId)).data ?? [];

const coursesOn = async (supabase: SupabaseClient<Database>, planId: string) =>
  (await supabase.from("courses").select("id").eq("plan_id", planId)).data ?? [];

type JobRow = Pick<Database["public"]["Tables"]["generation_jobs"]["Row"], "status" | "error">;

/** Poll to terminal with a NARROW projection — a bare select would drag the TOASTed snapshot per tick. */
const settle = async (supabase: SupabaseClient<Database>, jobId: string): Promise<JobRow> => {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  const seen: string[] = [];

  for (;;) {
    const { data, error } = await supabase.from("generation_jobs").select("status, error").eq("id", jobId).single();
    if (error) throw new Error(`poll: ${error.message}`);
    if (seen.at(-1) !== data.status) seen.push(data.status);

    if (["succeeded", "failed", "stopped", "interrupted"].includes(data.status)) return data;
    if (Date.now() > deadline) {
      // Name the states observed: a row stuck at `queued` means the worker never claimed it — the
      // service's one silent-failure surface — and a bare timeout would not say so.
      throw new Error(`job ${jobId} never settled; observed: ${seen.join(" -> ")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
};
