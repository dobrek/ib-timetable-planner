import { toOrderedCohorts, type SupabaseClient } from "@/shared/api";
import { groupBy } from "@/shared/lib/collections";
import { assertNoQueryErrors, withSupabase, type LoaderResult } from "@/shared/lib/loaders";
import type { CohortTab, CourseRow, TeacherOption } from "../model/course";

export type CatalogData = {
  cohorts: CohortTab[];
  courses: CourseRow[];
  teachers: TeacherOption[];
};

export type CatalogResult = LoaderResult<CatalogData>;

/** Load the courses catalog for the page island. Unavailable when the client is null. */
export const loadCatalog = (supabase: SupabaseClient | null): Promise<CatalogResult> =>
  withSupabase(supabase, fetchCatalog);

const fetchCatalog = async (client: SupabaseClient): Promise<CatalogData> => {
  const [cohortsRes, coursesRes, teachersRes, mergesRes, overlapsRes] = await Promise.all([
    client.from("cohorts").select("id, name").order("name"),
    client
      .from("courses")
      .select("id, cohort_id, name, level, group_index, hours_per_week, teacher_id")
      .order("name")
      .limit(500),
    client.from("teachers").select("id, code, full_name").order("code").limit(500),
    client.from("course_merges").select("parent_course_id, child_course_id").limit(500),
    client.from("course_overlaps").select("base_course_id, dependent_course_id").limit(500),
  ]);
  assertNoQueryErrors("Catalog", [cohortsRes, coursesRes, teachersRes, mergesRes, overlapsRes]);

  const teacherLabel = new Map((teachersRes.data ?? []).map((t) => [t.id, teacherDisplayLabel(t)] as const));

  // Only the composite merge *parent* (the virtual combined session, e.g. "German B AB+SL")
  // carries the "Merged" badge. Its atomic children (German B AB, German B SL) are plain courses.
  const childLinksByParent = groupBy(mergesRes.data ?? [], (m) => m.parent_course_id);
  // dependent course id → its base-course links (this course's students also attend those bases).
  const overlapsByDependent = groupBy(overlapsRes.data ?? [], (o) => o.dependent_course_id);

  return {
    cohorts: toOrderedCohorts(cohortsRes.data ?? []),
    courses: (coursesRes.data ?? []).map((c) => ({
      id: c.id,
      cohortId: c.cohort_id,
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
