import {
  assertNoQueryErrors,
  isUuid,
  loadCohortCourses,
  loadCourseMerges,
  loadPlacements,
  loadPlanTeachers,
  loadStudentNames,
  loadTeacherAvailability,
  loadTeacherNames,
  unwrapMany,
  type CourseMerge,
  type PlanTeacher,
  type SupabaseClient,
} from "@/shared/api";
import type { CourseDisplay, GroupingCourse } from "@/shared/lib/catalog-hash";
import { unique } from "@/shared/lib/collections";
import { parseGridPreset } from "@/shared/lib/grid";
import { err, ok, type Result } from "@/shared/lib/result";
import { toPlannerPlacement, type BoardAvailabilityCell, type PlannerPlacement } from "@/entities/timetable";
import type { CourseInfo } from "@/widgets/timetable-board";

/** Expected absences: missing plan / teacher not in the plan vs. a misconfigured environment. */
export type TeacherViewError = { kind: "not-found" } | { kind: "unavailable"; message: string };

/** The plan's teacher record — the shared `PlanTeacher`, re-aliased so slice consumers keep one import home. */
export type TeacherSummary = PlanTeacher;

// The course list's `CourseInfo` prop shape lives with the widget; re-exported so the
// route and slice barrel keep one import home for the loader's data types.
export type { CourseInfo };

export type TeacherViewCohortData = {
  /** FULL cohort catalog — collision derivation needs every course, not just the teacher's. */
  courses: GroupingCourse[];
  courseDisplay: Record<string, CourseDisplay>;
  placements: PlannerPlacement[];
  studentNames: Record<string, string>;
};

export type TeacherPlanViewData = {
  planId: string;
  planName: string;
  days: number;
  periods: number;
  teacher: TeacherSummary;
  /** Every teacher of the plan, for the switcher (sorted by name, then code). */
  teachers: TeacherSummary[];
  availability: BoardAvailabilityCell[];
  teacherNames: Record<string, string>;
  courseInfo: Record<string, CourseInfo>;
  merges: CourseMerge[];
  dp1: TeacherViewCohortData;
  dp2: TeacherViewCohortData;
};

export type TeacherPlanViewResult = Result<TeacherPlanViewData, TeacherViewError>;

/**
 * The teacher-view page's ONE SSR load: plan identity + the full two-cohort read dataset
 * (catalogs, placements, availability, merges, name records) plus the plan's teacher list.
 * Everything returned is plain serializable data (Records/arrays, no Maps) — the island
 * rebuilds indexes by calling the pure `entities/timetable` functions at render time.
 * Expected absences return `not-found`; genuine DB failures throw and surface as a 500.
 */
export const loadTeacherPlanView = async (
  supabase: SupabaseClient | null,
  planId: string,
  teacherId: string,
): Promise<TeacherPlanViewResult> => {
  if (!supabase) return err({ kind: "unavailable", message: "Supabase is not configured" });
  if (!isUuid(planId) || !isUuid(teacherId)) return err({ kind: "not-found" });

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id, name, slot_grid_preset")
    .eq("id", planId)
    .maybeSingle();
  if (planError) throw new Error(`Plan lookup failed: ${planError.message}`);
  if (!plan) return err({ kind: "not-found" });

  const teachers = await loadPlanTeachers(supabase, planId);
  const teacher = teachers.find((row) => row.id === teacherId);
  if (!teacher) return err({ kind: "not-found" });

  const [dp1Catalog, dp2Catalog, dp1Placements, dp2Placements, availabilityResult, merges, courseInfo] =
    await Promise.all([
      loadCohortCourses(supabase, planId, "dp1"),
      loadCohortCourses(supabase, planId, "dp2"),
      loadPlacements(supabase, planId, "dp1"),
      loadPlacements(supabase, planId, "dp2"),
      loadTeacherAvailability(supabase, planId),
      loadCourseMerges(supabase, planId),
      fetchCourseInfo(supabase, planId),
    ]);
  assertNoQueryErrors("Teacher plan view", [dp1Placements, dp2Placements, availabilityResult]);

  const [teacherNames, dp1StudentNames, dp2StudentNames] = await Promise.all([
    loadTeacherNames(
      supabase,
      unique([...dp1Catalog.courses, ...dp2Catalog.courses].flatMap((course) => course.teacherKeys)),
    ),
    loadStudentNames(supabase, unique(dp1Catalog.courses.flatMap((course) => course.studentKeys))),
    loadStudentNames(supabase, unique(dp2Catalog.courses.flatMap((course) => course.studentKeys))),
  ]);

  const { days, periods } = parseGridPreset(plan.slot_grid_preset);

  return ok({
    planId: plan.id,
    planName: plan.name,
    days,
    periods,
    teacher,
    teachers,
    availability: (availabilityResult.data ?? []).map((row) => ({
      teacherKey: row.teacher_id,
      day: row.day,
      period: row.period,
      severity: row.severity,
    })),
    teacherNames,
    courseInfo,
    merges,
    dp1: {
      courses: dp1Catalog.courses,
      courseDisplay: Object.fromEntries(dp1Catalog.courseDisplay),
      placements: (dp1Placements.data ?? []).map(toPlannerPlacement),
      studentNames: dp1StudentNames,
    },
    dp2: {
      courses: dp2Catalog.courses,
      courseDisplay: Object.fromEntries(dp2Catalog.courseDisplay),
      placements: (dp2Placements.data ?? []).map(toPlannerPlacement),
      studentNames: dp2StudentNames,
    },
  });
};

const fetchCourseInfo = async (supabase: SupabaseClient, planId: string): Promise<Record<string, CourseInfo>> => {
  const rows = unwrapMany(
    await supabase
      .from("courses")
      .select("id, cohort, name, level, group_index, hours_per_week")
      .eq("plan_id", planId)
      .limit(2000),
    "Failed to load course rows",
  );
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        name: row.name,
        level: row.level,
        groupIndex: row.group_index,
        cohort: row.cohort,
        hoursPerWeek: row.hours_per_week,
      },
    ]),
  );
};
