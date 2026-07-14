import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { WeekLane } from "../analysis/lanes";
import { buildAvailabilityIndex } from "../availability-index";
import { cellKey } from "../collision/cell-key";
import { deriveCellViolations } from "../collision/collisions";
import {
  type CollisionViolation,
  exceedsDayCap,
  exceedsTeacherDayShape,
  hasDaySplit,
  teacherDayPeriods,
} from "../collision/constraints";
import { buildCrossCohortIndex, type CrossCohortIndex, projectFromPlacements } from "../cross-cohort-index";
import { buildDayOccupancyIndex, courseDayPeriods, type DayOccupancyIndex } from "../day-occupancy-index";
import type { PlannerPlacement } from "../placement";
import type { GeneratedPlacement, GeneratorSnapshot } from "./types";

/**
 * Trust-but-verify judge: every engine result is re-judged here before it may touch the
 * board — the collision core stays the single source of truth regardless of engine. The
 * merged (pins + generated) two-cohort board must carry **zero blocking violations
 * board-wide** and **zero generator-hard warns among generated placements** — the 2/day cap
 * (`course-day-stacking`), the no-same-day-split rule (`course-day-split`) and the teacher
 * day span/streak bounds (`teacher-day-shape`); soft teacher-availability warns are permitted
 * but counted. On any failure the whole result is rejected — never partially applied.
 *
 * The three generator-hard kinds are judged with **delta semantics**: a violation fails only when the
 * GENERATED rows *created* it. A pin-only violation (a dirty board the author handed us) stays
 * permitted — otherwise a single pre-existing over-long teacher day would make every board
 * unverifiable and the engine could never return anything.
 *
 * "Created" is read at the same granularity as `board.fitsAt`'s `creates()`, and must stay that way:
 * per WEEK LANE for `teacher-day-shape` (against the pins-only board), per participating course-day
 * for the two course rules. A coarser reading here than in `fitsAt` is the worst of both worlds —
 * the search happily builds boards this judge then rejects, with no in-loop signal and the whole
 * budget already spent (see `createsTeacherDayShape`).
 *
 * The structural pass asserts the invariants the core does NOT check: grid-preset bounds,
 * `week_mode ↔ week` consistency, catalog membership (a catalog-missing course is silently
 * skipped by `bucketByCell`, so it must be caught here), and duplicate cell rows.
 */
export type GenerationVerdict = {
  ok: boolean;
  /** Failure diagnostics (empty when ok) — one line per offending placement or violation. */
  reasons: string[];
  /** Soft teacher-availability warns across the merged boards — permitted, surfaced for review. */
  softWarnCount: number;
};

export const verifyGeneration = (snapshot: GeneratorSnapshot, generated: GeneratedPlacement[]): GenerationVerdict => {
  const structuralReasons = checkStructural(snapshot, generated);
  if (structuralReasons.length > 0) return { ok: false, reasons: structuralReasons, softWarnCount: 0 };
  return judgeMergedBoards(snapshot, generated);
};

const COHORT_ORDER: Cohort[] = ["dp1", "dp2"];

/** Per-placement invariants checked before the (more expensive) oracle pass. */
const checkStructural = (snapshot: GeneratorSnapshot, generated: GeneratedPlacement[]): string[] => {
  const seen = pinRowKeys(snapshot);
  const reasons: string[] = [];
  for (const placement of generated) {
    const at = `${placement.cohort} ${placement.courseId} @ ${cellKey(placement.day, placement.period)}`;
    const course = courseOf(snapshot, placement);
    if (!course) {
      reasons.push(`${at}: course missing from the ${placement.cohort} catalog`);
      continue;
    }
    if (!inBounds(snapshot, placement)) {
      reasons.push(`${at}: outside the ${snapshot.days}×${snapshot.periods} grid`);
    }
    if (!weekConsistent(course, placement.week)) {
      reasons.push(`${at}: week "${placement.week}" inconsistent with week_mode "${course.weekMode}"`);
    }
    const key = rowKey(placement.cohort, placement.courseId, placement.day, placement.period);
    if (seen.has(key)) reasons.push(`${at}: duplicate cell row`);
    seen.add(key);
  }
  return reasons;
};

