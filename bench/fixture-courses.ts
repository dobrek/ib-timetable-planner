import type { Cohort, PlacementWeek } from "@/shared/config";

/**
 * The fixture skeleton, split deliberately in two halves:
 *
 *   • the **roster** (which courses are fixtures) is this curated name list — auto-detection is
 *     untrustworthy (the mirrored-cell census over-claimed: Polish A's Monday mirror was a
 *     coincidence, R11) and no existing data field selects the set (`finishes_early` doesn't match
 *     it), so a human confirms it once and the confirmation is recorded here;
 *   • the **positions** are never hardcoded — they are copied from the source board, so a moved
 *     Advisory costs zero edits here.
 *
 * Dev tooling only. The engine and the app never see a "fixture" concept, just pins
 * (labels-as-config before labels-as-schema — an `is_fixture` column is a possible future change,
 * once the pre-pin workflow proves out).
 */
export const FIXTURE_COURSE_NAMES = ["Advisory", "CAS", "EE", "SSSTS"];

/** A course's cross-plan identity. Clones mint new ids, so identity is the natural key. */
export type CourseIdentity = {
  id: string;
  cohort: Cohort;
  name: string;
  level: string;
  groupIndex: number;
};

/** One placed course-hour, plan-agnostic — a source board row or its clone-side translation. */
export type SkeletonRow = {
  cohort: Cohort;
  courseId: string;
  day: number;
  period: number;
  week: PlacementWeek;
};

/**
 * The source board's fixture rows, translated onto the clone's course ids. Fails loudly rather than
 * pinning a partial skeleton: an ambiguous identity (two courses sharing one natural key), a fixture
 * name absent from either plan, a source fixture course with no placements, and an unmappable row
 * all raise.
 */
export const copyFixtureSkeleton = (
  sourceCourses: CourseIdentity[],
  cloneCourses: CourseIdentity[],
  sourceRows: SkeletonRow[],
  names: string[] = FIXTURE_COURSE_NAMES,
): SkeletonRow[] => {
  const fixtures = sourceCourses.filter((course) => names.includes(course.name));
  assertRosterPresent(names, fixtures, cloneCourses);
  const cloneIdBySourceId = mapCourseIdentities(fixtures, cloneCourses);

  const rowsByCourseId = new Map<string, SkeletonRow[]>();
  for (const row of sourceRows) {
    if (!cloneIdBySourceId.has(row.courseId)) continue;
    rowsByCourseId.set(row.courseId, [...(rowsByCourseId.get(row.courseId) ?? []), row]);
  }
  const unplaced = fixtures.filter((course) => !rowsByCourseId.has(course.id));
  if (unplaced.length > 0) {
    throw new Error(
      `Fixture skeleton incomplete in the source plan: ${unplaced.map(describe).join(", ")} ` +
        `carry no placements. Pinning a partial skeleton would silently change the experiment.`,
    );
  }

  // Walk the id map (not the rows) so each row's clone id comes from the pair itself — no lookup
  // that could miss, and no assertion standing in for the invariant.
  return [...cloneIdBySourceId].flatMap(([sourceId, cloneId]) =>
    (rowsByCourseId.get(sourceId) ?? []).map((row) => ({ ...row, courseId: cloneId })),
  );
};

/** source course id → clone course id, keyed by `(cohort, name, level, group_index)`. */
export const mapCourseIdentities = (
  sourceCourses: CourseIdentity[],
  cloneCourses: CourseIdentity[],
): Map<string, string> => {
  const cloneByKey = indexByIdentity(cloneCourses, "clone");
  assertDistinctIdentities(sourceCourses, "source");

  return new Map(
    sourceCourses.map((course) => {
      const clone = cloneByKey.get(identityKey(course));
      if (!clone) {
        throw new Error(`Course ${describe(course)} has no identity match in the clone catalog.`);
      }
      return [course.id, clone.id];
    }),
  );
};

const assertRosterPresent = (names: string[], fixtures: CourseIdentity[], cloneCourses: CourseIdentity[]): void => {
  const missing = names.filter(
    (name) => !fixtures.some((course) => course.name === name) || !cloneCourses.some((course) => course.name === name),
  );
  if (missing.length > 0) {
    throw new Error(
      `Fixture course(s) ${missing.join(", ")} missing from the source or clone catalog — ` +
        `fix the roster in bench/fixture-courses.ts or the plan, never pin a partial skeleton.`,
    );
  }
};

const indexByIdentity = (courses: CourseIdentity[], side: string): Map<string, CourseIdentity> => {
  assertDistinctIdentities(courses, side);
  return new Map(courses.map((course) => [identityKey(course), course]));
};

const assertDistinctIdentities = (courses: CourseIdentity[], side: string): void => {
  const seen = new Set<string>();
  for (const course of courses) {
    const key = identityKey(course);
    if (seen.has(key)) {
      throw new Error(`Ambiguous ${side} course identity ${describe(course)} — the natural key is not unique.`);
    }
    seen.add(key);
  }
};

const identityKey = ({ cohort, name, level, groupIndex }: CourseIdentity): string =>
  `${cohort}|${name}|${level}|${groupIndex}`;

const describe = ({ cohort, name, level, groupIndex }: CourseIdentity): string =>
  `${cohort} ${name}${level === "none" ? "" : ` ${level}`}${groupIndex === 0 ? "" : ` (${groupIndex})`}`;
