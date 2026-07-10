import {
  assertNoQueryErrors,
  isUuid,
  loadCohortCourses,
  loadCourseMerges,
  loadPlacements,
  loadPlanTeachers,
  loadStudentNames,
  loadTeacherAvailability,
  loadTeacherNames,
  unwrapMany,
  type SupabaseClient,
} from "@/shared/api";
import { type Cohort } from "@/shared/config";
import { parseGridPreset } from "@/shared/lib/grid";
import { unique } from "@/shared/lib/collections";
import { err, ok, type Result } from "@/shared/lib/result";
import { toPlannerPlacement, type BoardAvailabilityCell, type PlannerPlacement } from "@/entities/timetable";
import { assembleCombinedProps, type CombinedCohortInputs } from "../model/cross-cohort/assemble-combined-props";
import type { BatchExportSources } from "../lib/batch-export-workbooks";
import type { PlannerBoardProps, SharedBoardProps } from "../model/drag";
import type { GroupingCourse, PlannerGrouping } from "../model/grouping/grouping";
import type { ParkedBundle } from "../model/placement/parked";
import { isGroupingStale } from "./staleness";

/** Expected absences: a missing plan vs. a misconfigured/empty environment. */
export type PlannerPageError = { kind: "not-found" } | { kind: "unavailable"; message: string };

export type CombinedPlannerData = {
  planName: string;
  shared: SharedBoardProps;
  dp1: PlannerBoardProps;
  dp2: PlannerBoardProps;
  /** Extra sources the board's batch xlsx export needs (teachers with codes, merges, course levels). */
  batchExport: BatchExportSources;
};

export type CombinedPlannerPageResult = Result<CombinedPlannerData, PlannerPageError>;

/**
 * The ONE plan-detail loader: loads BOTH cohorts once as fully-editable `PlannerBoardProps`, and
 * builds each cohort's cross-cohort occupancy from the *other* cohort's full placements + catalog.
 * Every `?focus=` surface (dp1 / dp2 / combined) renders from this one result — focus mode just shows
 * one column of an always-both load (an SSR-only, parallelized cost; zero per-drag cost). Display
 * names resolve from the union of both catalogs; availability is plan-scoped and shared; staleness is
 * per cohort. The pure pairing lives in `assembleCombinedProps`; this is the thin IO + row-mapping
 * shell. Returns a `Result` so the page sets the right HTTP status without top-level `return`s in
 * Astro frontmatter. Genuine DB failures throw and surface as a 500.
 */
