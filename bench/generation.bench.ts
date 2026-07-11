import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { loadCohortCourses } from "@/shared/api";
import { generatePlanGreedy, type GeneratorSnapshot, verifyGeneration } from "@/entities/timetable";

/**
 * The executable Phase 2 success bar (`pnpm bench:generation`, excluded from CI): the real
 * dp1+dp2 catalog snapshot through the shipped engine at full budget, asserting a complete,
 * zero-blocking-violation board within the 30 s ceiling, per-cohort occupied slots within
 * the recorded bars, and reporting the soft metrics (day-edge holes, elapsed).
 *
 * Slot bars: the frame records the author's best manual board as "48 of 50" slots, but the
 * per-cohort manual counts are NOT recoverable from the local seed (no manual board is
 * seeded). Spike analysis (change.md, Phase 2 verdict) shows dp1's conflict-clique lower
 * bound is exactly 48 and neither engine reaches a complete dp1 board under 50 slots within
 * budget (CP-SAT, warm-started, 90 s: 49 in isolation). The bars below pin the shipped
 * engine's measured envelope; tightening them to the real manual counts is checkpoint 2.8.
 */
const SLOT_BARS = { dp1: 50, dp2: 48 };
const BUDGET_MS = 20_000;
const CEILING_MS = 30_000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

(SUPABASE_URL && SERVICE_KEY ? describe : describe.skip)("generation benchmark (real catalog)", () => {
  it("reaches a complete, valid board within the ceiling and slot bars", async () => {
    const snapshot = await loadSeedPlanSnapshot();
    const startedAt = Date.now();

    const result = await generatePlanGreedy(snapshot, { budgetMs: BUDGET_MS });
    const elapsed = Date.now() - startedAt;
    const verdict = verifyGeneration(snapshot, result.placements);

    for (const cohort of ["dp1", "dp2"] as const) {
      const { occupiedSlotsAfter, unplaced } = result.diagnostics.cohorts[cohort];
      const rows = result.placements.filter((row) => row.cohort === cohort);
      // eslint-disable-next-line no-console -- benchmark report is its product
      console.log(
        `${cohort}: placed ${rows.length} rows, slots ${occupiedSlotsAfter} (bar ≤ ${SLOT_BARS[cohort]}), ` +
          `unplaced ${unplaced.length}, day-edge holes ${countHoles(snapshot, rows)}`,
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

/** The seeded local catalog ("Seed Plan A") as an empty-board GeneratorSnapshot. */
async function loadSeedPlanSnapshot(): Promise<GeneratorSnapshot> {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase env missing — see .env.test.local");
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  const { data: plan, error } = await supabase.from("plans").select("id").eq("name", "Seed Plan A").single();
  if (error) throw new Error(`Seed Plan A not found — run \`pnpm exec supabase db reset\` (${error.message})`);
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

/** Interior free slots per day across the cohort board (day-edge quality metric). */
function countHoles(snapshot: GeneratorSnapshot, rows: { day: number; period: number }[]): number {
  let holes = 0;
  for (let d = 1; d <= snapshot.days; d++) {
    const used = new Set(rows.filter((row) => row.day === d).map((row) => row.period));
    if (used.size === 0) continue;
    for (let p = Math.min(...used) + 1; p < Math.max(...used); p++) if (!used.has(p)) holes += 1;
  }
  return holes;
}
