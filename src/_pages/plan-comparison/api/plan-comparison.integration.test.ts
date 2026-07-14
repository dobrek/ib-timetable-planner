import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { computeCatalogHash } from "@/shared/lib/catalog-hash";
import { analyzePlan, verifyGeneration } from "@/entities/timetable";
import {
  addAvailability,
  addCourse,
  addStudentWithChoices,
  addTeacher,
  createPlan,
  placeCourse,
  registerPlan,
  teardown,
} from "@/test/factories";
import { diffCatalogs } from "../model/catalog-diff";
import { computeCatalogFingerprint } from "../model/catalog-fingerprint";
import { driftTier } from "../model/drift-tier";
import { loadComparison } from "./load-comparison";
import { loadPlanAnalysis } from "./load-plan-analysis";

/**
 * The loader is the only part of the comparison feature with real failure modes — ~15 round trips
 * across two waves, a widened catalog projection, and two consumers (the bench CLI and the in-app
 * surface) that must never disagree. So it is tested against the real stack.
 *
 * Local-only (service_role key, bypasses RLS); skips when the env/stack is absent. State is built
 * through `src/test/factories/` and torn down at the end — never asserted against the shared dev seed.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

let supabase: SupabaseClient<Database>;

beforeAll(() => {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
});

afterAll(async () => {
  await teardown(supabase);
});

(hasEnv ? describe : describe.skip)("loadPlanAnalysis", () => {
  it("loads a well-formed analyzer input, resolving natural keys and feeding both the extractor and the oracle", async () => {
    const scenario = await buildScenario();

    const plan = await loadPlanAnalysis(supabase, scenario.planId);

    // Plan identity + the parsed grid the drift tier compares on.
    expect(plan.id).toBe(scenario.planId);
    expect(plan.input.days).toBe(5);
    expect(plan.input.periods).toBe(10);

    // The analyzer input carries the course catalog with its subject identity joined on — the
    // `courseIdentity` side-set, which replaced this loader's second `courses` query.
    const maths = plan.input.courses.dp1.find((course) => course.id === scenario.maths);
    expect(maths).toMatchObject({ name: "Maths", level: "HL", groupIndex: 5, hours: 2 });
    expect(maths?.studentKeys).toEqual([scenario.student]);
    expect(maths?.teacherKeys).toEqual([scenario.teacher]);

    // The board arrives as engine-shaped rows, cohort-tagged.
    expect(plan.board).toEqual(
      expect.arrayContaining([expect.objectContaining({ cohort: "dp1", courseId: scenario.maths, day: 1, period: 1 })]),
    );

    // Availability rides along, teacher-keyed.
    expect(plan.input.availability).toEqual(
      expect.arrayContaining([{ teacherKey: scenario.teacher, day: 2, period: 4, severity: "soft" }]),
    );

    // Natural keys resolve — the fingerprint hashes these, and the scoreboard renders its extremes
    // through them. This is what turns a worst-teacher UUID into a name.
    expect(plan.naturalKeys.teachers[scenario.teacher]).toEqual({ code: "AB", fullName: "Ada Byron" });
    expect(plan.naturalKeys.students[scenario.student]).toBe("Alan Turing");

    // Catalog anomalies are surfaced, not swallowed: the zero-hours course reads as "complete"
    // downstream unless it is named beside the numbers.
    expect(plan.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ cohort: "dp1", kind: "zero-hours" })]),
    );

    // Both downstream consumers accept the loaded plan: the oracle judges the board, and the
    // extractor folds it into a feature vector.
    const verdict = verifyGeneration(plan.snapshot, plan.board);
    expect(typeof verdict.ok).toBe("boolean");
    expect(verdict.softWarnCount).toBeGreaterThanOrEqual(0);

    const features = analyzePlan(plan.input);
    expect(features.cohorts.dp1.board.placementRows).toBe(2);
    expect(features.cohorts.dp1.completeness.uncataloguedRows).toBe(0);
  });

  it("throws a plan-id-naming error for a plan that does not exist", async () => {
    await expect(loadPlanAnalysis(supabase, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/);
  });

  /**
   * The load-bearing test — the entire reason `computeCatalogFingerprint` exists.
   *
   * `clone_plan` deep-copies the catalog and **re-mints every UUID**. So the source and its clone are
   * the same catalog by any meaning a human would accept, yet `computeCatalogHash` — which digests
   * `course.id` / `teacherKeys` / `studentKeys` — necessarily disagrees. If the comparison surface
   * used that hash to detect drift, cloning a plan and generating onto it (the analyzer's own
   * validated workflow) would light up the drift banner every single time.
   *
   * Both halves are asserted: fingerprints EQUAL, catalog hashes DIFFERENT. The second half is what
   * makes the first half meaningful rather than a tautology about a function that ignores its input.
   */
  it("fingerprints a clone_plan copy EQUAL to its source, while computeCatalogHash reports them as different", async () => {
    const scenario = await buildScenario();
    const clonedId = await cloneViaRpc(scenario.planId, "Comparison Clone");

    const [source, clone] = await Promise.all([
      loadPlanAnalysis(supabase, scenario.planId),
      loadPlanAnalysis(supabase, clonedId),
    ]);

    // Precondition: the clone really did re-mint the ids. Without this the test proves nothing.
    const sourceIds = source.input.courses.dp1.map((course) => course.id).sort();
    const cloneIds = clone.input.courses.dp1.map((course) => course.id).sort();
    expect(cloneIds).not.toEqual(sourceIds);

    // The old hash cannot see through the re-minting…
    expect(await computeCatalogHash(source.input.courses.dp1)).not.toBe(
      await computeCatalogHash(clone.input.courses.dp1),
    );

    // …the natural-key fingerprint can.
    expect(await computeCatalogFingerprint(clone)).toBe(await computeCatalogFingerprint(source));
    expect(driftTier(diffCatalogs(source, clone))).toBe("clean");
  });

  it("names the drift when a student is added to one side", async () => {
    const scenario = await buildScenario();
    const clonedId = await cloneViaRpc(scenario.planId, "Comparison Drifting Clone");

    // Enrol a new student on the clone's Maths — the same mutation the E2E spec drives through the UI.
    const clonedMaths = await courseIdByName(clonedId, "Maths");
    await addStudentWithChoices(supabase, {
      planId: clonedId,
      cohort: "dp1",
      fullName: "Katherine Johnson",
      courseIds: [clonedMaths],
    });

    const [source, clone] = await Promise.all([
      loadPlanAnalysis(supabase, scenario.planId),
      loadPlanAnalysis(supabase, clonedId),
    ]);
    const diff = diffCatalogs(source, clone);

    expect(await computeCatalogFingerprint(clone)).not.toBe(await computeCatalogFingerprint(source));
    expect(diff.students).toEqual({ added: 1, removed: 0, changed: 0 });
    expect(diff.choices).toEqual({ added: 1, removed: 0, changed: 0 });
    expect(driftTier(diff)).toBe("catalog-drift");
  });
});

