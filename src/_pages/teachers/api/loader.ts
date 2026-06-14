import { assertNoQueryErrors, type SupabaseClient } from "@/shared/api";
import { groupBy } from "@/shared/lib/collections";
import { withSupabase, type LoaderResult } from "@/shared/lib/loaders";
import type { TeacherRow } from "../model/teacher";

export type TeacherCatalogData = {
  teachers: TeacherRow[];
};

export type TeacherCatalogResult = LoaderResult<TeacherCatalogData>;

/** Load one plan's teachers catalog for the page island. Unavailable when the client is null. */
export const loadTeacherCatalog = (supabase: SupabaseClient | null, planId: string): Promise<TeacherCatalogResult> =>
  withSupabase(supabase, (client) => fetchTeacherCatalog(client, planId));

const fetchTeacherCatalog = async (client: SupabaseClient, planId: string): Promise<TeacherCatalogData> => {
  const [teachersRes, coursesRes, availabilityRes] = await Promise.all([
    client
      .from("teachers")
      .select("id, code, full_name")
      .eq("plan_id", planId)
      .order("full_name", { nullsFirst: false })
      .order("code")
      .limit(500),
    client
      .from("courses")
      .select("id, cohort, name, level, group_index, hours_per_week, teacher_id")
      .eq("plan_id", planId)
      .not("teacher_id", "is", null)
      .order("name")
      .limit(500),
    client.from("teacher_availability").select("teacher_id, day, period, severity").eq("plan_id", planId).limit(5000),
  ]);
  assertNoQueryErrors("Teacher catalog", [teachersRes, coursesRes, availabilityRes]);

  const assignedCourses = (coursesRes.data ?? []).filter((course) => course.teacher_id !== null);
  const assignmentsByTeacher = groupBy(assignedCourses, (course) => course.teacher_id);
  const availabilityByTeacher = groupBy(availabilityRes.data ?? [], (cell) => cell.teacher_id);

  const teachers: TeacherRow[] = (teachersRes.data ?? []).map((teacher) => ({
    id: teacher.id,
    code: teacher.code,
    fullName: teacher.full_name,
    assignments: (assignmentsByTeacher.get(teacher.id) ?? []).map((course) => ({
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
