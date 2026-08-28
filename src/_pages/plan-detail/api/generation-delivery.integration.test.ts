import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import type { GeneratedPlacement, GenerationResult, SolverTransport } from "@/entities/timetable";
import {
  addCourse,
  addStudentWithChoices,
  addTeacher,
  createPlan as createFactoryPlan,
  registerPlan,
  teardown,
} from "@/test/factories";
import { checkPlan } from "./generation-delivery";
import { startGeneration } from "./generation-job";

/**
 * Delivery against the real local stack, with the SOLVER simulated by writing the row it would have
 * written. No CP-SAT here on purpose: a real solve is ~12 minutes (Phase 5 runs the true chain), and
 * everything this suite is about happens strictly AFTER the solver's terminal write.
 *
 * So the fixture is honest where it matters: the job row is created by the REAL enqueue path (so its
 * `snapshot` is a real assembled snapshot and its clone is a real `clone_plan` clone), and only the
 * `result`/`stages`/`status` columns are written by hand — exactly the three the service owns.
 *
 * The tiny topology (one course, one teacher, one student per cohort) is deliberate: the natural-key
 * translation and the region-replace are what is under test, and they are no more interesting at 84
 * courses than at two. Keeping it small also keeps the suite off the local stack's back.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

const acceptingTransport: SolverTransport = {
  dispatchSolveJob: () => Promise.resolve(),
  checkHealth: () => Promise.resolve(true),
};

(hasEnv ? describe : describe.skip)("checkPlan (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;

  /** A minimal two-cohort plan: each cohort gets one 1-hour course with a teacher and a student. */
  const tinyPlan = async (label: string): Promise<{ planId: string; dp1CourseId: string; dp2CourseId: string }> => {
    const planId = await createFactoryPlan(supabase, { name: `Delivery ${label} ${crypto.randomUUID()}` });
    const courseIds: Record<"dp1" | "dp2", string> = { dp1: "", dp2: "" };
    for (const cohort of ["dp1", "dp2"] as const) {
      const { teacherId } = await addTeacher(supabase, { planId, code: `T-${cohort}-${label}` });
      const { courseId } = await addCourse(supabase, {
        planId,
        cohort,
        name: `Course ${cohort}`,
        hoursPerWeek: 1,
        teacherIds: [teacherId],
      });
      await addStudentWithChoices(supabase, { planId, cohort, fullName: `S ${cohort}`, courseIds: [courseId] });
      courseIds[cohort] = courseId;
    }
    return { planId, dp1CourseId: courseIds.dp1, dp2CourseId: courseIds.dp2 };
  };

  /** Enqueue for real, then write the terminal row the solver would have written. */
  const solvedJob = async (
    planId: string,
    placements: GeneratedPlacement[],
    softHits = 0,
  ): Promise<{ jobId: string; proposalPlanId: string }> => {
    const { jobId, proposalPlanId } = await startGeneration(
      supabase,
      { planId },
      { getTransport: () => acceptingTransport },
    );
    registerPlan(proposalPlanId);

    const result: GenerationResult = {
      placements,
      diagnostics: {
        engine: "cp-sat",
        elapsedMs: 1234,
        partial: false,
        provenOptimal: true,
        cohorts: {
          dp1: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 1, unplaced: [] },
          dp2: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 1, unplaced: [] },
        },
      },
    };
    const { error } = await supabase
      .from("generation_jobs")
      .update({
        status: "succeeded",
        result,
        stages: [{ tier: 5, name: "softHits", status: "OPTIMAL", best: softHits, bound: softHits, wallClockS: 1 }],
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (error) throw new Error(`solvedJob: ${error.message}`);
    return { jobId, proposalPlanId };
  };

  const placementsOn = async (planId: string) =>
    (await supabase.from("placements").select("cohort, course_id, day, period, week").eq("plan_id", planId)).data ?? [];

  const jobRow = async (jobId: string) =>
    (
      await supabase
        .from("generation_jobs")
        .select("status, delivered_plan_id, proposal_plan_id, delivery, error")
        .eq("id", jobId)
        .single()
    ).data;

  const pendingOf = async (planId: string): Promise<boolean | undefined> =>
    (await supabase.from("plans").select("pending_proposal").eq("id", planId).maybeSingle()).data?.pending_proposal;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    if (hasEnv) await teardown(supabase);
  });

  it("verifies, translates the course ids, applies to the clone, and marks delivered", async () => {
    const { planId, dp1CourseId, dp2CourseId } = await tinyPlan("apply");
    const board: GeneratedPlacement[] = [
      { cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" },
      { cohort: "dp2", courseId: dp2CourseId, day: 2, period: 3, week: "both" },
    ];
    const { jobId, proposalPlanId } = await solvedJob(planId, board);

    const view = await checkPlan(supabase, { planId });

    expect(view).toMatchObject({ jobId, status: "succeeded", delivered: true, proposalPlanId });
    expect(view?.cleanLabel).toEqual({ kind: "clean" });
    // S-306's delivery vocabulary rides in the delivered marker's own CAS, so the pair cannot disagree.
    expect(await jobRow(jobId)).toMatchObject({ delivered_plan_id: proposalPlanId, delivery: "proposal" });
    // ...and the proposal has stopped being a job artifact: from here it is an ordinary plan.
    expect(await pendingOf(proposalPlanId)).toBe(false);

    // The board landed on the CLONE, under the clone's own course ids — never the source's.
    const applied = await placementsOn(proposalPlanId);
    expect(applied).toHaveLength(2);
    expect(applied.map((row) => row.course_id)).not.toContain(dp1CourseId);
    expect(applied.map((row) => ({ cohort: row.cohort, day: row.day, period: row.period })).sort(byCell)).toEqual(
      [
        { cohort: "dp1", day: 1, period: 1 },
        { cohort: "dp2", day: 2, period: 3 },
      ].sort(byCell),
    );

    // ...and the SOURCE plan is untouched. The whole point of a proposal.
    expect(await placementsOn(planId)).toHaveLength(0);
  });

  it("is idempotent: a second check delivers nothing further and reports the same state", async () => {
    const { planId, dp1CourseId } = await tinyPlan("idempotent");
    const { proposalPlanId } = await solvedJob(planId, [
      { cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" },
    ]);

    const first = await checkPlan(supabase, { planId });
    const second = await checkPlan(supabase, { planId });

    expect(first?.delivered).toBe(true);
    expect(second).toMatchObject({ delivered: true, proposalPlanId });
    expect(await placementsOn(proposalPlanId)).toHaveLength(1);
  });

  it("delivers exactly once when two tabs check concurrently", async () => {
    // The on-visit trigger makes this the NORMAL case, not an edge one: two open tabs both fire on
    // mount. The delivered marker is a compare-and-set, so the loser simply reports the same state.
    const { planId, dp1CourseId } = await tinyPlan("concurrent");
    const { proposalPlanId } = await solvedJob(planId, [
      { cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" },
    ]);

    const views = await Promise.all([
      checkPlan(supabase, { planId }),
      checkPlan(supabase, { planId }),
      checkPlan(supabase, { planId }),
    ]);

    expect(views.every((view) => view?.delivered)).toBe(true);
    // One row, not three: a re-applied region replace converges rather than duplicating.
    expect(await placementsOn(proposalPlanId)).toHaveLength(1);
  });

  it("refuses a board the oracle rejects, fails the job, and removes the orphan clone", async () => {
    // Two courses sharing a teacher, dropped into the same cell — a blocking collision the oracle
    // must catch. An unverified board must never reach a proposal plan.
    const planId = await createFactoryPlan(supabase, { name: `Delivery reject ${crypto.randomUUID()}` });
    const { teacherId } = await addTeacher(supabase, { planId, code: `T-shared-${crypto.randomUUID()}` });
    const courses = await Promise.all(
      ["A", "B"].map(async (name) => {
        const { courseId } = await addCourse(supabase, {
          planId,
          cohort: "dp1",
          name,
          hoursPerWeek: 1,
          teacherIds: [teacherId],
        });
        await addStudentWithChoices(supabase, { planId, cohort: "dp1", fullName: `S ${name}`, courseIds: [courseId] });
        return courseId;
      }),
    );
    const { jobId, proposalPlanId } = await solvedJob(
      planId,
      courses.map((courseId) => ({ cohort: "dp1" as const, courseId, day: 1, period: 1, week: "both" as const })),
    );

    const view = await checkPlan(supabase, { planId });

    expect(view).toMatchObject({ status: "failed", delivered: false, proposalPlanId: null });
    expect(await jobRow(jobId)).toMatchObject({ status: "failed", delivered_plan_id: null });
    expect((await jobRow(jobId))?.error).toMatch(/did not pass verification/);
    // The clone is gone, so nothing half-generated is left on the plans list.
    expect((await supabase.from("plans").select("id").eq("id", proposalPlanId)).data).toEqual([]);
  });

  it("sweeps the orphan clone of a job that failed in the solver", async () => {
    const { planId } = await tinyPlan("solver-failed");
    const { jobId, proposalPlanId } = await solvedJob(planId, []);
    await supabase
      .from("generation_jobs")
      .update({ status: "failed", error: "infeasible: the snapshot admits no complete board" })
      .eq("id", jobId);

    const view = await checkPlan(supabase, { planId });

    expect(view).toMatchObject({ status: "failed", proposalPlanId: null });
    expect(view?.error).toMatch(/infeasible/);
    expect((await supabase.from("plans").select("id").eq("id", proposalPlanId)).data).toEqual([]);
  });

  it("delivers a STOPPED job that kept a checkpoint, exactly as an interrupted one", async () => {
    // S-305 owns the producer of a `stopped` row; S-306 only widens the predicate, because the two
    // statuses differ solely in WHO halted the run — the author asked, or the platform took the
    // container away. A checkpoint is written through the same wire path either way.
    const { planId, dp1CourseId } = await tinyPlan("stopped");
    const { jobId, proposalPlanId } = await solvedJob(planId, [
      { cohort: "dp1", courseId: dp1CourseId, day: 3, period: 2, week: "both" },
    ]);
    const solved = (await supabase.from("generation_jobs").select("result").eq("id", jobId).single()).data;
    await supabase
      .from("generation_jobs")
      .update({ status: "stopped", result: null, checkpoint: solved?.result, checkpoint_stage_index: 5 })
      .eq("id", jobId);

    const view = await checkPlan(supabase, { planId });

    expect(view).toMatchObject({ status: "stopped", delivered: true, proposalPlanId, checkpointStageIndex: 5 });
    expect(await jobRow(jobId)).toMatchObject({ delivered_plan_id: proposalPlanId, delivery: "proposal" });
    expect(await pendingOf(proposalPlanId)).toBe(false);
    expect(await placementsOn(proposalPlanId)).toHaveLength(1);
  });

  it("sweeps a STOPPED job that kept nothing, exactly as an interrupted one", async () => {
    const { planId } = await tinyPlan("stopped-empty");
    const { jobId, proposalPlanId } = await solvedJob(planId, []);
    await supabase
      .from("generation_jobs")
      .update({ status: "stopped", result: null, checkpoint: null, checkpoint_stage_index: null })
      .eq("id", jobId);

    const view = await checkPlan(supabase, { planId });

    expect(view).toMatchObject({ status: "stopped", delivered: false, proposalPlanId: null });
    expect((await supabase.from("plans").select("id").eq("id", proposalPlanId)).data).toEqual([]);
  });

  it("leaves a DETACHED clone un-pending when translation fails, so it is never stranded read-only", async () => {
    // The one terminal branch that keeps the clone alive: its catalog diverged from the source's, so
    // the natural key cannot bridge the two id spaces. The clone carries the very edits that caused
    // the mismatch, which is why it is detached rather than swept — but detaching it removes the last
    // job that referenced it, so if delivery did not clear the flag here NOTHING ever would and the
    // plan would be un-renameable, un-deletable and boardless forever.
    //
    // Reached by a service-role write on purpose: since S-306 the app cannot edit a pending plan at
    // all, so this branch is unreachable through the UI — which makes it exactly the kind of branch
    // that rots untested.
    const { planId, dp1CourseId } = await tinyPlan("mismatch");
    const { jobId, proposalPlanId } = await solvedJob(planId, [
      { cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" },
    ]);
    // The natural key is `(cohort, name, level, groupIndex)`; moving `name` on the clone breaks it.
    await supabase.from("courses").update({ name: "Renamed behind the guard" }).eq("plan_id", proposalPlanId);

    const view = await checkPlan(supabase, { planId });

    expect(view).toMatchObject({ status: "failed", delivered: false, proposalPlanId: null });
    // Read the reason off the ROW, not the view: every `failJob` branch returns the row as it was
    // read, so the diagnostic is visible from the next visit on — the same shape the oracle-rejection
    // case above asserts.
    expect((await jobRow(jobId))?.error).toMatch(/could not be translated/);
    // Detached, not deleted...
    expect((await supabase.from("plans").select("id").eq("id", proposalPlanId)).data).toHaveLength(1);
    // ...and released, so the author can rename or delete it by hand.
    expect(await pendingOf(proposalPlanId)).toBe(false);
    expect(await jobRow(jobId)).toMatchObject({ proposal_plan_id: null, delivered_plan_id: null, delivery: null });
  });

  it("reports an active job without touching the proposal", async () => {
    const { planId } = await tinyPlan("active");
    const { proposalPlanId } = await startGeneration(supabase, { planId }, { getTransport: () => acceptingTransport });
    registerPlan(proposalPlanId);

    const view = await checkPlan(supabase, { planId });

    expect(view).toMatchObject({ status: "queued", delivered: false, proposalPlanId });
    expect(view?.cleanLabel).toEqual({ kind: "unavailable" });
    expect(await placementsOn(proposalPlanId)).toHaveLength(0);
    // Still guarded: nothing has been delivered, so the clone is still the solve's apply target.
    expect(await pendingOf(proposalPlanId)).toBe(true);
  });

  /**
   * S-306's second key. The same job row is reachable from the source plan and from the proposal, and
   * the only thing the key decides is the `role` tag — which is what makes the strip tell two
   * different stories about one row.
   */
  describe("keyed by the proposal", () => {
    it("delivers from a visit to the PROPOSAL, and the source stays untouched", async () => {
      // The delivering visit no longer has to be to the source. This is what makes the proposal page
      // able to poll itself into a board: delivery from that page is delivery TO that page.
      const { planId, dp1CourseId } = await tinyPlan("by-proposal");
      const { jobId, proposalPlanId } = await solvedJob(planId, [
        { cohort: "dp1", courseId: dp1CourseId, day: 4, period: 2, week: "both" },
      ]);

      const view = await checkPlan(supabase, { planId: proposalPlanId });

      expect(view).toMatchObject({ jobId, role: "proposal", delivered: true, sourcePlanId: planId });
      expect(await jobRow(jobId)).toMatchObject({ delivered_plan_id: proposalPlanId, delivery: "proposal" });
      expect(await pendingOf(proposalPlanId)).toBe(false);
      expect(await placementsOn(proposalPlanId)).toHaveLength(1);
      expect(await placementsOn(planId)).toHaveLength(0);
    });

    it("reads the source plan's NAME on the proposal role — the strip's provenance line", async () => {
      const { planId, dp1CourseId } = await tinyPlan("provenance");
      const { proposalPlanId } = await solvedJob(planId, [
        { cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" },
      ]);
      const sourceName = (await supabase.from("plans").select("name").eq("id", planId).single()).data?.name;

      const view = await checkPlan(supabase, { planId: proposalPlanId });

      expect(view?.sourcePlanName).toBe(sourceName);
      // ...and NOT read on the source role, where it would be a round trip for a name the page has.
      expect((await checkPlan(supabase, { planId }))?.sourcePlanName).toBeNull();
    });

    it("delivers exactly once when both keys are checked concurrently", async () => {
      // The realistic race: the author has the proposal page open (which polls) and clicks through to
      // the source. Two entry points, one compare-and-set, one applied board.
      const { planId, dp1CourseId } = await tinyPlan("both-keys");
      const { proposalPlanId } = await solvedJob(planId, [
        { cohort: "dp1", courseId: dp1CourseId, day: 2, period: 2, week: "both" },
      ]);

      const views = await Promise.all([
        checkPlan(supabase, { planId }),
        checkPlan(supabase, { planId: proposalPlanId }),
        checkPlan(supabase, { planId: proposalPlanId }),
      ]);

      expect(views.every((view) => view?.delivered)).toBe(true);
      expect(await placementsOn(proposalPlanId)).toHaveLength(1);
    });

    it("a plan that is BOTH prefers its own job while it has anything left to do", async () => {
      // A delivered proposal can itself be generated from, at which point it is the `proposal_plan_id`
      // of one job and the `plan_id` of another. Precedence: the plan's own job wins while it is
      // active or undelivered — a live solve the author launched HERE is the most urgent thing this
      // page can say, and it is the only row with anything to deliver. Its failure outranks
      // provenance too, by the same rule and for the same reason (FR-308: the source reports its own
      // failure until the next Generate).
      const { planId, dp1CourseId } = await tinyPlan("both-roles-own");
      const { proposalPlanId } = await solvedJob(planId, [
        { cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" },
      ]);
      await checkPlan(supabase, { planId: proposalPlanId });

      const second = await startGeneration(
        supabase,
        { planId: proposalPlanId },
        { getTransport: () => acceptingTransport },
      );
      registerPlan(second.proposalPlanId);

      expect(await checkPlan(supabase, { planId: proposalPlanId })).toMatchObject({
        jobId: second.jobId,
        role: "source",
        status: "queued",
      });

      await supabase
        .from("generation_jobs")
        .update({ status: "failed", error: "gave up", finished_at: new Date().toISOString() })
        .eq("id", second.jobId);

      expect(await checkPlan(supabase, { planId: proposalPlanId })).toMatchObject({
        jobId: second.jobId,
        role: "source",
        status: "failed",
      });
    });

    it("...and falls back to its provenance once its own job has delivered", async () => {
      // The other half of the rule. Once the plan's own job is settled AND delivered it has nothing
      // left to say here — the result is on ITS proposal — so the row that produced this plan takes
      // over again and the provenance strip comes back.
      const { planId, dp1CourseId } = await tinyPlan("both-roles-done");
      const { proposalPlanId } = await solvedJob(planId, [
        { cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" },
      ]);
      await checkPlan(supabase, { planId: proposalPlanId });

      // Generate FROM the delivered proposal, and let that second job deliver too.
      const second = await startGeneration(
        supabase,
        { planId: proposalPlanId },
        { getTransport: () => acceptingTransport },
      );
      registerPlan(second.proposalPlanId);
      const cloneCourse = (
        await supabase.from("courses").select("id").eq("plan_id", proposalPlanId).eq("cohort", "dp1").single()
      ).data;
      await supabase
        .from("generation_jobs")
        .update({
          status: "succeeded",
          result: {
            placements: [{ cohort: "dp1", courseId: cloneCourse?.id, day: 3, period: 3, week: "both" }],
            diagnostics: {
              engine: "cp-sat",
              elapsedMs: 1,
              partial: false,
              provenOptimal: true,
              cohorts: {
                dp1: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 1, unplaced: [] },
                dp2: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 0, unplaced: [] },
              },
            },
          },
          stages: [{ tier: 5, name: "softHits", status: "OPTIMAL", best: 0, bound: 0, wallClockS: 1 }],
          finished_at: new Date().toISOString(),
        })
        .eq("id", second.jobId);
      await checkPlan(supabase, { planId: proposalPlanId });

      expect(await checkPlan(supabase, { planId: proposalPlanId })).toMatchObject({
        role: "proposal",
        delivered: true,
        sourcePlanId: planId,
      });
    });
  });

  it("returns null for a plan that has never been generated", async () => {
    const planId = await createFactoryPlan(supabase, { name: `Delivery none ${crypto.randomUUID()}` });

    expect(await checkPlan(supabase, { planId })).toBeNull();
  });
});

const byCell = (a: { cohort: string; day: number }, b: { cohort: string; day: number }): number =>
  a.cohort.localeCompare(b.cohort) || a.day - b.day;
