import { loadCohortCourses, assertNoQueryErrors, unwrapMany, type SupabaseClient } from "@/shared/api";
import { siblingCohort, type Cohort } from "@/shared/config";
import { parseGridPreset } from "@/shared/lib/grid";
import { unique } from "@/shared/lib/collections";
import { err, ok, type Result } from "@/shared/lib/result";
import type { BoardAvailabilityCell } from "../model/availability-index";
import type { SiblingOccupancyCell } from "../model/cross-cohort-index";
import type { PlannerBoardProps } from "../model/drag";
import type { GroupingCourse, PlannerGrouping } from "../model/grouping";
import type { ParkedBundle } from "../model/parked";
import type { PlannerPlacement } from "../model/placement";
import { isGroupingStale } from "./staleness";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlannerData = { planName: string; props: PlannerBoardProps };

/** Expected absences: a missing plan vs. a misconfigured/empty environment. */
export type PlannerPageError = { kind: "not-found" } | { kind: "unavailable"; message: string };

export type PlannerPageResult = Result<PlannerData, PlannerPageError>;

/**
 * Assemble everything the planner island needs for one plan: the grid dimensions,
 * the active cohort, the palette hints, persisted placements, and the validation
 * catalog. The sibling cohort (`siblingCohort(cohort)`) is projected into the
 * cross-cohort occupancy index. Returns a `Result` so the page can set the right HTTP status without
 * top-level `return`s in Astro frontmatter (which trips a type-checked-lint bug).
 * Genuine DB failures throw and surface as a 500.
 */
export const loadPlannerData = async (
  supabase: SupabaseClient | null,
  id: string | undefined,
  cohort: Cohort,
): Promise<PlannerPageResult> => {
  if (!supabase) return err({ kind: "unavailable", message: "Supabase is not configured" });
  if (!id || !UUID_RE.test(id)) return err({ kind: "not-found" });

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id, name, slot_grid_preset")
    .eq("id", id)
    .maybeSingle();
  if (planError) throw new Error(`Plan lookup failed: ${planError.message}`);
  if (!plan) return err({ kind: "not-found" });

  const { days, periods } = parseGridPreset(plan.slot_grid_preset);

  const sibling = siblingCohort(cohort);

  const [
    groupingsResult,
    placementsResult,
    availabilityResult,
    siblingPlacementsResult,
    shelfBundlesResult,
    catalog,
    siblingCatalog,
  ] = await Promise.all([
    supabase
      .from("course_groupings")
      .select("id, coverage_count, score, opposite_week, course_grouping_members(course_id)")
      .eq("plan_id", id)
      .eq("cohort", cohort),
    supabase
      .from("placements")
      .select("id, course_id, day, period, week, bundle_id")
      .eq("plan_id", id)
      .eq("cohort", cohort),
    // Availability is cohort-independent — no cohort filter (S-09: it just works for dp2 later).
    supabase.from("teacher_availability").select("teacher_id, day, period, severity").eq("plan_id", id),
    // Sibling-cohort occupancy (read-only committed snapshot) for the cross-cohort teacher rule.
    supabase.from("placements").select("course_id, day, period, week").eq("plan_id", id).eq("cohort", sibling),
    // Parked (shelved) bundles for this cohort — the durable off-board set (S-07).
    supabase
      .from("shelf_bundles")
      .select("id, shelf_bundle_courses(course_id, week)")
      .eq("plan_id", id)
      .eq("cohort", cohort),
    loadCohortCourses(supabase, id, cohort),
    loadCohortCourses(supabase, id, sibling),
  ]);
  assertNoQueryErrors("Planner board", [
    groupingsResult,
    placementsResult,
    availabilityResult,
    siblingPlacementsResult,
    shelfBundlesResult,
  ]);

  const [teacherNames, studentNames] = await Promise.all([
    fetchTeacherNames(supabase, unique(catalog.courses.flatMap((course) => course.teacherKeys))),
    fetchStudentNames(supabase, unique(catalog.courses.flatMap((course) => course.studentKeys))),
  ]);

  const groupings: PlannerGrouping[] = (groupingsResult.data ?? []).map((row) => ({
    id: row.id,
    coverageCount: row.coverage_count,
    score: row.score,
    oppositeWeek: row.opposite_week,
    memberIds: row.course_grouping_members.map((member) => member.course_id),
  }));

  const placements: PlannerPlacement[] = (placementsResult.data ?? []).map((row) => ({
    id: row.id,
    courseId: row.course_id,
    day: row.day,
    period: row.period,
    week: row.week,
    bundleId: row.bundle_id,
  }));

  const availability: BoardAvailabilityCell[] = (availabilityResult.data ?? []).map((row) => ({
    teacherKey: row.teacher_id,
    day: row.day,
    period: row.period,
    severity: row.severity,
  }));

  const crossCohortOccupancy = projectSiblingOccupancy(siblingPlacementsResult.data ?? [], siblingCatalog.courses);

  const parkedBundles: ParkedBundle[] = (shelfBundlesResult.data ?? []).map((row) => ({
    id: row.id,
    members: row.shelf_bundle_courses.map((member) => ({ courseId: member.course_id, week: member.week })),
  }));

  // Per-cohort palette staleness: hash the catalog we already loaded against the stored
  // grouping hash. Sequential after the parallel load (it needs `catalog`), off the per-drop
  // budget, and guarded behind `groupings.length > 0` — a plan with no groupings renders the
  // empty state, so the stored hash is always null there (it would read "stale" for nothing).
  const stale =
    groupings.length > 0 ? await isGroupingStale(supabase, { planId: id, cohort, catalog: catalog.courses }) : false;

  return ok({
    planName: plan.name,
    props: {
      planId: plan.id,
      cohort,
      days,
      periods,
      groupings,
      stale,
      names: Object.fromEntries(catalog.names),
      teacherNames,
      studentNames,
      placements,
      catalog: catalog.courses,
      availability,
      crossCohortOccupancy,
      parkedBundles,
    },
  });
};

