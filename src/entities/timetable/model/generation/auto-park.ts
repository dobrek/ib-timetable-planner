import { COHORT_VALUES, type Cohort } from "@/shared/config";
import { deriveGenerationDeficits } from "./deficits";
import type { GeneratorCohortSnapshot, GeneratorSnapshot } from "./types";

/**
 * Phantom-course auto-parking (POC export transform, user decision 2026-07-15), promoted out of
 * `bench/` by S-301 so PRODUCTION assembly does what bench and the human expert already do before
 * every solve. It runs on the enqueue path, between assembly and hashing — the alternative was a
 * default that refuses a catalog containing a phantom course, which is the same philosophy the
 * clean-mode fallback rejected.
 *
 * A course whose expanded roster is EMPTY (`studentKeys.length === 0`) cannot be meaningfully
 * scheduled or judged "complete" — nobody has to be anywhere for it. On the golden plan this is
 * Chemistry SL (4 h, zero students), which the expert board leaves unset; left untreated it would
 * corrupt the residue gate (tier 1), the expert comparison, and any infeasibility memo.
 *
 * The fix is app-native, not a special case in the model: append each such course's UNCOVERED
 * hours (required − pins − already-parked, the exact `deriveGenerationDeficits` figure) to that
 * cohort's `parkedCourseIds` multiset. A parked entry covers one off-board hour, so the deficit
 * drops to 0 and every engine — greedy and CP-SAT alike — is compared on identical terms. The
 * transform is pure over the snapshot (the rosters are already fully expanded), so it is tested
 * without a DB.
 *
 * `autoParked` is the loud audit log the export prints and `results.md` records. On a catalog with
 * no zero-student course (the seed fixture) this is a no-op returning the snapshot unchanged.
 */
export type AutoParkedEntry = { cohort: Cohort; courseId: string; hoursParked: number };

export type AutoParkResult = { snapshot: GeneratorSnapshot; autoParked: AutoParkedEntry[] };

export const autoParkPhantomCourses = (snapshot: GeneratorSnapshot): AutoParkResult => {
  const perCohort = COHORT_VALUES.map((cohort) => parkCohort(cohort, snapshot.cohorts[cohort]));
  const cohorts = Object.fromEntries(perCohort.map(({ cohort, cohortSnapshot }) => [cohort, cohortSnapshot])) as Record<
    Cohort,
    GeneratorCohortSnapshot
  >;
  return { snapshot: { ...snapshot, cohorts }, autoParked: perCohort.flatMap(({ parked }) => parked) };
};

type ParkedCohort = { cohort: Cohort; cohortSnapshot: GeneratorCohortSnapshot; parked: AutoParkedEntry[] };

/** One cohort's transform: park the uncovered hours of every zero-student course, leaving the rest
 *  of the snapshot untouched. Reads the deficit through the same derivation the generator uses. */
const parkCohort = (cohort: Cohort, cohortSnapshot: GeneratorCohortSnapshot): ParkedCohort => {
  const { courses, pins, parkedCourseIds } = cohortSnapshot;
  const zeroStudent = new Set(courses.filter((course) => course.studentKeys.length === 0).map((course) => course.id));
  const phantoms = deriveGenerationDeficits(pins, courses, parkedCourseIds).filter((deficit) =>
    zeroStudent.has(deficit.courseId),
  );
  if (phantoms.length === 0) return { cohort, cohortSnapshot, parked: [] };

  const extraParked = phantoms.flatMap((deficit) => Array<string>(deficit.missing).fill(deficit.courseId));
  return {
    cohort,
    cohortSnapshot: { ...cohortSnapshot, parkedCourseIds: [...parkedCourseIds, ...extraParked] },
    parked: phantoms.map((deficit) => ({ cohort, courseId: deficit.courseId, hoursParked: deficit.missing })),
  };
};
