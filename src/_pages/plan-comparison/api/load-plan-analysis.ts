import type { SupabaseClient } from "@/shared/api";
import {
  loadCohortCourses,
  loadPlacements,
  loadPlanTeachers,
  loadTeacherAvailability,
  unwrapMany,
  type PlanTeacher,
} from "@/shared/api";
import { COHORT_VALUES, type Cohort } from "@/shared/config";
import { parseGridPreset } from "@/shared/lib/grid";
import type { ComputeWarning, CourseNaturalKey } from "@/shared/lib/catalog-hash";
import type { AnalyzerCourse, AnalyzerRow, GeneratorSnapshot, PlanAnalysisInput } from "@/entities/timetable";

/**
 * Loads one plan **by id** into everything the analyzer, the rule oracle, and the cross-plan
 * fingerprint need. Plans are addressed by id, never by name — the bench's name lookup ("Seed Plan
 * A") broke the moment the gold plan arrived under a different name, and the error messages here name
 * the id for the same reason.
 *
 * Promoted out of `bench/` (`comparing-plans` Phase 2) so the CLI analyzer and the in-app comparison
 * surface share ONE loader: a duplicated ~15-query loader drifts silently, and drift here means the
 * two disagree about what a plan *is* — while the CLI is precisely the tool used to validate the UI's
 * numbers. It takes the Supabase client as a parameter, so the bench keeps its service-role client
 * and the app passes the request-scoped one. Every table it reads is already read by the
 * authenticated app client (`plan-detail/api/load.ts`), so there is no new RLS or grant surface.
 *
 * The `snapshot` carries `pins: []` with the whole board handed over as `generated`, which is what
 * makes the verify-gold experiment free: `verifyGeneration(snapshot, board)` then answers exactly
 * "would the engine have been ALLOWED to ship this board" — including the 2/day stacking cap, which
 * only applies to generated rows.
 */
export type LoadedPlan = {
  id: string;
  name: string;
  /** The extractor's input. Carries the parsed grid (`days`, `periods`) — which is what the drift
   *  tier compares, since a differing `slot_grid_preset` is only *meaningful* through those two. */
  input: PlanAnalysisInput;
  /** An empty-board snapshot of the same plan — the oracle's view of the catalog. */
  snapshot: GeneratorSnapshot;
  /** The plan's whole board, shaped as engine output so the oracle can judge it. */
  board: AnalyzerRow[];
  /**
   * The plan's people, keyed by the id the analyzer speaks in and valued by the **natural key** that
   * survives a clone. Two jobs, one wave: the cross-plan fingerprint hashes these (a clone re-mints
   * every UUID, so ids cannot answer "same catalog?"), and the scoreboard resolves its extremes'
   * opaque keys to names through the very same maps.
   */
  naturalKeys: PlanNaturalKeys;
  /**
   * Catalog anomalies `loadCohortCourses` flags (`no-students`, `zero-hours`). Surfaced rather than
   * dropped: these are precisely the rows that quietly distort the numbers — a zero-hours course
   * reads as "complete", a no-students course contributes nothing to the slot census — and for a
   * tool whose whole product is trustworthy figures, a silent catalog anomaly is a wrong answer.
   */
  warnings: PlanWarning[];
};

/**
 * Teacher `code` is a real natural key (`teachers_plan_code_unique (plan_id, code)`).
 *
 * Student `full_name` is **not** — `students` carries no unique constraint on it, so two same-named
 * students collide into one fingerprint entry. Accepted, and documented rather than papered over: the
 * fingerprint compares sorted multisets (a collision changes both sides identically, so a clone still
 * matches its source) and the scoreboard reports aggregates. It would only mislead a per-student
 * drill-down, which this surface deliberately does not have.
 */
export type PlanNaturalKeys = {
  teachers: Record<string, TeacherNaturalKey>;
  students: Record<string, string>;
};

export type TeacherNaturalKey = { code: string; fullName: string | null };

export type PlanWarning = ComputeWarning & { cohort: Cohort };

export const loadPlanAnalysis = async (supabase: SupabaseClient, planId: string): Promise<LoadedPlan> => {
  const plan = await fetchPlan(supabase, planId);
  const { days, periods } = parseGridPreset(plan.slot_grid_preset);
  const [dp1, dp2, availability, parked, teachers, students] = await Promise.all([
    loadCohortAnalysis(supabase, planId, "dp1"),
    loadCohortAnalysis(supabase, planId, "dp2"),
    loadTeacherAvailability(supabase, planId),
    fetchParkedCourseIds(supabase, planId),
    loadPlanTeachers(supabase, planId),
    fetchStudentNames(supabase, planId),
  ]);

  const courses = { dp1: dp1.courses, dp2: dp2.courses };
  const board = [...dp1.rows, ...dp2.rows];
  const cells = unwrapMany(availability, `Failed to load teacher availability for plan ${planId}`).map((cell) => ({
    teacherKey: cell.teacher_id,
    day: cell.day,
    period: cell.period,
    severity: cell.severity,
  }));

  return {
    id: plan.id,
    name: plan.name,
    input: { days, periods, courses, rows: board, availability: cells, parkedCourseIds: parked },
    snapshot: {
      days,
      periods,
      availability: cells,
      finishesEarlyByCourseId: [...dp1.finishesEarlyCourseIds, ...dp2.finishesEarlyCourseIds],
      cohorts: {
        dp1: { courses: dp1.courses, pins: [], parkedCourseIds: parked.dp1 },
        dp2: { courses: dp2.courses, pins: [], parkedCourseIds: parked.dp2 },
      },
    },
    board,
    naturalKeys: { teachers: toTeacherKeys(teachers), students },
    warnings: [...dp1.warnings, ...dp2.warnings],
  };
};

