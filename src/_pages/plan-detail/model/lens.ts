import { cohortLabel, type Cohort, type SubjectColor } from "@/shared/config";
import type { CourseDisplay } from "./course-display";
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

/** One pickable entity: its criterion plus resolved display (course color swatch, cohort tag). */
export type LensOption = {
  criterion: LensCriterion;
  label: string;
  /** Course options carry their `SubjectColor` swatch; teacher/student options stay neutral. */
  color?: SubjectColor | null;
  /** Combined view only: the owning cohort's label on course/student options (teachers span both). */
  cohortTag?: string;
};

export type LensOptionGroups = { courses: LensOption[]; teachers: LensOption[]; students: LensOption[] };

/** One visible cohort's picker inputs — the props slices the shell already holds per column. */
export type LensCohortSource = {
  cohort: Cohort;
  courseDisplay: Record<string, CourseDisplay>;
  catalog: GroupingCourse[];
  studentNames: Record<string, string>;
};

/**
 * Assemble the picker's three groups from the VISIBLE cohorts only. Courses/students belong to a
 * cohort (labels cohort-tagged when `combined`); teachers span cohorts, so they are never tagged
 * and are filtered to those appearing in a visible catalog's `teacherKeys`. Sorted by label.
 */
export const buildLensOptions = (
  cohorts: LensCohortSource[],
  teacherNames: Record<string, string>,
  combined: boolean,
): LensOptionGroups => {
  const tagOf = (cohort: Cohort): string | undefined => (combined ? cohortLabel(cohort) : undefined);
  const courses = cohorts.flatMap((source) =>
    Object.entries(source.courseDisplay).map(
      ([courseId, display]): LensOption => ({
        criterion: { kind: "course", key: courseId },
        label: display.name,
        color: display.color,
        cohortTag: tagOf(source.cohort),
      }),
    ),
  );
  const students = cohorts.flatMap((source) =>
    Object.entries(source.studentNames).map(
      ([key, name]): LensOption => ({
        criterion: { kind: "student", key },
        label: name,
        cohortTag: tagOf(source.cohort),
      }),
    ),
  );
  const visibleTeacherKeys = new Set(cohorts.flatMap((source) => source.catalog.flatMap((c) => c.teacherKeys)));
  const teachers = Object.entries(teacherNames)
    .filter(([key]) => visibleTeacherKeys.has(key))
    .map(([key, name]): LensOption => ({ criterion: { kind: "teacher", key }, label: name }));
  return { courses: sortByLabel(courses), teachers: sortByLabel(teachers), students: sortByLabel(students) };
};

/** The committed criteria plus the picker's highlighted candidate, deduped by `criterionId`. */
export const mergeEffectiveCriteria = (committed: LensCriterion[], preview: LensCriterion | null): LensCriterion[] => {
  if (!preview) return committed;
  const committedIds = new Set(committed.map(criterionId));
  return committedIds.has(criterionId(preview)) ? committed : [...committed, preview];
};

/** The lens-bar aggregate: the union total plus per-criterion counts across the visible cohorts. */
export type LensCounts = { total: number; byCriterion: Map<string, number> };

/**
 * Sum per-criterion counts and union totals across the visible cohorts' lens derivations.
 * Placement ids are globally unique, so the union total is a plain sum of per-cohort unions. A
 * criterion absent from every visible cohort yields 0 (the `·0` chip on a focused view).
 */
export const combineLensCounts = (visibleMatches: (LensMatches | null)[], criteria: LensCriterion[]): LensCounts => {
  const present = visibleMatches.filter((matches): matches is LensMatches => matches !== null);
  const byCriterion = new Map(
    criteria.map((criterion) => {
      const id = criterionId(criterion);
      return [id, present.reduce((sum, matches) => sum + (matches.countsByCriterion.get(id) ?? 0), 0)] as const;
    }),
  );
  return { total: present.reduce((sum, matches) => sum + matches.matched.size, 0), byCriterion };
};

/** Per-kind valid-key sets — the plan-wide entity universe a rehydrated lens is pruned against. */
export type LensKeyUniverse = Record<LensKind, ReadonlySet<string>>;

/** Drop criteria whose entity no longer exists (deleted course/teacher/student since last visit). */
export const pruneCriteria = (criteria: LensCriterion[], validKeys: LensKeyUniverse): LensCriterion[] =>
  criteria.filter((criterion) => validKeys[criterion.kind].has(criterion.key));

/**
 * The PLAN-WIDE entity universe (always both cohorts — never the visible subset, so an off-screen
 * cohort's criteria survive a focus switch while deleted entities don't). Teachers span the union
 * of both catalogs' `teacherKeys` — the same union the loader builds for `teacherNames`.
 */
export const buildLensUniverse = (cohorts: LensCohortSource[]): LensKeyUniverse => ({
  course: new Set(cohorts.flatMap((source) => Object.keys(source.courseDisplay))),
  teacher: new Set(cohorts.flatMap((source) => source.catalog.flatMap((course) => course.teacherKeys))),
  student: new Set(cohorts.flatMap((source) => Object.keys(source.studentNames))),
});

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

const sortByLabel = (options: LensOption[]): LensOption[] =>
  [...options].sort((a, b) => a.label.localeCompare(b.label));