/**
 * Project the sibling cohort's committed placements into a co-teacher-expanded
 * `SiblingOccupancyCell[]` — one row per (teacher, cell, week). The board ships only this flat
 * index (not full sibling objects); the island rebuilds the `Map` via `buildCrossCohortIndex`.
 * A sibling placement whose course is absent from the sibling catalog is skipped (mirrors
 * `bucketByCell`'s defensive skip).
 */
const projectSiblingOccupancy = (
  placements: { course_id: string; day: number; period: number; week: PlannerPlacement["week"] }[],
  siblingCourses: GroupingCourse[],
): SiblingOccupancyCell[] => {
  const teachersByCourse = new Map(siblingCourses.map((course) => [course.id, course.teacherKeys]));
  return placements.flatMap((row) => {
    const teacherKeys = teachersByCourse.get(row.course_id);
    if (!teacherKeys) return []; // course not in the sibling catalog — cannot attribute, skip
    return teacherKeys.map((teacherKey) => ({
      teacherKey,
      day: row.day,
      period: row.period,
      week: row.week,
    }));
  });
};

const fetchTeacherNames = async (supabase: SupabaseClient, ids: string[]): Promise<Record<string, string>> => {
  if (ids.length === 0) return {};
  const rows = unwrapMany(
    await supabase.from("teachers").select("id, full_name, code").in("id", ids),
    "Failed to load teacher names",
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.full_name ?? row.code]));
};

const fetchStudentNames = async (supabase: SupabaseClient, ids: string[]): Promise<Record<string, string>> => {
  if (ids.length === 0) return {};
  const rows = unwrapMany(
    await supabase.from("students").select("id, full_name").in("id", ids),
    "Failed to load student names",
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.full_name]));
};
