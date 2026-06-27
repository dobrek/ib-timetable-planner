import { loadCohortCourses, assertNoQueryErrors, unwrapMany, type SupabaseClient } from "@/shared/api";
import { siblingCohort, type Cohort } from "@/shared/config";
import { parseGridPreset } from "@/shared/lib/grid";
import { unique } from "@/shared/lib/collections";
import { err, ok, type Result } from "@/shared/lib/result";
import type { BoardAvailabilityCell } from "../model/availability-index";
import { assembleCombinedProps, type CombinedCohortInputs } from "../model/combined-props";
import { projectFromPlacements, type SiblingOccupancyCell } from "../model/cross-cohort-index";
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

  const groupings = mapGroupings(groupingsResult.data ?? []);

  const placements = mapPlacements(placementsResult.data ?? []);

  const availability = mapAvailability(availabilityResult.data ?? []);

  const crossCohortOccupancy = projectSiblingOccupancy(siblingPlacementsResult.data ?? [], siblingCatalog.courses);

  const parkedBundles = mapParkedBundles(shelfBundlesResult.data ?? []);

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

export type CombinedPlannerData = { planName: string; dp1: PlannerBoardProps; dp2: PlannerBoardProps };

export type CombinedPlannerPageResult = Result<CombinedPlannerData, PlannerPageError>;

/**
 * Symmetric loader for the combined two-cohort view (S-06): loads BOTH cohorts once as
 * fully-editable `PlannerBoardProps`, and builds each cohort's cross-cohort occupancy from the
 * *other* cohort's full placements + catalog — no redundant read-only sibling query (unlike
 * `loadPlannerData`, which ships a flat sibling snapshot). Display names resolve from the union of
 * both catalogs; availability is plan-scoped and shared; staleness is per cohort. The pure pairing
 * lives in `assembleCombinedProps`; this function is the thin IO + row-mapping shell. Reuses the
 * existing `not-found`/`unavailable` guards and `assertNoQueryErrors`.
 */
export const loadCombinedPlannerData = async (
  supabase: SupabaseClient | null,
  id: string | undefined,
): Promise<CombinedPlannerPageResult> => {
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

  const [
    dp1Groupings,
    dp1Placements,
    dp1Shelf,
    dp1Catalog,
    dp2Groupings,
    dp2Placements,
    dp2Shelf,
    dp2Catalog,
    availabilityResult,
  ] = await Promise.all([
    fetchGroupings(supabase, id, "dp1"),
    fetchPlacements(supabase, id, "dp1"),
    fetchShelfBundles(supabase, id, "dp1"),
    loadCohortCourses(supabase, id, "dp1"),
    fetchGroupings(supabase, id, "dp2"),
    fetchPlacements(supabase, id, "dp2"),
    fetchShelfBundles(supabase, id, "dp2"),
    loadCohortCourses(supabase, id, "dp2"),
    // Availability is cohort-independent — fetched once and shared by both columns.
    supabase.from("teacher_availability").select("teacher_id, day, period, severity").eq("plan_id", id),
  ]);
  assertNoQueryErrors("Combined planner board", [
    dp1Groupings,
    dp1Placements,
    dp1Shelf,
    dp2Groupings,
    dp2Placements,
    dp2Shelf,
    availabilityResult,
  ]);

  // Display names resolve from the UNION of both catalogs: a cross-cohort teacher clash names the
  // sibling cohort's teacher, and the shared dialog reads one name map.
  const allCourses = [...dp1Catalog.courses, ...dp2Catalog.courses];
  const [teacherNames, studentNames] = await Promise.all([
    fetchTeacherNames(supabase, unique(allCourses.flatMap((course) => course.teacherKeys))),
    fetchStudentNames(supabase, unique(allCourses.flatMap((course) => course.studentKeys))),
  ]);

  const availability = mapAvailability(availabilityResult.data ?? []);
  const dp1GroupingsMapped = mapGroupings(dp1Groupings.data ?? []);
  const dp2GroupingsMapped = mapGroupings(dp2Groupings.data ?? []);
  const [dp1Stale, dp2Stale] = await Promise.all([
    cohortStale(supabase, id, "dp1", dp1GroupingsMapped.length, dp1Catalog.courses),
    cohortStale(supabase, id, "dp2", dp2GroupingsMapped.length, dp2Catalog.courses),
  ]);

  const dp1Inputs: CombinedCohortInputs = {
    cohort: "dp1",
    groupings: dp1GroupingsMapped,
    placements: mapPlacements(dp1Placements.data ?? []),
    catalog: dp1Catalog.courses,
    names: Object.fromEntries(dp1Catalog.names),
    stale: dp1Stale,
    parkedBundles: mapParkedBundles(dp1Shelf.data ?? []),
  };
  const dp2Inputs: CombinedCohortInputs = {
    cohort: "dp2",
    groupings: dp2GroupingsMapped,
    placements: mapPlacements(dp2Placements.data ?? []),
    catalog: dp2Catalog.courses,
    names: Object.fromEntries(dp2Catalog.names),
    stale: dp2Stale,
    parkedBundles: mapParkedBundles(dp2Shelf.data ?? []),
  };

  const { dp1, dp2 } = assembleCombinedProps({
    planId: plan.id,
    days,
    periods,
    availability,
    teacherNames,
    studentNames,
    dp1: dp1Inputs,
    dp2: dp2Inputs,
  });

  return ok({ planName: plan.name, dp1, dp2 });
};