/**
 * Drives the `clone_plan` RPC directly, the way `clone-plan.integration.test.ts` does. Deliberately
 * NOT via `plans-list`'s `clonePlan` domain function: that would be a same-layer cross-slice `_pages`
 * import, which steiger forbids. The RPC is the mechanism under test here anyway — it is what re-mints
 * every UUID, and that re-minting is the precise reason this fingerprint exists.
 */
/**
 * Per-plan error isolation, against the real stack.
 *
 * `loadPlanAnalysis` THROWS on a missing plan (its signature is pinned so `bench/` keeps working), an
 * uncaught throw in Astro frontmatter is a 500, and `Promise.all` is all-or-nothing — so one deleted
 * plan id would take down the whole page *including the plans that loaded fine*. This URL is built to
 * be shared and bookmarked and plans are deletable, so a stale link is the ordinary case.
 */
const GHOST = "00000000-0000-0000-0000-000000000000";

(hasEnv ? describe : describe.skip)("loadComparison — per-plan error isolation", () => {
  it("renders the plans that loaded and NAMES the one that did not", async () => {
    const { planId } = await buildScenario();

    const result = await loadComparison(supabase, [planId, GHOST], planId);

    expect(result.data).not.toBeNull();
    expect(result.data?.plans.map((plan) => plan.id)).toEqual([planId]);
    expect(result.missingPlanIds).toEqual([GHOST]);
    // The page still has something to show — it must not 404.
    expect(result.data?.sections.length).toBeGreaterThan(0);
  });

  it("returns no data when NOT ONE plan resolves — the route's only 404", async () => {
    const result = await loadComparison(supabase, [GHOST], GHOST);

    expect(result.data).toBeNull();
    expect(result.missingPlanIds).toEqual([GHOST]);
  });

  it("falls back to a loaded plan when the designated BASELINE is the missing one, and says so", async () => {
    const { planId } = await buildScenario();

    // Deltas are baseline-relative, so a silently-missing baseline would render a whole scoreboard of
    // meaningless numbers.
    const result = await loadComparison(supabase, [GHOST, planId], GHOST);

    expect(result.data?.baselineId).toBe(planId);
    expect(result.data?.baselineFellBack).toBe(true);
    expect(result.missingPlanIds).toEqual([GHOST]);
  });
});

