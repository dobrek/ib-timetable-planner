import { loadCohortCourses, assertNoQueryErrors, type SupabaseClient } from "@/shared/api";
import { type Cohort } from "@/shared/config";
import { parseGridPreset } from "@/shared/lib/grid";
import { unique } from "@/shared/lib/collections";
import { err, ok, type Result } from "@/shared/lib/result";
import type { BoardAvailabilityCell } from "../model/availability-index";
import type { PlannerBoardProps } from "../model/drag";
import type { PlannerGrouping } from "../model/grouping";
import type { PlannerPlacement } from "../model/placement";
import type { SlotOverride } from "../model/slot-bundle";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The board is single-cohort for now (S-01 scope): Year 1. Year 2 arrives with S-09. */
const BOARD_COHORT: Cohort = "dp1";

export type PlannerData = { planName: string; props: PlannerBoardProps };

/** Expected absences: a missing plan vs. a misconfigured/empty environment. */
export type PlannerPageError = { kind: "not-found" } | { kind: "unavailable"; message: string };

export type PlannerPageResult = Result<PlannerData, PlannerPageError>;

/**
 * Assemble everything the planner island needs for one plan: the grid dimensions,
 * the Year-1 cohort, the palette hints, persisted placements, and the validation
 * catalog. Returns a `Result` so the page can set the right HTTP status without
 * top-level `return`s in Astro frontmatter (which trips a type-checked-lint bug).
 * Genuine DB failures throw and surface as a 500.
 */
export const loadPlannerData = async (
  supabase: SupabaseClient | null,
  id: string | undefined,
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

  const [groupingsResult, placementsResult, overridesResult, availabilityResult, catalog] = await Promise.all([
    supabase
      .from("course_groupings")
      .select("id, coverage_count, score, course_grouping_members(course_id)")
      .eq("plan_id", id)
      .eq("cohort", BOARD_COHORT),
    supabase.from("placements").select("id, course_id, day, period").eq("plan_id", id).eq("cohort", BOARD_COHORT),
    supabase.from("slot_bundles").select("day, period").eq("plan_id", id).eq("cohort", BOARD_COHORT),
    // Availability is cohort-independent — no cohort filter (S-09: it just works for dp2 later).
    supabase.from("teacher_availability").select("teacher_id, day, period, severity").eq("plan_id", id),
    loadCohortCourses(supabase, id, BOARD_COHORT),
  ]);
  assertNoQueryErrors("Planner board", [groupingsResult, placementsResult, overridesResult, availabilityResult]);

  const [teacherNames, studentNames] = await Promise.all([
    fetchTeacherNames(
      supabase,
      unique(catalog.courses.map((course) => course.teacherKey).filter((key) => key !== null)),
    ),
    fetchStudentNames(supabase, unique(catalog.courses.flatMap((course) => course.studentKeys))),
  ]);

  const groupings: PlannerGrouping[] = (groupingsResult.data ?? []).map((row) => ({
    id: row.id,
    coverageCount: row.coverage_count,
    score: row.score,
    memberIds: row.course_grouping_members.map((member) => member.course_id),
  }));

  const placements: PlannerPlacement[] = (placementsResult.data ?? []).map((row) => ({
    id: row.id,
    courseId: row.course_id,
    day: row.day,
    period: row.period,
  }));

  const overrides: SlotOverride[] = (overridesResult.data ?? []).map((row) => ({
    day: row.day,
    period: row.period,
  }));

  const availability: BoardAvailabilityCell[] = (availabilityResult.data ?? []).map((row) => ({
    teacherKey: row.teacher_id,
    day: row.day,
    period: row.period,
    severity: row.severity,
  }));

  return ok({
    planName: plan.name,
    props: {
      planId: plan.id,
      cohort: BOARD_COHORT,
      days,
      periods,
      groupings,
      names: Object.fromEntries(catalog.names),
      teacherNames,
      studentNames,
      placements,
      overrides,
      catalog: catalog.courses,
      availability,
    },
  });
};

const fetchTeacherNames = async (supabase: SupabaseClient, ids: string[]): Promise<Record<string, string>> => {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from("teachers").select("id, full_name, code").in("id", ids);
  if (error) throw new Error(`Failed to load teacher names: ${error.message}`);
  return Object.fromEntries(data.map((row) => [row.id, row.full_name ?? row.code]));
};

const fetchStudentNames = async (supabase: SupabaseClient, ids: string[]): Promise<Record<string, string>> => {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from("students").select("id, full_name").in("id", ids);
  if (error) throw new Error(`Failed to load student names: ${error.message}`);
  return Object.fromEntries(data.map((row) => [row.id, row.full_name]));
};