const fetchGroupings = (supabase: SupabaseClient, planId: string, cohort: Cohort) =>
  supabase
    .from("course_groupings")
    .select("id, coverage_count, score, opposite_week, course_grouping_members(course_id)")
    .eq("plan_id", planId)
    .eq("cohort", cohort);

const fetchPlacements = (supabase: SupabaseClient, planId: string, cohort: Cohort) =>
  supabase
    .from("placements")
    .select("id, course_id, day, period, week, bundle_id")
    .eq("plan_id", planId)
    .eq("cohort", cohort);

const fetchShelfBundles = (supabase: SupabaseClient, planId: string, cohort: Cohort) =>
  supabase
    .from("shelf_bundles")
    .select("id, shelf_bundle_courses(course_id, week)")
    .eq("plan_id", planId)
    .eq("cohort", cohort);

// Per-cohort palette staleness, guarded behind `groupingsCount > 0` (a plan with no groupings
// renders the empty state and stores no hash — it would read "stale" for nothing). Mirrors the
// single-cohort loader's guard.
const cohortStale = (
  supabase: SupabaseClient,
  planId: string,
  cohort: Cohort,
  groupingsCount: number,
  catalog: GroupingCourse[],
): Promise<boolean> =>
  groupingsCount > 0 ? isGroupingStale(supabase, { planId, cohort, catalog }) : Promise.resolve(false);

// Row → domain mappers, shared by both loaders so the snake_case→camelCase transform lives once.
const mapGroupings = (
  rows: {
    id: string;
    coverage_count: number;
    score: number;
    opposite_week: boolean;
    course_grouping_members: { course_id: string }[];
  }[],
): PlannerGrouping[] =>
  rows.map((row) => ({
    id: row.id,
    coverageCount: row.coverage_count,
    score: row.score,
    oppositeWeek: row.opposite_week,
    memberIds: row.course_grouping_members.map((member) => member.course_id),
  }));

const mapPlacements = (
  rows: {
    id: string;
    course_id: string;
    day: number;
    period: number;
    week: PlannerPlacement["week"];
    bundle_id: string;
  }[],
): PlannerPlacement[] =>
  rows.map((row) => ({
    id: row.id,
    courseId: row.course_id,
    day: row.day,
    period: row.period,
    week: row.week,
    bundleId: row.bundle_id,
  }));

const mapAvailability = (
  rows: { teacher_id: string; day: number; period: number; severity: BoardAvailabilityCell["severity"] }[],
): BoardAvailabilityCell[] =>
  rows.map((row) => ({ teacherKey: row.teacher_id, day: row.day, period: row.period, severity: row.severity }));

const mapParkedBundles = (
  rows: { id: string; shelf_bundle_courses: { course_id: string; week: PlannerPlacement["week"] }[] }[],
): ParkedBundle[] =>
  rows.map((row) => ({
    id: row.id,
    members: row.shelf_bundle_courses.map((member) => ({ courseId: member.course_id, week: member.week })),
  }));

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
): SiblingOccupancyCell[] =>
  projectFromPlacements(
    placements.map((row) => ({ courseId: row.course_id, day: row.day, period: row.period, week: row.week })),
    new Map(siblingCourses.map((course) => [course.id, course.teacherKeys])),
  );

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
