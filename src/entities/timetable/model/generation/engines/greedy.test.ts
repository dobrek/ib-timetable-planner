import { describe, expect, it } from "vitest";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { course, placement } from "../../__fixtures__/builders";
import { SYNTHETIC_FLAGGED_COURSE_ID, syntheticGeneratorSnapshot } from "../__fixtures__/synthetic-catalog";
import { countInteriorHoles } from "../objective";
import type { GeneratorSnapshot } from "../types";
import { verifyGeneration } from "../verify";
import { createGreedyEngine, generatePlanGreedy, maxWeightCliqueWeight } from "./greedy";

// Fast-tuned instance for the solve-quality tests: a 150 ms stagnation window lets easily-solved
// instances stop in ≲300 ms instead of burning a full multi-second budget, without stubbing
// `Date.now`. The cancel/progress/timing tests below keep the default `generatePlanGreedy` because
// they assert the shipped engine's real-time behaviour (abort latency, progress cadence).
const engine = createGreedyEngine({ stagnationMs: 150 });
const BUDGET = { budgetMs: 1_000 };

/** A single-hour course over one shared student — the minimal unit for the boxing regressions. */
const hourCourse = (id: string, teacher: string, studentKeys: string[]): GroupingCourse => ({
  ...course(id, teacher, studentKeys),
  hours: 1,
});

const totalDeficit = (snapshot: GeneratorSnapshot): number =>
  ["dp1", "dp2"].reduce(
    (sum, cohort) =>
      sum + snapshot.cohorts[cohort as "dp1" | "dp2"].courses.reduce((hours, course) => hours + course.hours, 0),
    0,
  );

