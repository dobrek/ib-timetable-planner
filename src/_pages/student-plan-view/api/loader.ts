import {
  assertNoQueryErrors,
  isUuid,
  loadCohortCourses,
  loadCourseMerges,
  loadPlacements,
  loadTeacherNames,
  unwrapMany,
  type CourseMerge,
  type SupabaseClient,
} from "@/shared/api";
import type { Cohort } from "@/shared/config";
import type { CourseDisplay, GroupingCourse } from "@/shared/lib/catalog-hash";
import { unique } from "@/shared/lib/collections";
import { parseGridPreset } from "@/shared/lib/grid";
import { err, ok, type Result } from "@/shared/lib/result";
import type { PlannerPlacement } from "@/entities/timetable";
import type { CourseInfo } from "@/widgets/timetable-board";

/** Expected absences: missing plan / student not in the plan vs. a misconfigured environment. */
export type StudentViewError = { kind: "not-found" } | { kind: "unavailable"; message: string };

export type StudentSummary = { id: string; fullName: string; cohort: Cohort };

export type StudentPlanViewData = {
  planId: string;
  planName: string;
  days: number;
  periods: number;
  student: StudentSummary;
  /** Every student of the plan — BOTH cohorts, for the switcher's cohort toggle (name-ordered). */
  students: StudentSummary[];
  /** FULL cohort catalog — the course-item builder resolves merge children through it. */
  courses: GroupingCourse[];
  courseDisplay: Record<string, CourseDisplay>;
  /** FULL cohort placements — a merge child's schedule lives on its parent's placements. */
  placements: PlannerPlacement[];
  teacherNames: Record<string, string>;
  courseInfo: Record<string, CourseInfo>;
  merges: CourseMerge[];
};

export type StudentPlanViewResult = Result<StudentPlanViewData, StudentViewError>;

/**
 * The student-view page's ONE SSR load: plan identity + the student's single-cohort read
 * dataset (catalog, placements, merges, course info, teacher names) plus the plan's
 * student list for the switcher. Schedule-only — no availability, no collision inputs, no
 * student-name records (the card rosters list teachers). Everything returned is plain
 * serializable data (Records/arrays, no Maps) — the island rebuilds indexes by calling
 * the pure `entities/timetable` functions at render time. Expected absences return
 * `not-found`; genuine DB failures throw and surface as a 500.
 */
export const loadStudentPlanView = async (
  supabase: SupabaseClient | null,
  planId: string,
  studentId: string,
): Promise<StudentPlanViewResult> => {
  if (!supabase) return err({ kind: "unavailable", message: "Supabase is not configured" });
  if (!isUuid(planId) || !isUuid(studentId)) return err({ kind: "not-found" });

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id, name, slot_grid_preset")
    .eq("id", planId)
    .maybeSingle();
  if (planError) throw new Error(`Plan lookup failed: ${planError.message}`);
  if (!plan) return err({ kind: "not-found" });

  const students = await fetchPlanStudents(supabase, planId);
  const student = students.find((row) => row.id === studentId);
  if (!student) return err({ kind: "not-found" });

  const [catalog, placementsResult, merges, courseInfo] = await Promise.all([
    loadCohortCourses(supabase, planId, student.cohort),
    loadPlacements(supabase, planId, student.cohort),
    loadCourseMerges(supabase, planId),
    fetchCourseInfo(supabase, planId, student.cohort),
  ]);
  assertNoQueryErrors("Student plan view", [placementsResult]);

  const teacherNames = await loadTeacherNames(
    supabase,
    unique(catalog.courses.flatMap((course) => course.teacherKeys)),
  );

  const { days, periods } = parseGridPreset(plan.slot_grid_preset);

  return ok({
    planId: plan.id,
    planName: plan.name,
    days,
    periods,
    student,
    students,
    courses: catalog.courses,
    courseDisplay: Object.fromEntries(catalog.courseDisplay),
    placements: (placementsResult.data ?? []).map(toPlannerPlacement),
    teacherNames,
    courseInfo,
    merges,
  });
};

const fetchPlanStudents = async (supabase: SupabaseClient, planId: string): Promise<StudentSummary[]> => {
  const rows = unwrapMany(
    await supabase.from("students").select("id, full_name, cohort").eq("plan_id", planId).order("full_name").limit(500),
    "Failed to load the plan's students",
  );
  return rows.map((row) => ({ id: row.id, fullName: row.full_name, cohort: row.cohort }));
};

/** Cohort-narrowed (unlike the teacher view's plan-wide fetch): no cross-cohort rendering exists. */
const fetchCourseInfo = async (
  supabase: SupabaseClient,
  planId: string,
  cohort: Cohort,
): Promise<Record<string, CourseInfo>> => {
  const rows = unwrapMany(
    await supabase
      .from("courses")
      .select("id, cohort, name, level, group_index, hours_per_week")
      .eq("plan_id", planId)
      .eq("cohort", cohort)
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

const toPlannerPlacement = (row: {
  id: string;
  course_id: string;
  day: number;
  period: number;
  week: PlannerPlacement["week"];
  bundle_id: string;
}): PlannerPlacement => ({
  id: row.id,
  courseId: row.course_id,
  day: row.day,
  period: row.period,
  week: row.week,
  bundleId: row.bundle_id,
});
