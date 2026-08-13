import type { Cohort } from "@/shared/config";
import type { CourseNaturalKey } from "@/shared/lib/catalog-hash";
import type { GeneratedPlacement } from "./types";

/**
 * Source→clone `courseId` translation for generated boards.
 *
 * `clone_plan` re-mints every course UUID through `gen_random_uuid()`-defaulted temp maps —
 * **measured: 0 of 84 course ids survive a clone** — while S-301 assembles, hashes and dispatches the
 * snapshot from the SOURCE plan and applies the result onto the clone. Something has to bridge the two
 * id spaces, and this is it.
 *
 * The bridge is cheap because the frozen contract made it cheap: `GeneratedPlacement` is
 * `{cohort, courseId, day, period, week}` with `additionalProperties: false`, so **`courseId` is the
 * only id that ever comes back**. One dimension, one map — not a general identity-mapping problem.
 *
 * The key is `(cohort, name, level, groupIndex)`, which `clone_plan` copies verbatim. Measured on the
 * real catalog: unique across all 84 source courses, and matching 84/84 across a clone.
 *
 * **Do not generalise this trick to teachers or students.** Teachers are not natural-keyable on
 * `full_name` (measured: 18 teachers, ONE distinct value; `code` is the real key) and students carry
 * no uniqueness constraint on theirs. It is safe here only because results carry neither.
 *
 * Both functions throw rather than degrade. A duplicate key means the natural key is not a key on this
 * catalog after all; an unmapped id means the clone is not the catalog the solve ran against. Either
 * way a partial apply would silently corrupt the proposal board, which is worse than no proposal.
 */
export type CourseIdentityIndex = Record<Cohort, Map<string, CourseNaturalKey>>;

export const buildCourseIdMap = (source: CourseIdentityIndex, target: CourseIdentityIndex): Map<string, string> => {
  const targetByKey = indexByNaturalKey(target, "clone");
  const sourceEntries = [...cohortEntries(source)];
  assertNoDuplicateKeys(sourceEntries, "source");
  return new Map(
    sourceEntries.flatMap(([sourceId, key]) => {
      const targetId = targetByKey.get(key);
      return targetId === undefined ? [] : [[sourceId, targetId] as const];
    }),
  );
};

/**
 * Re-point every placement at the clone's id space. Throws on the first id the map cannot resolve —
 * naming the id, because a miss means the clone's catalog diverged from the source's between enqueue
 * and delivery, and that is a fact worth reading in an error rather than inferring from a short board.
 */
export const translateCourseIds = (
  placements: readonly GeneratedPlacement[],
  courseIds: ReadonlyMap<string, string>,
): GeneratedPlacement[] =>
  placements.map((placement) => {
    const courseId = courseIds.get(placement.courseId);
    if (courseId === undefined) {
      throw new Error(
        `Generated placement references course ${placement.courseId}, which has no counterpart in the ` +
          `proposal plan — the clone's catalog is not the one this result was solved against.`,
      );
    }
    return { ...placement, courseId };
  });

const naturalKeyOf = (cohort: Cohort, key: CourseNaturalKey): string =>
  JSON.stringify([cohort, key.name, key.level, key.groupIndex]);

function* cohortEntries(index: CourseIdentityIndex): Generator<readonly [string, string]> {
  for (const cohort of ["dp1", "dp2"] as const) {
    for (const [courseId, key] of index[cohort]) yield [courseId, naturalKeyOf(cohort, key)] as const;
  }
}

const indexByNaturalKey = (index: CourseIdentityIndex, side: string): Map<string, string> => {
  const entries = [...cohortEntries(index)];
  assertNoDuplicateKeys(entries, side);
  return new Map(entries.map(([courseId, key]) => [key, courseId]));
};

const assertNoDuplicateKeys = (entries: readonly (readonly [string, string])[], side: string): void => {
  const seen = new Set<string>();
  for (const [, key] of entries) {
    if (seen.has(key)) {
      throw new Error(
        `The ${side} catalog has two courses with the natural key ${key} — (cohort, name, level, ` +
          `groupIndex) does not identify a course here, so a generated board cannot be translated safely.`,
      );
    }
    seen.add(key);
  }
};