/** The oracle pass: merge per cohort, rebuild fresh indexes, run `deriveCellViolations`. */
const judgeMergedBoards = (snapshot: GeneratorSnapshot, generated: GeneratedPlacement[]): GenerationVerdict => {
  const availability = buildAvailabilityIndex(snapshot.availability);
  const flagged = new Set(snapshot.finishesEarlyByCourseId);
  const merged = {
    dp1: mergedPlacements(snapshot, generated, "dp1"),
    dp2: mergedPlacements(snapshot, generated, "dp2"),
  };

  const reasons: string[] = [];
  let softWarnCount = 0;
  // The baseline the teacher-day delta is read against. Cheap (pins only) and built once, outside
  // the cohort loop — a teacher's day spans BOTH cohorts, so both sides must be on hand at once.
  const pinned = pinnedBoards(snapshot);

  for (const cohort of COHORT_ORDER) {
    const sibling: Cohort = cohort === "dp1" ? "dp2" : "dp1";
    const catalogById = toCatalogById(snapshot.cohorts[cohort].courses);
    const crossIndex = buildCrossCohortIndex(
      projectFromPlacements(merged[sibling], teacherKeysByCourseId(snapshot.cohorts[sibling].courses)),
    );
    const collisions = deriveCellViolations(merged[cohort], catalogById, availability, crossIndex, flagged);

    for (const [key, cell] of collisions) {
      const day = dayOf(key);
      for (const violation of cell.violations) {
        if (isSoftAvailability(violation)) {
          softWarnCount += 1;
        } else if (violation.kind === "course-day-stacking" || violation.kind === "course-day-split") {
          if (createsCourseDayBreach(pinned, cohort, violation, day)) {
            reasons.push(`${cohort} ${key}: ${violation.kind} among generated placements`);
          }
        } else if (violation.kind === "teacher-day-shape") {
          if (createsTeacherDayShape(pinned, cohort, violation, day)) {
            reasons.push(
              `${cohort} ${key}: teacher-day-shape (span ${violation.span}, streak ${violation.maxStreak}) ` +
                `among generated placements`,
            );
          }
        } else {
          reasons.push(`${cohort} ${key}: blocking ${violation.kind}`);
        }
      }
    }
  }
  return { ok: reasons.length === 0, reasons, softWarnCount };
};

/** Pins + this cohort's generated rows as plain placements (synthetic ids, never optional). */
const mergedPlacements = (
  snapshot: GeneratorSnapshot,
  generated: GeneratedPlacement[],
  cohort: Cohort,
): PlannerPlacement[] => [
  ...snapshot.cohorts[cohort].pins,
  ...generated
    .filter((placement) => placement.cohort === cohort)
    .map((placement, index) => ({
      id: `generated:${cohort}:${index}`,
      courseId: placement.courseId,
      day: placement.day,
      period: placement.period,
      week: placement.week,
      isOptional: false,
    })),
];

/**
 * A course-day warn (stacking, split) fails verification only when a GENERATED row *created* it:
 * some lane that breaches on the merged board did not breach on the pins-only one.
 *
 * Read per lane, like `board.fitsAt` — the previous `(courseId, day)` key was lane-blind, so a
 * biweekly course whose week-A pins were already split rejected any week-B hour the generator put
 * on that day, though the two lanes never meet.
 */
const createsCourseDayBreach = (
  pinned: PinnedBoards,
  cohort: Cohort,
  violation: Extract<CollisionViolation, { kind: "course-day-stacking" | "course-day-split" }>,
  day: number,
): boolean => {
  const breaches = violation.kind === "course-day-split" ? hasDaySplit : exceedsDayCap;
  return violation.courseIds.some((courseId) =>
    violation.lanes.some((lane) => !breaches(courseDayPeriods(pinned.dayOccupancy[cohort], courseId, day, lane))),
  );
};

/**
 * The pins-only board — the baseline the generator was handed, and the one the teacher-day delta is
 * read against.
 *
 * A teacher's day spans BOTH cohorts, so each cohort needs its own day index plus the SIBLING's
 * occupancy (keyed here by the cohort that reads it), exactly as the constraint sees them.
 */
