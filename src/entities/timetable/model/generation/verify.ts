import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { buildAvailabilityIndex } from "../availability-index";
import { cellKey } from "../collision/cell-key";
import { deriveCellViolations } from "../collision/collisions";
import type { CollisionViolation } from "../collision/constraints";
import { buildCrossCohortIndex, projectFromPlacements } from "../cross-cohort-index";
import type { PlannerPlacement } from "../placement";
import type { GeneratedPlacement, GeneratorSnapshot } from "./types";

/**
 * Trust-but-verify judge: every engine result is re-judged here before it may touch the
 * board — the collision core stays the single source of truth regardless of engine. The
 * merged (pins + generated) two-cohort board must carry **zero blocking violations
 * board-wide** and **zero `course-day-stacking` warns among generated placements** (the
 * generator-hard 2/day cap); soft teacher-availability warns are permitted but counted.
 * On any failure the whole result is rejected — never partially applied.
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
  for (const cohort of COHORT_ORDER) {
    const sibling: Cohort = cohort === "dp1" ? "dp2" : "dp1";
    const catalogById = toCatalogById(snapshot.cohorts[cohort].courses);
    const crossIndex = buildCrossCohortIndex(
      projectFromPlacements(merged[sibling], teacherKeysByCourseId(snapshot.cohorts[sibling].courses)),
    );
    const collisions = deriveCellViolations(merged[cohort], catalogById, availability, crossIndex, flagged);
    const generatedCourseDays = generatedCourseDayKeys(generated, cohort);

    for (const [key, cell] of collisions) {
      for (const violation of cell.violations) {
        if (isSoftAvailability(violation)) {
          softWarnCount += 1;
        } else if (violation.kind === "course-day-stacking") {
          if (citesGeneratedDay(violation, dayOf(key), generatedCourseDays)) {
            reasons.push(`${cohort} ${key}: course-day-stacking among generated placements`);
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

/** A stacking warn fails verification only when a cited course has a generated placement that day —
 *  pre-existing pin-only stacks stay permitted (warns never block Generate). */
const citesGeneratedDay = (
  violation: Extract<CollisionViolation, { kind: "course-day-stacking" }>,
  day: number,
  generatedCourseDays: Set<string>,
): boolean => violation.courseIds.some((courseId) => generatedCourseDays.has(courseDayKey(courseId, day)));

const generatedCourseDayKeys = (generated: GeneratedPlacement[], cohort: Cohort): Set<string> =>
  new Set(
    generated
      .filter((placement) => placement.cohort === cohort)
      .map((placement) => courseDayKey(placement.courseId, placement.day)),
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

const courseDayKey = (courseId: string, day: number): string => `${courseId}|${day}`;

const dayOf = (key: string): number => Number(key.split(":")[0]);

const toCatalogById = (courses: GroupingCourse[]): Map<string, GroupingCourse> =>
  new Map(courses.map((course) => [course.id, course]));

const teacherKeysByCourseId = (courses: GroupingCourse[]): Map<string, string[]> =>
  new Map(courses.map((course) => [course.id, course.teacherKeys]));
