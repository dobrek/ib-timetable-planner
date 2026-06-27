import { describe, expect, it } from "vitest";
import type { PlacementWeek } from "@/shared/config";
import { deriveCellViolations } from "./collisions";
import { buildCrossCohortIndex, projectFromPlacements } from "./cross-cohort-index";
import { deriveDropHints } from "./drop-hints";
import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";

/**
 * INFORMATIONAL perf guard for the sub-200 ms drag budget with BOTH cohorts live (S-06). Wraps the
 * pure board derivations — `deriveCellViolations` (committed) + `deriveDropHints` (drag what-if) —
 * over a full two-cohort placement set in `performance.now()`, logs the timing, and asserts a
 * generous ceiling as a regression signal only. NOT a hard CI gate: a wall-clock assertion is
 * flaky across machines/CI load (test-plan §96-103), so the ceiling is set far above the real cost.
 * The end-to-end <200 ms feel is confirmed manually in DevTools; this just catches a gross regression
 * in the pure core (e.g. an accidental O(n²) over the cross-cohort index).
 */

// A realistic-ish plan: ~40 placed course-hours per cohort across the 5×10 grid, ~30 teachers and
// ~26 students, a mix of co-taught / bi-weekly / agnostic courses — built deterministically.
const DAYS = 5;
const PERIODS = 10;
const COURSES_PER_COHORT = 40;
const WEEKS: PlacementWeek[] = ["both", "a", "b"];

const buildCohort = (seed: number): { catalog: Map<string, GroupingCourse>; placements: PlannerPlacement[] } => {
  const courses: GroupingCourse[] = Array.from({ length: COURSES_PER_COHORT }, (_, i) => {
    const id = `c${seed}-${i}`;
    // Deterministic teacher/student spread: a shared teacher pool of 30, students pool of 26, so
    // co-teaching and cross-cohort sharing both arise. Every 3rd course is co-taught, every 4th bi-weekly.
    const teacherKeys = i % 3 === 0 ? [`t${i % 30}`, `t${(i + 7) % 30}`] : [`t${i % 30}`];
    const studentKeys = [`s${i % 26}`, `s${(i + 5) % 26}`, `s${(i + 11) % 26}`];
    const weekMode = i % 4 === 0 ? "biweekly" : "agnostic";
    return { id, teacherKeys, studentKeys, hours: 4, weekMode };
  });
  const placements: PlannerPlacement[] = courses.map((course, i) => ({
    id: `p${seed}-${i}`,
    courseId: course.id,
    day: (i % DAYS) + 1,
    period: (i % PERIODS) + 1,
    week: WEEKS[i % WEEKS.length],
  }));
  return { catalog: new Map(courses.map((course) => [course.id, course])), placements };
};

const teacherKeysByCourseId = (catalog: Map<string, GroupingCourse>): Map<string, string[]> =>
  new Map([...catalog.values()].map((course) => [course.id, course.teacherKeys]));

describe("two-cohort derivation perf (informational)", () => {
  it("derives both cohorts' collisions + a per-cohort drag what-if well within budget", () => {
    const dp1 = buildCohort(1);
    const dp2 = buildCohort(2);
    // Each cohort's live cross-index from the OTHER's placements — exactly what the shell builds.
    const dp1Index = buildCrossCohortIndex(projectFromPlacements(dp2.placements, teacherKeysByCourseId(dp2.catalog)));
    const dp2Index = buildCrossCohortIndex(projectFromPlacements(dp1.placements, teacherKeysByCourseId(dp1.catalog)));
    const draggedDp1 = [...dp1.catalog.values()][0];
    const draggedDp2 = [...dp2.catalog.values()][0];

    const start = performance.now();
    // The per-edit work the combined shell does on a mutation: re-derive BOTH columns' committed
    // collisions and run a drag what-if in each (the cross-index is rebuilt once per mutation upstream).
    deriveCellViolations(dp1.placements, dp1.catalog, undefined, dp1Index);
    deriveCellViolations(dp2.placements, dp2.catalog, undefined, dp2Index);
    deriveDropHints({ members: [draggedDp1] }, dp1.placements, dp1.catalog, undefined, dp1Index);
    deriveDropHints({ members: [draggedDp2] }, dp2.placements, dp2.catalog, undefined, dp2Index);
    const elapsed = performance.now() - start;

    // eslint-disable-next-line no-console
    console.info(`[perf] two-cohort derive (committed×2 + drag×2): ${elapsed.toFixed(2)} ms`);
    // Generous ceiling — the real cost is sub-millisecond; this only trips on a gross regression.
    expect(elapsed).toBeLessThan(50);
  });
});
