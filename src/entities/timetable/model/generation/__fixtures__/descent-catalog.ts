import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { GeneratorSnapshot } from "../types";

/**
 * A crafted single-cohort (dp1) instance whose greedy CONSTRUCTION overshoots the optimal slot
 * count by one, so only working slot-descent (stage 6) / LNS reaches the optimum — the capability
 * the CI quality bar (`quality-bar.test.ts`) guards. The bar is capability-level: it fails whenever
 * slot minimization stops working, regardless of which stage regressed.
 *
 * The catalog is a dense 12-course, 28-hour conflict instance on a 5×6 grid. Its max-weight conflict
 * clique is 14 hours, which is a *provable* lower bound on occupied slots (every course in a
 * mutual-conflict clique needs its own cell), so 14 is a hard floor the search can never beat. The
 * constructive stages (backbone → pack → chain-repair → spill) complete the board at 15 slots — one
 * cell above the floor — and only the whole-cell emptying of stage 6 (or an LNS round) collapses that
 * last cell to reach 14. Because 14 is the clique floor, `occupiedSlotsAfter === 14` is machine-speed
 * independent: the engine cannot go below it and reliably reaches it, so the assertion never flakes.
 *
 * Measured during implementation (see change.md): construction alone lands at 15 slots; descent
 * reaches the {@link DESCENT_OPTIMAL_SLOTS} = 14 optimum (= the clique lower bound). Verified by
 * temporarily disabling stage 6 + LNS (criterion 1.5): the bar turns red at 15.
 *
 * The instance was found by searching random dense catalogs for one where full-engine result equals
 * the clique bound while construction-only exceeds it, then frozen here as explicit literals so the
 * fixture carries no RNG dependency.
 */

/** The provable slot optimum of the descent instance — its max-weight conflict-clique lower bound. */
export const DESCENT_OPTIMAL_SLOTS = 14;

const DESCENT_DAYS = 5;
const DESCENT_PERIODS = 6;

const course = (id: string, teacher: string, studentKeys: string[], hours: number): GroupingCourse => ({
  id,
  teacherKeys: [teacher],
  studentKeys,
  hours,
  weekMode: "agnostic",
});

/** The frozen 12-course crown-dense catalog (conflicts are teacher- and student-driven). */
const descentCourses = (): GroupingCourse[] => [
  course("c0", "t0", ["s2", "s7"], 2),
  course("c1", "t3", ["s3"], 2),
  course("c2", "t0", ["s5", "s6"], 3),
  course("c3", "t0", ["s0", "s3", "s6", "s7"], 2),
  course("c4", "t0", ["s2", "s3", "s6"], 2),
  course("c5", "t1", ["s6", "s7", "s1"], 3),
  course("c6", "t1", ["s5", "s1", "s7", "s2"], 2),
  course("c7", "t4", ["s3", "s5"], 3),
  course("c8", "t2", ["s3", "s0"], 3),
  course("c9", "t1", ["s4", "s0", "s1"], 2),
  course("c10", "t2", ["s4", "s3"], 2),
  course("c11", "t0", ["s0", "s6", "s4"], 2),
];

/** A fresh empty-board snapshot over the descent catalog (dp2 empty, no pins/parked/availability). */
export const descentGeneratorSnapshot = (): GeneratorSnapshot => ({
  days: DESCENT_DAYS,
  periods: DESCENT_PERIODS,
  availability: [],
  finishesEarlyByCourseId: [],
  cohorts: {
    dp1: { courses: descentCourses(), pins: [], parkedCourseIds: [] },
    dp2: { courses: [], pins: [], parkedCourseIds: [] },
  },
});
