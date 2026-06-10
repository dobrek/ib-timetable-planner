import type { SupabaseClient } from "@/shared/api";
import { assertNoQueryErrors } from "@/shared/lib/loaders";
import { err, ok, type Result } from "@/shared/lib/result";
import type { PlannerBoardProps } from "../model/drag";
import { parseGridPreset } from "../model/grid";
import type { PlannerGrouping } from "../model/grouping";
import type { PlannerPlacement } from "../model/placement";
import { loadCohortCourses } from "./load-cohort-catalog";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlannerData = { planName: string; props: PlannerBoardProps };

/** Expected absences: a missing plan vs. a misconfigured/empty environment. */
export type PlannerPageError = { kind: "not-found" } | { kind: "unavailable"; message: string };

export type PlannerPageResult = Result<PlannerData, PlannerPageError>;

/**
 * Assemble everything the planner island needs for one plan: the grid dimensions,
 * the Year-1 cohort, the single variant, the palette hints, persisted placements, and
 * the validation catalog. Returns a `Result` so the page can set the right HTTP status
 * without top-level `return`s in Astro frontmatter (which trips a type-checked-lint
 * bug). Genuine DB failures throw and surface as a 500.
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

  // S-01 is single-cohort: the Year-1 cohort (sorts before Year-2 by name).
  const { data: cohort, error: cohortError } = await supabase
    .from("cohorts")
    .select("id")
    .order("name")
    .limit(1)
    .maybeSingle();
  if (cohortError) throw new Error(`Cohort lookup failed: ${cohortError.message}`);
  if (!cohort) return err({ kind: "unavailable", message: "No cohort configured" });

  // The single seeded variant for this plan.
  const { data: variant, error: variantError } = await supabase
    .from("plan_variants")
    .select("id")
    .eq("plan_id", id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (variantError) throw new Error(`Variant lookup failed: ${variantError.message}`);
  if (!variant) return err({ kind: "unavailable", message: "Plan has no variant" });

  const { days, periods } = parseGridPreset(plan.slot_grid_preset);

  const [groupingsResult, placementsResult, catalog] = await Promise.all([
    supabase
      .from("course_groupings")
      .select("id, coverage_count, score, course_grouping_members(course_id)")
      .eq("plan_id", id)
      .eq("cohort_id", cohort.id),
    supabase
      .from("placements")
      .select("id, course_id, day, period")
      .eq("variant_id", variant.id)
      .eq("cohort_id", cohort.id),
    loadCohortCourses(supabase, cohort.id),
  ]);
  assertNoQueryErrors("Planner board", [groupingsResult, placementsResult]);

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

  return ok({
    planName: plan.name,
    props: {
      planId: plan.id,
      variantId: variant.id,
      cohortId: cohort.id,
      days,
      periods,
      groupings,
      names: Object.fromEntries(catalog.names),
      placements,
      catalog: catalog.courses,
    },
  });
};
