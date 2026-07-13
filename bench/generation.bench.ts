import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { loadCohortCourses } from "@/shared/api";
import { countInteriorHoles, createGreedyEngine, type GeneratorSnapshot, verifyGeneration } from "@/entities/timetable";

/**
 * The executable real-catalog success bar (`pnpm bench:generation`, and the non-blocking `bench`
 * CI job): the real dp1+dp2 catalog snapshot through the shipped engine at an extended budget,
 * asserting a complete, zero-blocking-violation board within the ceiling, per-cohort occupied slots
 * within the recorded bars, and reporting the soft metrics (day-edge holes, elapsed).
 *
 * Slot bars — two different kinds:
 *   • dp1 ≤ 50 is a *deferred parity bar*: the frame records the author's best manual board as
 *     "48 of 50" but the per-cohort manual counts are not recoverable from the local seed, and
 *     spike analysis (change.md) shows dp1's clique lower bound is 48 while neither engine reaches
 *     a complete dp1 board under 50 within budget (CP-SAT, warm-started, 90 s: 49). Tightening it to
 *     the real manual count is checkpoint 2.8.
 *   • dp2 = 46 is a *regression envelope*: the shipped engine reliably reaches 46 here, so the bar
 *     guards against a search regression that loses those slots. It is NOT a claim about the manual
 *     optimum.
 *
 * Machine-speed independence: stagnation is wall-clock (`Date.now() - lastImproveAt`), so a faster
 * machine runs more rounds per window. The engine is built with a 10 s stagnation window and a 60 s
 * budget under a 90 s elapsed ceiling so the dp2 = 46 pin holds regardless of runner speed; pinning
 * it under the old short windows would flake. Fallback (Critical Implementation Details): if a local
 * run lands on 47, ship `≤ 47` here and record the observation in change.md.
 */
const SLOT_BARS = { dp1: 50, dp2: 46 };
const BUDGET_MS = 60_000;
const CEILING_MS = 90_000;

/** Seed Plan A's deterministic seed id. Plans are addressed **by id, never by name**: the previous
 *  name lookup ("Seed Plan A") broke the moment a differently-named plan was imported over the same
 *  seed data. Override to point the bench at any other catalog. */
const PLAN_ID = process.env.BENCH_PLAN_ID ?? "fefd03e5-fc72-4706-8a12-524811c9cf3f";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

(SUPABASE_URL && SERVICE_KEY ? describe : describe.skip)("generation benchmark (real catalog)", () => {
  it("reaches a complete, valid board within the ceiling and slot bars", async () => {
    const snapshot = await loadSeedPlanSnapshot();
    const startedAt = Date.now();

    // Extended stagnation window (see the bars comment) so the dp2 = 46 pin is machine-independent.
    const engine = createGreedyEngine({ stagnationMs: 10_000 });
    const result = await engine(snapshot, { budgetMs: BUDGET_MS });
    const elapsed = Date.now() - startedAt;
    const verdict = verifyGeneration(snapshot, result.placements);

    for (const cohort of ["dp1", "dp2"] as const) {
      const { occupiedSlotsAfter, unplaced } = result.diagnostics.cohorts[cohort];
      const rows = result.placements.filter((row) => row.cohort === cohort);
      // eslint-disable-next-line no-console -- benchmark report is its product
      console.log(
        `${cohort}: placed ${rows.length} rows, slots ${occupiedSlotsAfter} (bar ≤ ${SLOT_BARS[cohort]}), ` +
          `unplaced ${unplaced.length}, day-edge holes ${countInteriorHoles(rows, snapshot.days)}`,
      );
    }
    // eslint-disable-next-line no-console -- benchmark report is its product
    console.log(`elapsed ${elapsed} ms, soft availability warns ${verdict.softWarnCount}`);

    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(result.diagnostics.cohorts.dp1.unplaced).toEqual([]);
    expect(result.diagnostics.cohorts.dp2.unplaced).toEqual([]);
    expect(result.diagnostics.cohorts.dp1.occupiedSlotsAfter).toBeLessThanOrEqual(SLOT_BARS.dp1);
    expect(result.diagnostics.cohorts.dp2.occupiedSlotsAfter).toBeLessThanOrEqual(SLOT_BARS.dp2);
    expect(elapsed).toBeLessThan(CEILING_MS);
  });
});

/** The seeded local catalog (plan {@link PLAN_ID}) as an empty-board GeneratorSnapshot. */
async function loadSeedPlanSnapshot(): Promise<GeneratorSnapshot> {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase env missing — see .env.test.local");
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  const { data: plan, error } = await supabase.from("plans").select("id").eq("id", PLAN_ID).single();
  if (error)
    throw new Error(
      `Plan ${PLAN_ID} not found — run \`pnpm exec supabase db reset\`, or set BENCH_PLAN_ID to another plan (${error.message})`,
    );
  const [dp1, dp2, availability] = await Promise.all([
    loadCohortCourses(supabase, plan.id, "dp1"),
    loadCohortCourses(supabase, plan.id, "dp2"),
    supabase.from("teacher_availability").select("teacher_id, day, period, severity").eq("plan_id", plan.id),
  ]);
  return {
    days: 5,
    periods: 10,
    availability: (availability.data ?? []).map((row) => ({
      teacherKey: row.teacher_id,
      day: row.day,
      period: row.period,
      severity: row.severity,
    })),
    finishesEarlyByCourseId: [...dp1.finishesEarlyCourseIds, ...dp2.finishesEarlyCourseIds],
    cohorts: {
      dp1: { courses: dp1.courses, pins: [], parkedCourseIds: [] },
      dp2: { courses: dp2.courses, pins: [], parkedCourseIds: [] },
    },
  };
}
