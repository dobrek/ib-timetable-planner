import { assertNoQueryErrors, type SupabaseClient } from "@/shared/api";
import { groupBy } from "@/shared/lib/collections";
import { withSupabase, type LoaderResult } from "@/shared/lib/result";
import type { CourseRow, TeacherOption } from "../model/course";

export type CatalogData = {
  courses: CourseRow[];
  teachers: TeacherOption[];
};

export type CatalogResult = LoaderResult<CatalogData>;

/** Load one plan's courses catalog for the page island. Unavailable when the client is null. */
export const loadCatalog = (supabase: SupabaseClient | null, planId: string): Promise<CatalogResult> =>
  withSupabase(supabase, (client) => fetchCatalog(client, planId));

const fetchCatalog = async (client: SupabaseClient, planId: string): Promise<CatalogData> => {
  const [coursesRes, teachersRes, mergesRes, overlapsRes] = await Promise.all([
    client
      .from("courses")
      .select("id, cohort, name, level, group_index, hours_per_week, teacher_id")
      .eq("plan_id", planId)
      .order("name")
      .limit(500),
    client.from("teachers").select("id, code, full_name").eq("plan_id", planId).order("code").limit(500),
    client.from("course_merges").select("parent_course_id, child_course_id").eq("plan_id", planId).limit(500),
    client.from("course_overlaps").select("base_course_id, dependent_course_id").eq("plan_id", planId).limit(500),
  ]);
  assertNoQueryErrors("Catalog", [coursesRes, teachersRes, mergesRes, overlapsRes]);

  const teacherLabel = new Map((teachersRes.data ?? []).map((t) => [t.id, teacherDisplayLabel(t)] as const));

  // Only the composite merge *parent* (the virtual combined session, e.g. "German B AB+SL")
  // carries the "Merged" badge. Its atomic children (German B AB, German B SL) are plain courses.
  const childLinksByParent = groupBy(mergesRes.data ?? [], (m) => m.parent_course_id);
  // dependent course id → its base-course links (this course's students also attend those bases).
  const overlapsByDependent = groupBy(overlapsRes.data ?? [], (o) => o.dependent_course_id);

  return {
    courses: (coursesRes.data ?? []).map((c) => ({
      id: c.id,
      cohort: c.cohort,
      name: c.name,
      level: c.level,
      groupIndex: c.group_index,
      hours: c.hours_per_week,
      teacherId: c.teacher_id,
      teacherLabel: c.teacher_id ? (teacherLabel.get(c.teacher_id) ?? null) : null,
      isMerged: childLinksByParent.has(c.id),
      mergeChildIds: (childLinksByParent.get(c.id) ?? []).map((m) => m.child_course_id),
      overlaps: (overlapsByDependent.get(c.id) ?? []).map((o) => o.base_course_id),
    })),
    teachers: (teachersRes.data ?? []).map((t) => ({ id: t.id, label: teacherDisplayLabel(t) })),
  };
};

const teacherDisplayLabel = (teacher: { code: string; full_name: string | null }): string =>
  teacher.full_name ?? teacher.code;
