import type { SupabaseClient } from "@/shared/api";
import { groupBy } from "@/shared/lib/collections";
import { assertNoQueryErrors, withSupabase, type LoaderResult } from "@/shared/lib/loaders";
import type { TeacherRow } from "../model/teacher";

export type TeacherCatalogData = {
  teachers: TeacherRow[];
  cohortIds: { y1: string; y2: string };
};

export type TeacherCatalogResult = LoaderResult<TeacherCatalogData>;

/** Load the teachers catalog for the page island. Unavailable when the client is null. */
export const loadTeacherCatalog = (supabase: SupabaseClient | null): Promise<TeacherCatalogResult> =>
  withSupabase(supabase, fetchTeacherCatalog);

const fetchTeacherCatalog = async (client: SupabaseClient): Promise<TeacherCatalogData> => {
  const [cohortsRes, teachersRes, coursesRes] = await Promise.all([
    client.from("cohorts").select("id, name").order("name"),
    client
      .from("teachers")
      .select("id, code, full_name")
      .order("full_name", { nullsFirst: false })
      .order("code")
      .limit(500),
    client
      .from("courses")
      .select("id, cohort_id, name, level, group_index, hours_per_week, teacher_id")
      .not("teacher_id", "is", null)
      .order("name")
      .limit(500),
  ]);
  assertNoQueryErrors("Teacher catalog", [cohortsRes, teachersRes, coursesRes]);

  const cohorts = cohortsRes.data ?? [];
  const y1 = cohorts[0]?.id ?? "";
  const y2 = cohorts[1]?.id ?? "";

  const assignedCourses = (coursesRes.data ?? []).filter((course) => course.teacher_id !== null);
  const assignmentsByTeacher = groupBy(assignedCourses, (course) => course.teacher_id);

  const teachers: TeacherRow[] = (teachersRes.data ?? []).map((teacher) => ({
    id: teacher.id,
    code: teacher.code,
    fullName: teacher.full_name,
    assignments: (assignmentsByTeacher.get(teacher.id) ?? []).map((course) => ({
      id: course.id,
      cohortId: course.cohort_id,
      name: course.name,
      level: course.level,
      groupIndex: course.group_index,
      hours: course.hours_per_week,
    })),
  }));

  return { teachers, cohortIds: { y1, y2 } };
};