const cloneViaRpc = async (sourcePlanId: string, name: string): Promise<string> => {
  const { data, error } = await supabase.rpc("clone_plan", {
    p_source_plan_id: sourcePlanId,
    p_name: name,
    p_include_board: true,
  });
  if (error) throw new Error(`clone_plan: ${error.message}`);
  registerPlan(data);
  return data;
};

const courseIdByName = async (planId: string, name: string): Promise<string> => {
  const { data, error } = await supabase
    .from("courses")
    .select("id")
    .eq("plan_id", planId)
    .eq("name", name)
    .single<{ id: string }>();
  if (error) throw new Error(`courseIdByName(${name}): ${error.message}`);
  return data.id;
};

type Scenario = {
  planId: string;
  teacher: string;
  student: string;
  maths: string;
};

/**
 * A minimal dp1 plan: one teacher, a 2-hour Maths HL placed twice, and a deliberately zero-hours
 * course so the loader's `warnings` pass-through is exercised on real data rather than asserted
 * vacuously.
 */
async function buildScenario(): Promise<Scenario> {
  const planId = await createPlan(supabase, { name: "Comparison Loader Scenario" });
  const { teacherId } = await addTeacher(supabase, { planId, code: "AB", fullName: "Ada Byron" });

  const { courseId: maths } = await addCourse(supabase, {
    planId,
    cohort: "dp1",
    name: "Maths",
    level: "HL",
    groupIndex: 5,
    hoursPerWeek: 2,
    teacherIds: [teacherId],
  });
  const { courseId: ghost } = await addCourse(supabase, {
    planId,
    cohort: "dp1",
    name: "Theory of Knowledge",
    level: "none",
    hoursPerWeek: 0,
    teacherIds: [teacherId],
  });

  const { studentId } = await addStudentWithChoices(supabase, {
    planId,
    cohort: "dp1",
    fullName: "Alan Turing",
    courseIds: [maths, ghost],
  });

  await placeCourse(supabase, { planId, cohort: "dp1", courseId: maths, day: 1, period: 1 });
  await placeCourse(supabase, { planId, cohort: "dp1", courseId: maths, day: 3, period: 2 });
  await addAvailability(supabase, { planId, teacherId, day: 2, period: 4, severity: "soft" });

  return { planId, teacher: teacherId, student: studentId, maths };
}