describe("generatePlanGreedy", () => {
  it("solves the synthetic catalog completely and the verify judge accepts it", async () => {
    const snapshot = syntheticGeneratorSnapshot();

    const result = await engine(snapshot, BUDGET);

    expect(result.placements).toHaveLength(totalDeficit(snapshot));
    expect(result.diagnostics.cohorts.dp1.unplaced).toEqual([]);
    expect(result.diagnostics.cohorts.dp2.unplaced).toEqual([]);
    const verdict = verifyGeneration(snapshot, result.placements);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("honours the hard-rule matrix on its output (2/day cap, weeks, flagged edges)", async () => {
    const snapshot = syntheticGeneratorSnapshot();

    const { placements } = await engine(snapshot, BUDGET);

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

    const result = await engine(snapshot, BUDGET);

    const mathRows = result.placements.filter((row) => row.courseId === "dp1-math");
    expect(mathRows).toHaveLength(2); // 3 required − 1 pinned
    expect(mathRows.some((row) => row.day === 1 && row.period === 2)).toBe(false);
    expect(verifyGeneration(snapshot, result.placements).ok).toBe(true);
  });

  it("skips deficits covered by parked bundles", async () => {
    const snapshot = syntheticGeneratorSnapshot();
    snapshot.cohorts.dp2.parkedCourseIds = ["dp2-chemistry", "dp2-chemistry"];

    const result = await engine(snapshot, BUDGET);

    expect(result.placements.filter((row) => row.courseId === "dp2-chemistry")).toHaveLength(0);
  });

  describe("flagged-edge placement guard", () => {
    it("does not box a mid-day flagged pin — completes and verify accepts (regression)", async () => {
      // Review repro: flagged pin at (1,2) on a 1×4 grid, two single-hour same-student courses.
      // The pre-fix engine packed periods 3 and 1, boxing the pin → verify rejected the board.
      const snapshot: GeneratorSnapshot = {
        days: 1,
        periods: 4,
        availability: [],
        finishesEarlyByCourseId: ["flag"],
        cohorts: {
          dp1: {
            courses: [
              hourCourse("flag", "t-flag", ["s1"]),
              hourCourse("a", "t-a", ["s1"]),
              hourCourse("b", "t-b", ["s1"]),
            ],
            pins: [placement("pin-flag", "flag", 1, 2)],
            parkedCourseIds: [],
          },
          dp2: { courses: [], pins: [], parkedCourseIds: [] },
        },
      };

      const result = await engine(snapshot, BUDGET);

      expect(result.diagnostics.cohorts.dp1.unplaced).toEqual([]);
      expect(result.placements.filter((row) => row.courseId === "a" || row.courseId === "b")).toHaveLength(2);
      expect(verifyGeneration(snapshot, result.placements).ok).toBe(true);
    });

    it("places a generated flagged course at a day edge under spill pressure", async () => {
      // flag + two fillers all share s1 on a 1×3 grid; the only complete valid board keeps the
      // flagged course at an edge (period 1 or 3), never boxed at the interior period 2.
      const snapshot: GeneratorSnapshot = {
        days: 1,
        periods: 3,
        availability: [],
        finishesEarlyByCourseId: ["flag"],
        cohorts: {
          dp1: {
            courses: [
              hourCourse("flag", "t-flag", ["s1"]),
              hourCourse("a", "t-a", ["s1"]),
              hourCourse("b", "t-b", ["s1"]),
            ],
            pins: [],
            parkedCourseIds: [],
          },
          dp2: { courses: [], pins: [], parkedCourseIds: [] },
        },
      };

      const result = await engine(snapshot, BUDGET);

      expect(result.diagnostics.cohorts.dp1.unplaced).toEqual([]);
      const flagRow = result.placements.find((row) => row.courseId === "flag");
      expect(flagRow?.period === 1 || flagRow?.period === 3).toBe(true);
      expect(verifyGeneration(snapshot, result.placements).ok).toBe(true);
    });

    it("skips a would-box placement rather than emit an invalid board", async () => {
      // flag pinned at (1,2) on a 1×3 grid; the two fillers share s1 and only periods 1 and 3 are
      // free — placing both boxes the pin, so the guard leaves one filler unplaced (skip, not box).
      const snapshot: GeneratorSnapshot = {
        days: 1,
        periods: 3,
        availability: [],
        finishesEarlyByCourseId: ["flag"],
        cohorts: {
          dp1: {
            courses: [
              hourCourse("flag", "t-flag", ["s1"]),
              hourCourse("a", "t-a", ["s1"]),
              hourCourse("b", "t-b", ["s1"]),
            ],
            pins: [placement("pin-flag", "flag", 1, 2)],
            parkedCourseIds: [],
          },
          dp2: { courses: [], pins: [], parkedCourseIds: [] },
        },
      };

      const result = await engine(snapshot, BUDGET);

      // exactly one filler fits (period 1 or 3, keeping the pin at an edge); the other is skipped
      expect(result.placements).toHaveLength(1);
      const unplacedTotal = result.diagnostics.cohorts.dp1.unplaced.reduce((sum, deficit) => sum + deficit.missing, 0);
      expect(unplacedTotal).toBe(1);
      expect(verifyGeneration(snapshot, result.placements).ok).toBe(true);
    });
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

  it("aborts mid-solve and resolves promptly with a verify-clean best-so-far", async () => {
    // A large budget the engine would otherwise spin on; the abort fires ~100 ms in and must be
    // observed at a time-sliced yield within the descent — resolving well under a generous ceiling.
    const controller = new AbortController();
    const snapshot = syntheticGeneratorSnapshot();
    setTimeout(() => {
      controller.abort();
    }, 100);
    const startedAt = Date.now();

    const result = await generatePlanGreedy(snapshot, { budgetMs: 60_000 }, { signal: controller.signal });

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result.diagnostics.partial).toBe(true);
    expect(verifyGeneration(snapshot, result.placements).ok).toBe(true);
  });

  it("emits progress from early in the solve, not only at the end", async () => {
    const ticks: number[] = [];

    await generatePlanGreedy(
      syntheticGeneratorSnapshot(),
      { budgetMs: 400 },
      {
        onProgress: ({ elapsedMs }) => {
          ticks.push(elapsedMs);
        },
      },
    );

    expect(ticks.length).toBeGreaterThan(0);
    // a tick arrived within the first half of the budget — progress flows during the solve
    expect(Math.min(...ticks)).toBeLessThan(200);
  });

  it("never returns a board with interior holes on the synthetic catalog (attempt never regresses)", async () => {
    // Intra-attempt best tracking: descent/migration can trade a slot for a new interior hole,
    // but scoring construction and descent and keeping the winner means the returned board is
    // never worse than the (hole-free) constructive checkpoint the tiers already reward.
    const snapshot = syntheticGeneratorSnapshot();

    const result = await engine(snapshot, BUDGET);

    for (const cohort of ["dp1", "dp2"] as const) {
      const rows = [...snapshot.cohorts[cohort].pins, ...result.placements.filter((row) => row.cohort === cohort)];
      expect(countInteriorHoles(rows, snapshot.days)).toBe(0);
    }
    expect(verifyGeneration(snapshot, result.placements).ok).toBe(true);
  });
});

describe("search upgrades (LNS, stagnation, clique bound)", () => {
  it("reports a per-cohort lower bound in (0, occupiedSlotsAfter]", async () => {
    const snapshot = syntheticGeneratorSnapshot();

    const result = await engine(snapshot, BUDGET);

    for (const cohort of ["dp1", "dp2"] as const) {
      const { lowerBound, occupiedSlotsAfter } = result.diagnostics.cohorts[cohort];
      expect(lowerBound).toBeGreaterThan(0);
      expect(lowerBound).toBeLessThanOrEqual(occupiedSlotsAfter);
    }
  });

  it("stops early with stopReason 'stagnation' on the easily-solved synthetic catalog", async () => {
    const snapshot = syntheticGeneratorSnapshot();
    const startedAt = Date.now();

    // Tuned windows, not a long budget: the 250 ms stagnation stop fires well before the 2 s budget,
    // so the assertion meaning ("stopped because it stagnated, not because time ran out") is unchanged.
    const result = await engine(snapshot, { budgetMs: 2_000 });

    const elapsed = Date.now() - startedAt;
    expect(result.diagnostics.stopReason).toBe("stagnation");
    expect(elapsed).toBeLessThan(2_000);
    expect(result.diagnostics.cohorts.dp1.unplaced).toEqual([]);
    expect(result.diagnostics.cohorts.dp2.unplaced).toEqual([]);
    expect(verifyGeneration(snapshot, result.placements).ok).toBe(true);
  });
});

describe("maxWeightCliqueWeight", () => {
  const hc = (id: string, teacher: string, students: string[], hours: number): GroupingCourse => ({
    ...course(id, teacher, students),
    hours,
  });

  it("returns the exact max-weight clique on a crafted conflict graph", () => {
    // A(3)–B(2) share teacher t1; A(3)–C(2) share student s1; B–C are independent.
    // Cliques: {A,B}=5, {A,C}=5 (B–C is not an edge, so {A,B,C} is not a clique) → max = 5.
    const courses = [hc("A", "t1", ["s1"], 3), hc("B", "t1", ["s2"], 2), hc("C", "t2", ["s1"], 2)];
    expect(maxWeightCliqueWeight(courses, new Set())).toBe(5);
  });

  it("sums all hours when every course mutually conflicts (complete graph)", () => {
    const courses = [hc("A", "t", ["s1"], 3), hc("B", "t", ["s2"], 2), hc("C", "t", ["s3"], 2)];
    expect(maxWeightCliqueWeight(courses, new Set())).toBe(7);
  });

  it("falls to the single largest node when courses are independent", () => {
    const courses = [hc("A", "t1", ["s1"], 3), hc("B", "t2", ["s2"], 2)];
    expect(maxWeightCliqueWeight(courses, new Set())).toBe(3);
  });

  it("excludes flagged courses from the bound", () => {
    const courses = [hc("A", "t", ["s1"], 3), hc("flag", "t", ["s2"], 5)];
    expect(maxWeightCliqueWeight(courses, new Set(["flag"]))).toBe(3);
  });
});
