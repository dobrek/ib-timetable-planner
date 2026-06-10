import type { SupabaseClient } from "@/shared/api";
import { unique } from "@/shared/lib/collections";
import type { ComputeWarning, GroupingCourse } from "../model/grouping";

type Supabase = SupabaseClient;

export type CohortCatalog = {
  courses: GroupingCourse[];
  /** course.id → reconstructed composite name (the fixture's natural key) for display + cross-check. */
  names: Map<string, string>;
  warnings: ComputeWarning[];
};

/**
 * Loads a cohort's catalog from Supabase and assembles the same `GroupingCourse[]`
 * projection the fixture adapter emits — keyed by `course.id` / `student.id` rather
 * than composite name tokens. Mirrors the legacy `subjects.ts` assembly:
 *   - regular courses (those with direct student choices) take their own choices
 *     unioned with their overlap-dependents' choices (base receives dependent's
 *     students, per the `course_overlaps` schema comment);
 *   - virtual merge-parent courses take the union of their children's choices.
 */
export const loadCohortCourses = async (supabase: Supabase, cohortId: string): Promise<CohortCatalog> => {
  const courseRows = await fetchCourses(supabase, cohortId);
  const courseIds = courseRows.map((course) => course.id);
  const [choiceRows, overlapRows, mergeRows] = await Promise.all([
    fetchChoices(supabase, courseIds),
    fetchOverlaps(supabase, courseIds),
    fetchMerges(supabase, courseIds),
  ]);

  const courseById = new Map(courseRows.map((course) => [course.id, course]));
  const directStudents = groupByCourse(choiceRows);
  const dependentsOf = groupPairs(overlapRows.map((row) => [row.base_course_id, row.dependent_course_id]));
  const childrenOf = groupPairs(mergeRows.map((row) => [row.parent_course_id, row.child_course_id]));
  const mergeChildIds = new Set(mergeRows.map((row) => row.child_course_id));

  const studentsOf = (courseId: string): string[] => directStudents.get(courseId) ?? [];

  const regularCourses: GroupingCourse[] = courseRows
    .filter((course) => directStudents.has(course.id))
    .map((course) => ({
      id: course.id,
      teacherKey: course.teacher_id,
      hours: course.hours_per_week,
      studentKeys: unique([...studentsOf(course.id), ...(dependentsOf.get(course.id) ?? []).flatMap(studentsOf)]),
    }));

  const virtualCourses: GroupingCourse[] = [...childrenOf.entries()].map(([parentId, childIds]) => {
    const parent = courseById.get(parentId);
    return {
      id: parentId,
      teacherKey: parent?.teacher_id ?? null,
      hours: parent?.hours_per_week ?? 0,
      studentKeys: childIds.flatMap(studentsOf),
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

const fetchCourses = async (supabase: Supabase, cohortId: string): Promise<CourseRow[]> => {
  const { data, error } = await supabase
    .from("courses")
    .select("id, name, level, group_index, hours_per_week, teacher_id")
    .eq("cohort_id", cohortId)
    .order("id");
  if (error) throw new Error(`Failed to load courses for cohort ${cohortId}: ${error.message}`);
  return data;
};

const fetchChoices = async (
  supabase: Supabase,
  courseIds: string[],
): Promise<{ course_id: string; student_id: string }[]> => {
  if (courseIds.length === 0) return [];
  const { data, error } = await supabase
    .from("student_choices")
    .select("course_id, student_id")
    .in("course_id", courseIds);
  if (error) throw new Error(`Failed to load student choices: ${error.message}`);
  return data;
};

const fetchOverlaps = async (
  supabase: Supabase,
  courseIds: string[],
): Promise<{ base_course_id: string; dependent_course_id: string }[]> => {
  if (courseIds.length === 0) return [];
  const { data, error } = await supabase
    .from("course_overlaps")
    .select("base_course_id, dependent_course_id")
    .in("base_course_id", courseIds);
  if (error) throw new Error(`Failed to load course overlaps: ${error.message}`);
  return data;
};

const fetchMerges = async (
  supabase: Supabase,
  courseIds: string[],
): Promise<{ parent_course_id: string; child_course_id: string }[]> => {
  if (courseIds.length === 0) return [];
  const { data, error } = await supabase
    .from("course_merges")
    .select("parent_course_id, child_course_id")
    .in("parent_course_id", courseIds);
  if (error) throw new Error(`Failed to load course merges: ${error.message}`);
  return data;
};

const groupByCourse = (rows: { course_id: string; student_id: string }[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const { course_id, student_id } of rows) {
    const existing = map.get(course_id);
    if (existing) existing.push(student_id);
    else map.set(course_id, [student_id]);
  }
  return map;
};

const groupPairs = (pairs: [string, string][]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const [key, value] of pairs) {
    const existing = map.get(key);
    if (existing) existing.push(value);
    else map.set(key, [value]);
  }
  return map;
};

/**
 * Rebuilds the composite name token (the fixture adapter's `id`) from catalog
 * columns, mirroring `subjectName`: `'none'` level and `0` group_index are the
 * "absent" sentinels (see `snippets/*.csv.sql`), dropped before joining; spaces
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