const fetchPlan = async (
  supabase: SupabaseClient,
  planId: string,
): Promise<{ id: string; name: string; slot_grid_preset: string }> => {
  const { data, error } = await supabase.from("plans").select("id, name, slot_grid_preset").eq("id", planId).single();
  if (error) {
    throw new Error(
      `Plan ${planId} not found in this database (${error.message}). ` +
        `Plans are addressed by id, never by name — restore the snapshot or pass a different id.`,
    );
  }
  return data;
};

/** One cohort's analyzer projection: the shared `GroupingCourse` catalog joined by id with the
 *  subject identity the analyzer adds. Both halves now come out of `loadCohortCourses` in one query —
 *  its `courseIdentity` side-set (added in Phase 1) carries the raw `(name, level, group_index)` that
 *  `courseDisplay` folds away, so the second `courses` select this loader used to run is gone. The
 *  join cannot miss: `courseIdentity` is keyed over exactly the courses in `catalog.courses`. */
const loadCohortAnalysis = async (
  supabase: SupabaseClient,
  planId: string,
  cohort: Cohort,
): Promise<{
  courses: AnalyzerCourse[];
  rows: AnalyzerRow[];
  finishesEarlyCourseIds: string[];
  warnings: PlanWarning[];
}> => {
  const [catalog, placements] = await Promise.all([
    loadCohortCourses(supabase, planId, cohort),
    loadPlacements(supabase, planId, cohort),
  ]);

  return {
    courses: catalog.courses.map((course) => ({ ...course, ...identityOf(catalog.courseIdentity, course.id) })),
    rows: unwrapMany(placements, `Failed to load ${cohort} placements for plan ${planId}`).map((row) => ({
      cohort,
      courseId: row.course_id,
      day: row.day,
      period: row.period,
      week: row.week,
    })),
    finishesEarlyCourseIds: catalog.finishesEarlyCourseIds,
    warnings: catalog.warnings.map((warning) => ({ ...warning, cohort })),
  };
};

/** `courseIdentity` is keyed over the projected course set, so every id resolves; a miss is a bug in
 *  `loadCohortCourses`, not data — fail loudly rather than analyze an unnamed course. */
const identityOf = (identity: Map<string, CourseNaturalKey>, courseId: string): CourseNaturalKey => {
  const key = identity.get(courseId);
  if (!key) throw new Error(`Course ${courseId} has no identity in its cohort catalog`);
  return key;
};

const toTeacherKeys = (teachers: PlanTeacher[]): Record<string, TeacherNaturalKey> =>
  Object.fromEntries(teachers.map((teacher) => [teacher.id, { code: teacher.code, fullName: teacher.fullName }]));

/** Every student of the plan, id → `full_name`. Plan-scoped (not id-scoped like `loadStudentNames`),
 *  because the fingerprint hashes the whole student body, not just the ones who happen to be placed. */
const fetchStudentNames = async (supabase: SupabaseClient, planId: string): Promise<Record<string, string>> => {
  const rows = unwrapMany(
    await supabase.from("students").select("id, full_name").eq("plan_id", planId),
    `Failed to load students for plan ${planId}`,
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.full_name]));
};

/** Parked (shelved) bundle members per cohort — one entry covers one off-board hour of its course,
 *  the same multiset the generator's deficit derivation consumes. */
const fetchParkedCourseIds = async (supabase: SupabaseClient, planId: string): Promise<Record<Cohort, string[]>> => {
  const [bundles, members] = await Promise.all([
    supabase.from("shelf_bundles").select("id, cohort").eq("plan_id", planId),
    supabase.from("shelf_bundle_courses").select("shelf_bundle_id, course_id").eq("plan_id", planId),
  ]);
  const cohortOf = new Map(
    unwrapMany(bundles, `Failed to load shelf bundles for plan ${planId}`).map((bundle) => [bundle.id, bundle.cohort]),
  );
  const parked = Object.fromEntries(COHORT_VALUES.map((cohort) => [cohort, [] as string[]])) as Record<
    Cohort,
    string[]
  >;
  for (const member of unwrapMany(members, `Failed to load shelf bundle members for plan ${planId}`)) {
    const cohort = cohortOf.get(member.shelf_bundle_id);
    if (cohort) parked[cohort].push(member.course_id);
  }
  return parked;
};
