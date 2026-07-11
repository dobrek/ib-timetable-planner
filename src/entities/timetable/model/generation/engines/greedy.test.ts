import { describe, expect, it } from "vitest";
import { placement } from "../../__fixtures__/builders";
import { SYNTHETIC_FLAGGED_COURSE_ID, syntheticGeneratorSnapshot } from "../__fixtures__/synthetic-catalog";
import type { GeneratorSnapshot } from "../types";
import { verifyGeneration } from "../verify";
import { generatePlanGreedy } from "./greedy";

const BUDGET = { budgetMs: 2_000 };

const totalDeficit = (snapshot: GeneratorSnapshot): number =>
  ["dp1", "dp2"].reduce(
    (sum, cohort) =>
      sum + snapshot.cohorts[cohort as "dp1" | "dp2"].courses.reduce((hours, course) => hours + course.hours, 0),
    0,
  );

describe("generatePlanGreedy", () => {
  it("solves the synthetic catalog completely and the verify judge accepts it", async () => {
    const snapshot = syntheticGeneratorSnapshot();

    const result = await generatePlanGreedy(snapshot, BUDGET);

    expect(result.placements).toHaveLength(totalDeficit(snapshot));
    expect(result.diagnostics.cohorts.dp1.unplaced).toEqual([]);
    expect(result.diagnostics.cohorts.dp2.unplaced).toEqual([]);
    const verdict = verifyGeneration(snapshot, result.placements);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("honours the hard-rule matrix on its output (2/day cap, weeks, flagged edges)", async () => {
    const snapshot = syntheticGeneratorSnapshot();

    const { placements } = await generatePlanGreedy(snapshot, BUDGET);

    // 2/day cap per concrete week
    const dayCounts = new Map<string, number>();
    for (const row of placements) {
      for (const week of row.week === "both" ? ["a", "b"] : [row.week]) {
        const key = `${row.courseId}|${row.day}|${week}`;
        dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
      }
    }
    expect([...dayCounts.values()].every((count) => count <= 2)).toBe(true);
    // biweekly rows carry a concrete week; agnostic rows stay `both`
    const biweeklyIds = new Set(
      [...snapshot.cohorts.dp1.courses, ...snapshot.cohorts.dp2.courses]
        .filter((course) => course.weekMode === "biweekly")
        .map((course) => course.id),
    );
    expect(placements.every((row) => (biweeklyIds.has(row.courseId) ? row.week !== "both" : row.week === "both"))).toBe(
      true,
    );
    // the flagged course landed (edge rule is proven by the verify acceptance above)
    expect(placements.filter((row) => row.courseId === SYNTHETIC_FLAGGED_COURSE_ID)).toHaveLength(2);
  });

  it("fills the gaps only: pins stay untouched and their hours are not re-placed", async () => {
    const snapshot = syntheticGeneratorSnapshot();
    snapshot.cohorts.dp1.pins = [placement("pin-1", "dp1-math", 1, 2)];

    const result = await generatePlanGreedy(snapshot, BUDGET);

    const mathRows = result.placements.filter((row) => row.courseId === "dp1-math");
    expect(mathRows).toHaveLength(2); // 3 required − 1 pinned
    expect(mathRows.some((row) => row.day === 1 && row.period === 2)).toBe(false);
    expect(verifyGeneration(snapshot, result.placements).ok).toBe(true);
  });

  it("skips deficits covered by parked bundles", async () => {
    const snapshot = syntheticGeneratorSnapshot();
    snapshot.cohorts.dp2.parkedCourseIds = ["dp2-chemistry", "dp2-chemistry"];

    const result = await generatePlanGreedy(snapshot, BUDGET);

    expect(result.placements.filter((row) => row.courseId === "dp2-chemistry")).toHaveLength(0);
  });

  it("resolves best-so-far with a partial marker when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await generatePlanGreedy(
      syntheticGeneratorSnapshot(),
      { budgetMs: 60_000 },
      {
        signal: controller.signal,
      },
    );

    expect(result.diagnostics.partial).toBe(true);
    // attempt 1 runs before the cancel check, so the board is still a valid best-so-far
    expect(verifyGeneration(syntheticGeneratorSnapshot(), result.placements).ok).toBe(true);
  });

  it("reports progress against the budget while running", async () => {
    const ticks: number[] = [];

    await generatePlanGreedy(
      syntheticGeneratorSnapshot(),
      { budgetMs: 150 },
      {
        onProgress: ({ elapsedMs }) => {
          ticks.push(elapsedMs);
        },
      },
    );

    expect(ticks.length).toBeGreaterThan(0);
  });
});