export const loadCombinedPlannerData = async (
  supabase: SupabaseClient | null,
  id: string | undefined,
): Promise<CombinedPlannerPageResult> => {
  if (!supabase) return err({ kind: "unavailable", message: "Supabase is not configured" });
  if (!isUuid(id)) return err({ kind: "not-found" });

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
    planTeachers,
    courseMerges,
    courseLevels,
  ] = await Promise.all([
    fetchGroupings(supabase, id, "dp1"),
    loadPlacements(supabase, id, "dp1"),
    fetchShelfBundles(supabase, id, "dp1"),
    loadCohortCourses(supabase, id, "dp1"),
    fetchGroupings(supabase, id, "dp2"),
    loadPlacements(supabase, id, "dp2"),
    fetchShelfBundles(supabase, id, "dp2"),
    loadCohortCourses(supabase, id, "dp2"),
    // Availability is cohort-independent — fetched once and shared by both columns.
    loadTeacherAvailability(supabase, id),
    // Batch-export sources (unused by the board itself, threaded to `ExportMenu`): teachers with codes,
    // merges (composite→children resolution), and course levels. All `unwrapMany`-based (throw on error),
    // so they sit outside `assertNoQueryErrors` — same as the catalogs.
    loadPlanTeachers(supabase, id),
    loadCourseMerges(supabase, id),
    fetchCourseLevels(supabase, id),
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

  // Teacher display names resolve from the UNION of both catalogs: a cross-cohort clash names the
  // sibling cohort's teacher. Student names stay per cohort — enrollments are cohort-scoped.
  const allCourses = [...dp1Catalog.courses, ...dp2Catalog.courses];
  const [teacherNames, dp1StudentNames, dp2StudentNames] = await Promise.all([
    loadTeacherNames(supabase, unique(allCourses.flatMap((course) => course.teacherKeys))),
    loadStudentNames(supabase, unique(dp1Catalog.courses.flatMap((course) => course.studentKeys))),
    loadStudentNames(supabase, unique(dp2Catalog.courses.flatMap((course) => course.studentKeys))),
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
    placements: (dp1Placements.data ?? []).map(toPlannerPlacement),
    catalog: dp1Catalog.courses,
    courseDisplay: Object.fromEntries(dp1Catalog.courseDisplay),
    studentNames: dp1StudentNames,
    stale: dp1Stale,
    parkedBundles: mapParkedBundles(dp1Shelf.data ?? []),
  };
  const dp2Inputs: CombinedCohortInputs = {
    cohort: "dp2",
    groupings: dp2GroupingsMapped,
    placements: (dp2Placements.data ?? []).map(toPlannerPlacement),
    catalog: dp2Catalog.courses,
    courseDisplay: Object.fromEntries(dp2Catalog.courseDisplay),
    studentNames: dp2StudentNames,
    stale: dp2Stale,
    parkedBundles: mapParkedBundles(dp2Shelf.data ?? []),
  };

  const { dp1, dp2 } = assembleCombinedProps({ dp1: dp1Inputs, dp2: dp2Inputs });

  const shared: SharedBoardProps = {
    planId: plan.id,
    days,
    periods,
    availability,
    teacherNames,
  };

  const batchExport: BatchExportSources = { teachers: planTeachers, merges: courseMerges, courseLevels };

  return ok({ planName: plan.name, shared, dp1, dp2, batchExport });
};

// Slim `id, level` projection of the teacher view's `fetchCourseInfo` — the per-course sheet headers in
// the batch's perspective workbooks need `courseId → level`, nothing else. `.limit(2000)` matches it.
const fetchCourseLevels = async (supabase: SupabaseClient, planId: string): Promise<Record<string, string>> => {
  const rows = unwrapMany(
    await supabase.from("courses").select("id, level").eq("plan_id", planId).limit(2000),
    "Failed to load course levels",
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.level] as const));
};

const fetchGroupings = (supabase: SupabaseClient, planId: string, cohort: Cohort) =>
  supabase
    .from("course_groupings")
    .select("id, coverage_count, score, opposite_week, course_grouping_members(course_id)")
    .eq("plan_id", planId)
    .eq("cohort", cohort);

const fetchShelfBundles = (supabase: SupabaseClient, planId: string, cohort: Cohort) =>
  supabase
    .from("shelf_bundles")
    .select("id, shelf_bundle_courses(course_id, week, is_optional)")
    .eq("plan_id", planId)
    .eq("cohort", cohort);

// Per-cohort palette staleness, guarded behind `groupingsCount > 0` (a plan with no groupings
// renders the empty state and stores no hash — it would read "stale" for nothing).
const cohortStale = (
  supabase: SupabaseClient,
  planId: string,
  cohort: Cohort,
  groupingsCount: number,
  catalog: GroupingCourse[],
): Promise<boolean> =>
  groupingsCount > 0 ? isGroupingStale(supabase, { planId, cohort, catalog }) : Promise.resolve(false);

// Row → domain mappers for the snake_case→camelCase transform.
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

const mapAvailability = (
  rows: { teacher_id: string; day: number; period: number; severity: BoardAvailabilityCell["severity"] }[],
): BoardAvailabilityCell[] =>
  rows.map((row) => ({ teacherKey: row.teacher_id, day: row.day, period: row.period, severity: row.severity }));

const mapParkedBundles = (
  rows: {
    id: string;
    shelf_bundle_courses: { course_id: string; week: PlannerPlacement["week"]; is_optional: boolean }[];
  }[],
): ParkedBundle[] =>
  rows.map((row) => ({
    id: row.id,
    members: row.shelf_bundle_courses.map((member) => ({
      courseId: member.course_id,
      week: member.week,
      isOptional: member.is_optional,
    })),
  }));