type PinnedBoards = {
  dayOccupancy: Record<Cohort, DayOccupancyIndex>;
  siblingOccupancy: Record<Cohort, CrossCohortIndex>;
};

const pinnedBoards = (snapshot: GeneratorSnapshot): PinnedBoards => {
  const pinsOf = (cohort: Cohort): PlannerPlacement[] => snapshot.cohorts[cohort].pins;
  const catalogOf = (cohort: Cohort): Map<string, GroupingCourse> => toCatalogById(snapshot.cohorts[cohort].courses);
  const occupancyOf = (cohort: Cohort): CrossCohortIndex =>
    buildCrossCohortIndex(
      projectFromPlacements(pinsOf(cohort), teacherKeysByCourseId(snapshot.cohorts[cohort].courses)),
    );

  return {
    dayOccupancy: {
      dp1: buildDayOccupancyIndex(pinsOf("dp1"), catalogOf("dp1")),
      dp2: buildDayOccupancyIndex(pinsOf("dp2"), catalogOf("dp2")),
    },
    siblingOccupancy: { dp1: occupancyOf("dp2"), dp2: occupancyOf("dp1") },
  };
};

/**
 * A teacher-day-shape warn fails verification only when a GENERATED row *created* it: some lane that
 * breaches on the merged board did not breach on the pins-only board.
 *
 * This is the verify-side twin of `board.fitsAt`'s `creates()`, and it must stay one: `fitsAt` reads
 * the delta per WEEK LANE, so a lane a pin already broke keeps accepting placements. Keying the
 * delta on `(teacher, day)` instead — "did the generator touch this teacher's day at all?" — made
 * ONE pin-broken teacher-day reject every board that put any hour on it, while `fitsAt` happily
 * built those boards: the whole 20 s budget burned, no in-loop signal, and an author who hand-placed
 * an over-long teacher day (a warn, so the UI allows it) could not generate at all.
 */
const createsTeacherDayShape = (
  pinned: PinnedBoards,
  cohort: Cohort,
  violation: Extract<CollisionViolation, { kind: "teacher-day-shape" }>,
  day: number,
): boolean => violation.lanes.some((lane) => !breachedByPins(pinned, cohort, violation.teacherKey, day, lane));

const breachedByPins = (
  pinned: PinnedBoards,
  cohort: Cohort,
  teacherKey: string,
  day: number,
  lane: WeekLane,
): boolean =>
  exceedsTeacherDayShape(
    teacherDayPeriods(pinned.dayOccupancy[cohort], pinned.siblingOccupancy[cohort], teacherKey, day, lane),
  );

const isSoftAvailability = (violation: CollisionViolation): boolean =>
  violation.kind === "teacher-unavailable" && violation.severity === "warn";

const courseOf = (snapshot: GeneratorSnapshot, placement: GeneratedPlacement): GroupingCourse | undefined =>
  snapshot.cohorts[placement.cohort].courses.find((course) => course.id === placement.courseId);

const inBounds = (snapshot: GeneratorSnapshot, placement: GeneratedPlacement): boolean =>
  placement.day >= 1 && placement.day <= snapshot.days && placement.period >= 1 && placement.period <= snapshot.periods;

const weekConsistent = (course: GroupingCourse, week: PlacementWeek): boolean =>
  course.weekMode === "biweekly" ? week === "a" || week === "b" : week === "both";

const pinRowKeys = (snapshot: GeneratorSnapshot): Set<string> => {
  const keys = new Set<string>();
  for (const cohort of COHORT_ORDER) {
    for (const pin of snapshot.cohorts[cohort].pins) {
      keys.add(rowKey(cohort, pin.courseId, pin.day, pin.period));
    }
  }
  return keys;
};

const rowKey = (cohort: Cohort, courseId: string, day: number, period: number): string =>
  `${cohort}|${courseId}|${cellKey(day, period)}`;

const dayOf = (key: string): number => Number(key.split(":")[0]);

const toCatalogById = (courses: GroupingCourse[]): Map<string, GroupingCourse> =>
  new Map(courses.map((course) => [course.id, course]));

const teacherKeysByCourseId = (courses: GroupingCourse[]): Map<string, string[]> =>
  new Map(courses.map((course) => [course.id, course.teacherKeys]));
