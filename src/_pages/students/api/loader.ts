import { toOrderedCohorts, type CohortOption, type SupabaseClient } from "@/shared/api";
import { groupBy } from "@/shared/lib/collections";
import { assertNoQueryErrors, withSupabase, type LoaderResult } from "@/shared/lib/loaders";
import { formatCourseBadgeLabel } from "@/shared/lib/course-label";
import type { CourseOption, StudentRow } from "../model/student";

export type StudentCatalogData = {
  students: StudentRow[];
  cohorts: CohortOption[];
  courses: CourseOption[];
};

export type StudentCatalogResult = LoaderResult<StudentCatalogData>;

/** Load the students catalog for the page island. Unavailable when the client is null. */
export const loadStudentCatalog = (supabase: SupabaseClient | null): Promise<StudentCatalogResult> =>
  withSupabase(supabase, fetchStudentCatalog);

const CHOICES_LIMIT = 2000;

const fetchStudentCatalog = async (client: SupabaseClient): Promise<StudentCatalogData> => {
  const [cohortsRes, studentsRes, choicesRes, coursesRes, mergesRes] = await Promise.all([
    client.from("cohorts").select("id, name").order("name"),
    client.from("students").select("id, cohort_id, full_name").order("full_name").limit(500),
    client.from("student_choices").select("student_id, course_id").limit(CHOICES_LIMIT),
    client.from("courses").select("id, cohort_id, name, level, group_index").order("name").limit(500),
    client.from("course_merges").select("parent_course_id").limit(500),
  ]);
  assertNoQueryErrors("Student catalog", [cohortsRes, studentsRes, choicesRes, coursesRes, mergesRes]);
  assertChoicesNotTruncated(choicesRes.data ?? []);

  const choicesByStudent = groupBy(choicesRes.data ?? [], (choice) => choice.student_id);
  const mergeParentIds = new Set((mergesRes.data ?? []).map((merge) => merge.parent_course_id));

  const courses: CourseOption[] = (coursesRes.data ?? []).map((course) => ({
    id: course.id,
    cohortId: course.cohort_id,
    label: formatCourseBadgeLabel({ name: course.name, level: course.level, groupIndex: course.group_index }),
    isMergeParent: mergeParentIds.has(course.id),
  }));
  const labelByCourseId = new Map(courses.map((course) => [course.id, course.label]));

  const students: StudentRow[] = (studentsRes.data ?? [])
    .map((student) => ({
      id: student.id,
      cohortId: student.cohort_id,
      fullName: student.full_name,
      // Sort choices by their displayed label so badge order is deterministic.
      choiceCourseIds: (choicesByStudent.get(student.id) ?? [])
        .map((choice) => choice.course_id)
        .sort((a, b) => compareByLabel(a, b, labelByCourseId)),
    }))
    // Sort students by name (id as a stable tiebreaker for duplicates).
    .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id));

  return { students, cohorts: toOrderedCohorts(cohortsRes.data ?? []), courses };
};

const compareByLabel = (a: string, b: string, labelByCourseId: Map<string, string>): number =>
  (labelByCourseId.get(a) ?? "").localeCompare(labelByCourseId.get(b) ?? "") || a.localeCompare(b);

/**
 * A maxed-out choices read means rows beyond the limit were silently dropped. Editing a student
 * from a truncated catalog would land the missing choices in the update diff's `toRemove`, so
 * refuse to render rather than risk silent deletion.
 */
const assertChoicesNotTruncated = (choices: readonly unknown[]): void => {
  if (choices.length >= CHOICES_LIMIT) {
    throw new Error(
      `Student catalog: student_choices hit its ${CHOICES_LIMIT}-row limit; refusing to render a truncated catalog`,
    );
  }
};
