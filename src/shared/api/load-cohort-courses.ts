import type { SupabaseClient } from "@/shared/api";
import type { Cohort } from "@/shared/config/cohorts";
import { groupByInto, unique } from "@/shared/lib/collections";
import type { CohortCatalog, ComputeWarning, GroupingCourse } from "@/shared/lib/catalog-hash";
import { DomainError } from "@/shared/lib/errors";
import { unwrapMany } from "./postgrest";

type Supabase = SupabaseClient;

/**
 * Loads one plan-cohort's catalog from Supabase and assembles the same `GroupingCourse[]`
 * projection the fixture adapter emits — keyed by `course.id` / `student.id` rather
 * than composite name tokens. Mirrors the legacy `subjects.ts` assembly:
 *   - regular courses (those with direct student choices) take their own choices
 *     unioned with their overlap-dependents' choices (base receives dependent's
 *     students, per the `course_overlaps` schema comment);
 *   - virtual merge-parent courses take the union of their children's choices.
 */
export const loadCohortCourses = async (supabase: Supabase, planId: string, cohort: Cohort): Promise<CohortCatalog> => {
  const courseRows = await fetchCourses(supabase, planId, cohort);
  const courseIds = courseRows.map((course) => course.id);
  const [choiceRows, overlapRows, mergeRows] = await Promise.all([
    fetchChoices(supabase, courseIds),
    fetchOverlaps(supabase, courseIds),
    fetchMerges(supabase, courseIds),
  ]);

  const courseById = new Map(courseRows.map((course) => [course.id, course]));
  const directStudents = groupByInto(
    choiceRows,
    (row) => row.course_id,
    (row) => row.student_id,
  );
  const dependentsOf = groupByInto(
    overlapRows,
    (row) => row.base_course_id,
    (row) => row.dependent_course_id,
  );
  const childrenOf = groupByInto(
    mergeRows,
    (row) => row.parent_course_id,
    (row) => row.child_course_id,
  );
  const mergeChildIds = new Set(mergeRows.map((row) => row.child_course_id));
  const mergeParentIds = new Set(childrenOf.keys());

  const studentsOf = (courseId: string): string[] => directStudents.get(courseId) ?? [];

  // A merge parent is represented once, as a virtual course — exclude it here even if it
  // also carries direct choices, so the same id can't enter both buckets (bug #5).
  const regularCourses: GroupingCourse[] = courseRows
    .filter((course) => directStudents.has(course.id) && !mergeParentIds.has(course.id))
    .map((course) => ({
      id: course.id,
      teacherKey: course.teacher_id,
      hours: course.hours_per_week,
      studentKeys: unique([...studentsOf(course.id), ...(dependentsOf.get(course.id) ?? []).flatMap(studentsOf)]),
    }));

  const virtualCourses: GroupingCourse[] = [...childrenOf.entries()].map(([parentId, childIds]) => {
    const parent = courseById.get(parentId);
    // Merge rows are fetched by parent_course_id IN courseIds, so the parent is always
    // present; fail loudly rather than fabricating a phantom (teacherKey:null, hours:0).
    if (!parent)
      throw new DomainError("INTERNAL_SERVER_ERROR", `Merge parent ${parentId} missing from the plan-cohort catalog`);
    return {
      id: parentId,
      teacherKey: parent.teacher_id,
      hours: parent.hours_per_week,
      studentKeys: unique([...studentsOf(parentId), ...childIds.flatMap(studentsOf)]),
    };
  });

  const courses = [...regularCourses, ...virtualCourses];
  const names = new Map(courses.map((course) => [course.id, compositeName(courseById.get(course.id))]));
  const warnings = collectWarnings(courses, mergeChildIds);

  return { courses, names, warnings };
};

type CourseRow = {
  id: string;
  name: string;
  level: string;
  group_index: number;
  hours_per_week: number;
  teacher_id: string | null;
};

const fetchCourses = async (supabase: Supabase, planId: string, cohort: Cohort): Promise<CourseRow[]> =>
  unwrapMany(
    await supabase
      .from("courses")
      .select("id, name, level, group_index, hours_per_week, teacher_id")
      .eq("plan_id", planId)
      .eq("cohort", cohort)
      .order("id"),
    `Failed to load courses for plan ${planId} cohort ${cohort}`,
  );

const fetchChoices = async (
  supabase: Supabase,
  courseIds: string[],
): Promise<{ course_id: string; student_id: string }[]> => {
  if (courseIds.length === 0) return [];
  return unwrapMany(
    await supabase.from("student_choices").select("course_id, student_id").in("course_id", courseIds),
    "Failed to load student choices",
  );
};

const fetchOverlaps = async (
  supabase: Supabase,
  courseIds: string[],
): Promise<{ base_course_id: string; dependent_course_id: string }[]> => {
  if (courseIds.length === 0) return [];
  return unwrapMany(
    await supabase
      .from("course_overlaps")
      .select("base_course_id, dependent_course_id")
      .in("base_course_id", courseIds),
    "Failed to load course overlaps",
  );
};

const fetchMerges = async (
  supabase: Supabase,
  courseIds: string[],
): Promise<{ parent_course_id: string; child_course_id: string }[]> => {
  if (courseIds.length === 0) return [];
  return unwrapMany(
    await supabase.from("course_merges").select("parent_course_id, child_course_id").in("parent_course_id", courseIds),
    "Failed to load course merges",
  );
};

/**
 * Rebuilds the composite name token (the fixture adapter's `id`) from catalog
 * columns, mirroring `subjectName`: `'none'` level and `0` group_index are the
 * "absent" sentinels, dropped before joining; spaces
 * become underscores.
 */
const compositeName = (course: CourseRow | undefined): string => {
  if (!course) return "";
  const level = course.level === "none" ? "" : course.level;
  const group = course.group_index === 0 ? "" : String(course.group_index);
  return [course.name, level, group].filter(Boolean).join("-").replaceAll(/ /g, "_");
};

const collectWarnings = (courses: GroupingCourse[], mergeChildIds: Set<string>): ComputeWarning[] =>
  courses.flatMap((course) => {
    const warnings: ComputeWarning[] = [];
    if (course.teacherKey === null) {
      warnings.push({ courseId: course.id, kind: "no-teacher", message: `Course ${course.id} has no teacher.` });
    }
    if (course.studentKeys.length === 0) {
      warnings.push({ courseId: course.id, kind: "no-students", message: `Course ${course.id} has no students.` });
    }
    // Merge children legitimately carry 0 standalone hours (taught inside the parent session).
    if (course.hours === 0 && !mergeChildIds.has(course.id)) {
      warnings.push({ courseId: course.id, kind: "zero-hours", message: `Course ${course.id} has zero hours.` });
    }
    return warnings;
  });
