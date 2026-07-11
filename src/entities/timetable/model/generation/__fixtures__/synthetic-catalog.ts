import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { biweekly, coTaught, course } from "../../__fixtures__/builders";
import type { GeneratorSnapshot } from "../types";

/**
 * A small deterministic two-cohort catalog for generation unit tests and the CI smoke:
 * a 3×4 grid (12 slots per cohort), two teachers shared across cohorts (exercises the
 * cross-cohort rule), a biweekly pair sharing one teacher and one student (exercises the
 * opposite-week relaxation), one `finishes_early` course (exercises the edge rule), one
 * co-taught course, and one strong teacher-unavailability cell. Sized so any engine
 * solves it in ≤2 s: dp1 needs 10 course-hours, dp2 needs 9, both well under 12 slots.
 * Feasible by construction — a complete zero-blocking-violation board exists.
 */

export const SYNTHETIC_DAYS = 3;
export const SYNTHETIC_PERIODS = 4;

/** The dp2 course flagged `finishes_early` — tests assert its edge-of-day handling. */
export const SYNTHETIC_FLAGGED_COURSE_ID = "dp2-history";

const withHours = (base: GroupingCourse, hours: number): GroupingCourse => ({ ...base, hours });

/** dp1: 10 hours across 5 courses; `t-shared-*` also teach dp2. */
const dp1Courses = (): GroupingCourse[] => [
  withHours(course("dp1-math", "t-shared-1", ["s1", "s2", "s3"]), 3),
  withHours(course("dp1-english", "t-shared-2", ["s1", "s2"]), 3),
  withHours(coTaught("dp1-art", ["t-art", "t-art-assist"], ["s3"]), 2),
  withHours(biweekly("dp1-bio-a", "t-bi", ["s1"]), 1),
  withHours(biweekly("dp1-bio-b", "t-bi", ["s1"]), 1),
];

/** dp2: 9 hours across 4 courses, incl. the flagged early-finisher. */
const dp2Courses = (): GroupingCourse[] => [
  withHours(course("dp2-math", "t-shared-1", ["u1", "u2"]), 3),
  withHours(course("dp2-english", "t-shared-2", ["u1", "u3"]), 2),
  withHours(course(SYNTHETIC_FLAGGED_COURSE_ID, "t-history", ["u2", "u3"]), 2),
  withHours(course("dp2-chemistry", "t-chem", ["u1"]), 2),
];

/** A fresh empty-board snapshot over the synthetic catalog (pins/parked empty, one strong-NO cell). */
export const syntheticGeneratorSnapshot = (): GeneratorSnapshot => ({
  days: SYNTHETIC_DAYS,
  periods: SYNTHETIC_PERIODS,
  availability: [{ teacherKey: "t-art", day: 1, period: 1, severity: "strong" }],
  finishesEarlyByCourseId: [SYNTHETIC_FLAGGED_COURSE_ID],
  cohorts: {
    dp1: { courses: dp1Courses(), pins: [], parkedCourseIds: [] },
    dp2: { courses: dp2Courses(), pins: [], parkedCourseIds: [] },
  },
});
