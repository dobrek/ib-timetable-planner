import type { SupabaseClient } from "@/shared/api";
import { loadCohortCourses, loadPlacements, loadTeacherAvailability, unwrapMany } from "@/shared/api";
import { COHORT_VALUES, type Cohort } from "@/shared/config";
import { parseGridPreset } from "@/shared/lib/grid";
import type { AnalyzerCourse, AnalyzerRow, GeneratorSnapshot, PlanAnalysisInput } from "@/entities/timetable";

/**
 * Loads one plan **by id** into everything the analyzer and the rule oracle need. Plans are
 * addressed by id, never by name — the bench's name lookup ("Seed Plan A") broke the moment the
 * gold plan arrived under a different name, and the error messages here name the id for the same
 * reason.
 *
 * The `snapshot` carries `pins: []` with the whole board handed over as `generated`, which is what
 * makes the verify-gold experiment free: `verifyGeneration(snapshot, board)` then answers exactly
 * "would the engine have been ALLOWED to ship this board" — including the 2/day stacking cap, which
 * only applies to generated rows.
 */
export type LoadedPlan = {
  id: string;
  name: string;
  /** The extractor's input. */
  input: PlanAnalysisInput;
  /** An empty-board snapshot of the same plan — the oracle's view of the catalog. */
  snapshot: GeneratorSnapshot;
  /** The plan's whole board, shaped as engine output so the oracle can judge it. */
  board: AnalyzerRow[];
};

export const loadPlanAnalysis = async (supabase: SupabaseClient, planId: string): Promise<LoadedPlan> => {
  const plan = await fetchPlan(supabase, planId);
  const { days, periods } = parseGridPreset(plan.slot_grid_preset);
  const [dp1, dp2, availability, parked] = await Promise.all([
    loadCohortAnalysis(supabase, planId, "dp1"),
    loadCohortAnalysis(supabase, planId, "dp2"),
    loadTeacherAvailability(supabase, planId),
    fetchParkedCourseIds(supabase, planId),
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
 *  subject identity the analyzer adds (`loadCohortCourses` stays untouched — the display map it
 *  already builds carries a composite name, not the raw `name`/`level`/`group_index` the roll-ups
 *  and the mirrored-cell census need). */
const loadCohortAnalysis = async (
  supabase: SupabaseClient,
  planId: string,
  cohort: Cohort,
): Promise<{ courses: AnalyzerCourse[]; rows: AnalyzerRow[]; finishesEarlyCourseIds: string[] }> => {
  const [catalog, subjects, placements] = await Promise.all([
    loadCohortCourses(supabase, planId, cohort),
    supabase.from("courses").select("id, name, level, group_index").eq("plan_id", planId).eq("cohort", cohort),
    loadPlacements(supabase, planId, cohort),
  ]);
  const subjectById = new Map(
    unwrapMany(subjects, `Failed to load ${cohort} subject identity for plan ${planId}`).map((course) => [
      course.id,
      course,
    ]),
  );

  return {
    courses: catalog.courses.map((course) => {
      const subject = subjectById.get(course.id);
      // Every projected course id comes from the same `courses` table, so a miss is a bug, not data.
      if (!subject) throw new Error(`Course ${course.id} missing from the ${cohort} courses table of plan ${planId}`);
      return { ...course, name: subject.name, level: subject.level, groupIndex: subject.group_index };
    }),
    rows: unwrapMany(placements, `Failed to load ${cohort} placements for plan ${planId}`).map((row) => ({
      cohort,
      courseId: row.course_id,
      day: row.day,
      period: row.period,
      week: row.week,
    })),
    finishesEarlyCourseIds: catalog.finishesEarlyCourseIds,
  };
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
