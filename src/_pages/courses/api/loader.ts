import type { SupabaseClient } from "@/shared/api";
import type { CohortTab, CourseRow } from "../model/course";
import type { TeacherOption } from "@/entities/teacher";

export type CatalogData = {
  cohorts: CohortTab[];
  courses: CourseRow[];
  teachers: TeacherOption[];
};

export type CatalogResult = { kind: "ok"; data: CatalogData } | { kind: "unavailable" };

// Cohort order is naive (alphabetical name → first = Year 1). Stable for the two seed
// names; the future cohort-CRUD slice replaces it with an explicit ordinal (see plan).
const cohortLabel = (index: number) => `Year ${index + 1}`;

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

  for (const res of [cohortsRes, coursesRes, teachersRes, mergesRes, overlapsRes]) {
    if (res.error) throw new Error(`Catalog lookup failed: ${res.error.message}`);
  }

  const teacherLabel = new Map((teachersRes.data ?? []).map((t) => [t.id, t.full_name ?? t.code] as const));

  // Only the composite merge *parent* (the virtual combined session, e.g. "German B AB+SL")
  // carries the "Merged" badge. Its atomic children (German B AB, German B SL) are plain courses.
  const mergeParentIds = new Set<string>();
  // parent course id → its child course ids (so the manage dialog can list them).
  const childIdsByParent = new Map<string, string[]>();
  for (const m of mergesRes.data ?? []) {
    mergeParentIds.add(m.parent_course_id);
    const children = childIdsByParent.get(m.parent_course_id) ?? [];
    children.push(m.child_course_id);
    childIdsByParent.set(m.parent_course_id, children);
  }

  // dependent course id → its base-course ids (this course's students also attend those bases).
  const overlapsByDependent = new Map<string, string[]>();
  for (const o of overlapsRes.data ?? []) {
    const bases = overlapsByDependent.get(o.dependent_course_id) ?? [];
    bases.push(o.base_course_id);
    overlapsByDependent.set(o.dependent_course_id, bases);
  }

  return {
    cohorts: (cohortsRes.data ?? []).map((c, index) => ({ id: c.id, label: cohortLabel(index) })),
    courses: (coursesRes.data ?? []).map((c) => ({
      id: c.id,
      cohortId: c.cohort_id,
      name: c.name,
      level: c.level,
      groupIndex: c.group_index,
      hours: c.hours_per_week,
      teacherId: c.teacher_id,
      teacherLabel: c.teacher_id ? (teacherLabel.get(c.teacher_id) ?? null) : null,
      isMerged: mergeParentIds.has(c.id),
      mergeChildIds: childIdsByParent.get(c.id) ?? [],
      overlaps: overlapsByDependent.get(c.id) ?? [],
    })),
    teachers: (teachersRes.data ?? []).map((t) => ({ id: t.id, label: t.full_name ?? t.code })),
  };
};

/** Load the courses catalog for the page island. Returns unavailable when client is null. */
export const loadCatalog = async (supabase: SupabaseClient | null): Promise<CatalogResult> => {
  if (!supabase) return { kind: "unavailable" };
  return { kind: "ok", data: await fetchCatalog(supabase) };
};
