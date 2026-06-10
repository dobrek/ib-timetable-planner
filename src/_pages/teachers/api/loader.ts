import type { SupabaseClient } from "@/shared/api";
import type { CourseAssignment, TeacherRow } from "../model/teacher";

export type TeacherCatalogData = {
  teachers: TeacherRow[];
  cohortIds: { y1: string; y2: string };
};

export type TeacherCatalogResult = { kind: "ok"; data: TeacherCatalogData } | { kind: "unavailable" };

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

  for (const res of [cohortsRes, teachersRes, coursesRes]) {
    if (res.error) throw new Error(`Teacher catalog lookup failed: ${res.error.message}`);
  }

  const cohorts = cohortsRes.data ?? [];
  const y1 = cohorts[0]?.id ?? "";
  const y2 = cohorts[1]?.id ?? "";

  const assignmentsByTeacher = new Map<string, CourseAssignment[]>();
  for (const course of coursesRes.data ?? []) {
    if (!course.teacher_id) continue;
    const assignment: CourseAssignment = {
      id: course.id,
      cohortId: course.cohort_id,
      name: course.name,
      level: course.level,
      groupIndex: course.group_index,
      hours: course.hours_per_week,
    };
    const existing = assignmentsByTeacher.get(course.teacher_id) ?? [];
    existing.push(assignment);
    assignmentsByTeacher.set(course.teacher_id, existing);
  }

  const teachers: TeacherRow[] = (teachersRes.data ?? []).map((teacher) => ({
    id: teacher.id,
    code: teacher.code,
    fullName: teacher.full_name,
    assignments: assignmentsByTeacher.get(teacher.id) ?? [],
  }));

  return { teachers, cohortIds: { y1, y2 } };
};

/** Load the teachers catalog for the page island. Returns unavailable when client is null. */
export const loadTeacherCatalog = async (supabase: SupabaseClient | null): Promise<TeacherCatalogResult> => {
  if (!supabase) return { kind: "unavailable" };
  return { kind: "ok", data: await fetchTeacherCatalog(supabase) };
};
