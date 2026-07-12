import { assertNoQueryErrors, type SupabaseClient } from "@/shared/api";
import { groupBy } from "@/shared/lib/collections";
import { withSupabase, type LoaderResult } from "@/shared/lib/result";
import { formatCourseRowBadgeLabel } from "@/shared/lib/course-label";
import type { CourseOption, StudentRow } from "../model/student";

export type StudentCatalogData = {
  students: StudentRow[];
  courses: CourseOption[];
};

export type StudentCatalogResult = LoaderResult<StudentCatalogData>;

/** Load one plan's students catalog for the page island. Unavailable when the client is null. */
export const loadStudentCatalog = (supabase: SupabaseClient | null, planId: string): Promise<StudentCatalogResult> =>
  withSupabase(supabase, (client) => fetchStudentCatalog(client, planId));

// The effective ceiling is PostgREST's `max_rows = 1000` (supabase/config.toml): every
// response is capped there, so a guard set higher than 1000 can never fire and truncation
// past 1000 choices would pass silently. Pinned to the real cap so the read fails loudly
// instead. (Raising the cap / pagination — and the same unguarded ceiling on
// load-cohort-courses.ts — are out of scope; explicit follow-up.)
const CHOICES_LIMIT = 1000;

const fetchStudentCatalog = async (client: SupabaseClient, planId: string): Promise<StudentCatalogData> => {
  const [studentsRes, choicesRes, coursesRes, mergesRes] = await Promise.all([
    client.from("students").select("id, cohort, full_name").eq("plan_id", planId).order("full_name").limit(500),
    client.from("student_choices").select("student_id, course_id").eq("plan_id", planId).limit(CHOICES_LIMIT),
    client
      .from("courses")
      .select("id, cohort, name, level, group_index")
      .eq("plan_id", planId)
      .order("name")
      .limit(500),
    client.from("course_merges").select("parent_course_id").eq("plan_id", planId).limit(500),
  ]);
  assertNoQueryErrors("Student catalog", [studentsRes, choicesRes, coursesRes, mergesRes]);
  assertChoicesNotTruncated(choicesRes.data ?? []);

  const choicesByStudent = groupBy(choicesRes.data ?? [], (choice) => choice.student_id);
  const mergeParentIds = new Set((mergesRes.data ?? []).map((merge) => merge.parent_course_id));

  const courses: CourseOption[] = (coursesRes.data ?? []).map((course) => ({
    id: course.id,
    cohort: course.cohort,
    label: formatCourseRowBadgeLabel(course),
    isMergeParent: mergeParentIds.has(course.id),
  }));
  const labelByCourseId = new Map(courses.map((course) => [course.id, course.label]));

  const students: StudentRow[] = (studentsRes.data ?? [])
    .map((student) => ({
      id: student.id,
      cohort: student.cohort,
      fullName: student.full_name,
      // Sort choices by their displayed label so badge order is deterministic.
      choiceCourseIds: (choicesByStudent.get(student.id) ?? [])
        .map((choice) => choice.course_id)
        .sort((a, b) => compareByLabel(a, b, labelByCourseId)),
    }))
    // Sort students by name (id as a stable tiebreaker for duplicates).
    .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id));

  return { students, courses };
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
