import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PlannerBoardProps, PlannerGrouping, PlannerPlacement } from "@/components/planner/types";
import { loadCohortCourses } from "@/lib/grouping/adapters/supabase";
import { parseGridPreset } from "@/lib/planner/grid";

type Supabase = SupabaseClient<Database>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlannerPageResult =
  | { kind: "ok"; planName: string; props: PlannerBoardProps }
  | { kind: "not-found" }
  | { kind: "unavailable"; message: string };

/**
 * Assemble everything the planner island needs for one plan: the grid dimensions,
 * the Year-1 cohort, the single variant, the palette hints, persisted placements, and
 * the validation catalog. Returns a discriminated result so the page can set the right
 * HTTP status without top-level `return`s in Astro frontmatter (which trips a
 * type-checked-lint bug). Genuine DB failures throw and surface as a 500.
 */
export const loadPlannerData = async (supabase: Supabase, id: string | undefined): Promise<PlannerPageResult> => {
  if (!id || !UUID_RE.test(id)) return { kind: "not-found" };

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id, name, slot_grid_preset")
    .eq("id", id)
    .maybeSingle();
  if (planError) throw new Error(`Plan lookup failed: ${planError.message}`);
  if (!plan) return { kind: "not-found" };

  // S-01 is single-cohort: the Year-1 cohort (sorts before Year-2 by name).
  const { data: cohort, error: cohortError } = await supabase
    .from("cohorts")
    .select("id")
    .order("name")
    .limit(1)
    .maybeSingle();
  if (cohortError) throw new Error(`Cohort lookup failed: ${cohortError.message}`);
  if (!cohort) return { kind: "unavailable", message: "No cohort configured" };

  // The single seeded variant for this plan.
  const { data: variant, error: variantError } = await supabase
    .from("plan_variants")
    .select("id")
    .eq("plan_id", id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (variantError) throw new Error(`Variant lookup failed: ${variantError.message}`);
  if (!variant) return { kind: "unavailable", message: "Plan has no variant" };

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
  if (groupingsResult.error) throw new Error(`Groupings lookup failed: ${groupingsResult.error.message}`);
  if (placementsResult.error) throw new Error(`Placements lookup failed: ${placementsResult.error.message}`);

  const groupings: PlannerGrouping[] = groupingsResult.data.map((row) => ({
    id: row.id,
    coverageCount: row.coverage_count,
    score: row.score,
    memberIds: row.course_grouping_members.map((member) => member.course_id),
  }));

  const placements: PlannerPlacement[] = placementsResult.data.map((row) => ({
    id: row.id,
    courseId: row.course_id,
    day: row.day,
    period: row.period,
  }));

  return {
    kind: "ok",
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
  };
};
