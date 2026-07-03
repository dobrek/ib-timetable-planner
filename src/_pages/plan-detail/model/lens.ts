import type { GroupingCourse } from "./grouping/grouping";
import type { LocalPlacement } from "./placement/placement";

/**
 * The board highlight/discovery lens: an OR-union of course / teacher / student criteria over the
 * PLACED chips only. Read-only view state — never a constraint input, never persisted server-side.
 * Matching per kind: course → `placement.courseId`; teacher/student → the placement's catalog
 * course's `teacherKeys`/`studentKeys`. Pending placements match like any other.
 */
export type LensKind = "course" | "teacher" | "student";

export type LensCriterion = {
  kind: LensKind;
  /** The matched entity's opaque key: a course id, teacher key, or student key. */
  key: string;
};

/** The lens derivation output: the matched union plus per-criterion counts (keyed by `criterionId`). */
export type LensMatches = {
  /** Placement ids matching ANY active criterion (OR-union; each id appears once). */
  matched: Set<string>;
  /** criterionId → how many placements that criterion matched (an overlap counts in each). */
  countsByCriterion: Map<string, number>;
};

/** Stable identity for a criterion (`kind:key`) — the counts key and the picker-item value. */
export const criterionId = (criterion: LensCriterion): string => `${criterion.kind}:${criterion.key}`;

/**
 * Derive the lens match union. `null` when no criteria are active (mirrors `dropHints`'
 * null-means-inactive), so consumers can tell "no lens" from "lens with zero hits". One linear
 * pass per criterion — O(N × criteria), N = placed chips.
 */
export const deriveLensMatches = (
  placements: LocalPlacement[],
  catalogById: Map<string, GroupingCourse>,
  criteria: LensCriterion[],
): LensMatches | null => {
  if (criteria.length === 0) return null;
  const perCriterion = criteria.map((criterion) => ({
    id: criterionId(criterion),
    hits: placements.filter(matchesCriterion(catalogById, criterion)),
  }));
  return {
    matched: new Set(perCriterion.flatMap(({ hits }) => hits.map((placement) => placement.id))),
    countsByCriterion: new Map(perCriterion.map(({ id, hits }) => [id, hits.length])),
  };
};

/** Per-kind predicate: course matches by placement id; teacher/student via the catalog key sets. */
const matchesCriterion =
  (catalogById: Map<string, GroupingCourse>, criterion: LensCriterion) =>
  (placement: LocalPlacement): boolean =>
    criterion.kind === "course"
      ? placement.courseId === criterion.key
      : (entityKeys(catalogById.get(placement.courseId), criterion.kind)?.includes(criterion.key) ?? false);

/** The key set a teacher/student criterion matches against; undefined when the course is uncataloged. */
const entityKeys = (course: GroupingCourse | undefined, kind: "teacher" | "student"): string[] | undefined =>
  kind === "teacher" ? course?.teacherKeys : course?.studentKeys;
