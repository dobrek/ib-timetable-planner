import { assertNoQueryErrors, type SupabaseClient } from "@/shared/api";
import { groupBy } from "@/shared/lib/collections";
import { withSupabase, type LoaderResult } from "@/shared/lib/result";
import type { TeacherRow } from "../model/teacher";

export type TeacherCatalogData = {
  teachers: TeacherRow[];
};

export type TeacherCatalogResult = LoaderResult<TeacherCatalogData>;

/** Load one plan's teachers catalog for the page island. Unavailable when the client is null. */
export const loadTeacherCatalog = (supabase: SupabaseClient | null, planId: string): Promise<TeacherCatalogResult> =>
  withSupabase(supabase, (client) => fetchTeacherCatalog(client, planId));

const fetchTeacherCatalog = async (client: SupabaseClient, planId: string): Promise<TeacherCatalogData> => {
  const [teachersRes, assignmentsRes, availabilityRes] = await Promise.all([
    client
      .from("teachers")
      .select("id, code, full_name")
      .eq("plan_id", planId)
      .order("full_name", { nullsFirst: false })
      .order("code")
      .limit(500),
    // Reverse-lookup from the course_teachers junction (the single source of a course's
    // teacher set), embedding each linked course — replaces the legacy `courses.teacher_id`.
    client
      .from("course_teachers")
      .select("teacher_id, course:courses(id, cohort, name, level, group_index, hours_per_week)")
      .eq("plan_id", planId)
      .limit(2000),
    client.from("teacher_availability").select("teacher_id, day, period, severity").eq("plan_id", planId).limit(5000),
  ]);
  assertNoQueryErrors("Teacher catalog", [teachersRes, assignmentsRes, availabilityRes]);

  const assignmentsByTeacher = groupBy(assignmentsRes.data ?? [], (row) => row.teacher_id);
  const availabilityByTeacher = groupBy(availabilityRes.data ?? [], (cell) => cell.teacher_id);

  const teachers: TeacherRow[] = (teachersRes.data ?? []).map((teacher) => ({
    id: teacher.id,
    code: teacher.code,
    fullName: teacher.full_name,
    assignments: (assignmentsByTeacher.get(teacher.id) ?? []).map(({ course }) => ({
      id: course.id,
      cohort: course.cohort,
      name: course.name,
      level: course.level,
      groupIndex: course.group_index,
      hours: course.hours_per_week,
    })),
    availability: (availabilityByTeacher.get(teacher.id) ?? []).map((cell) => ({
      day: cell.day,
      period: cell.period,
      severity: cell.severity,
    })),
  }));

  return { teachers };
};
