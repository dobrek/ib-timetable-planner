import { unwrapMany, type SupabaseClient } from "@/shared/api";
import { COHORT_VALUES, type Cohort } from "@/shared/config";
import { analyzePlan, verifyGeneration, type Distribution, type MirroredCell } from "@/entities/timetable";
import { cleanDiff, diffCatalogs, type CatalogDiff } from "../model/catalog-diff";
import { computeCatalogFingerprint } from "../model/catalog-fingerprint";
import { driftTier, type DriftTier } from "../model/drift-tier";
import {
  buildCohortSection,
  buildPlanSection,
  baselineOf,
  type AnalyzedPlan,
  type ScoreboardSection,
} from "../model/deltas";
import { BOARD_WIDE, COHORT_SCOREBOARD, CROSS_COHORT, goldenCensusRows } from "../model/metric-catalog";
import {
  completenessAnnotations,
  resolveExtremes,
  type CompletenessAnnotation,
  type ResolvedExtremes,
} from "../model/annotations";
import { distributionLine, num, subjectLabel } from "../model/format";
import { loadPlanAnalysis, type LoadedPlan, type PlanWarning } from "./load-plan-analysis";

/**
 * The comparison page's ONE SSR load. Everything it returns is plain serializable data (arrays and
 * records, no `Map`s), because it crosses the island boundary — the read-only plan-view precedent.
 *
 * **Per-plan error isolation is the whole design of this function.** `Promise.all` would be wrong:
 * `loadPlanAnalysis` throws on a missing plan (its signature is pinned, so `bench/` keeps working), an
 * uncaught throw in Astro frontmatter is a 500, and `Promise.all` is all-or-nothing — so ONE deleted
 * plan id would take down the page including the plans that loaded fine. This URL is explicitly built
 * to be shared and bookmarked, and plans are deletable, so a stale link is the ordinary case, not an
 * edge case. Each load is therefore settled independently and the failures are *named* in the UI.
 */
export const loadComparison = async (
  supabase: SupabaseClient,
  planIds: string[],
  requestedBaselineId: string | null,
): Promise<ComparisonLoad> => {
  const settled = await Promise.allSettled(planIds.map((id) => loadPlanAnalysis(supabase, id)));

  const plans = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const missingPlanIds = settled.flatMap((result, index) => (result.status === "rejected" ? [planIds[index]] : []));

  if (plans.length === 0) return { data: null, missingPlanIds };

  return { data: await buildComparisonData(plans, requestedBaselineId, missingPlanIds), missingPlanIds };
};

export type ComparisonLoad = {
  /** `null` only when NOT ONE plan loaded — the route 404s on that. One survivor is still a page. */
  data: PlanComparisonData | null;
  missingPlanIds: string[];
};

/**
 * Every plan the picker can offer. No ownership filter: no `author_id` column exists and every policy
 * on `plans` is `for all to authenticated using (true)`, so every authenticated author reads every plan.
 *
 * A slice-local query rather than a reach into `plans-list/api` — that would be a same-layer cross-slice
 * `_pages` import, which steiger forbids.
 */
export const loadPlanOptions = async (supabase: SupabaseClient): Promise<PlanOption[]> =>
  unwrapMany(await supabase.from("plans").select("id, name").order("name").limit(200), "Failed to load the plan list");

export type PlanOption = { id: string; name: string };

/** Pure assembly, exported so tests can drive it from fixture plans without a database. */
export const buildComparisonData = async (
  plans: LoadedPlan[],
  requestedBaselineId: string | null,
  missingPlanIds: string[] = [],
): Promise<PlanComparisonData> => {
  const analyzed: AnalyzedPlan[] = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    features: analyzePlan(plan.input),
  }));
  const baseline = baselineOf(analyzed, requestedBaselineId ?? "");
  // Deltas are baseline-relative, so a silently-missing baseline would render a whole scoreboard of
  // meaningless numbers. Fall back to a plan that loaded — and say so.
  const baselineFellBack = requestedBaselineId !== null && requestedBaselineId !== baseline.id;
  const byId = new Map(plans.map((plan) => [plan.id, plan]));

  return {
    plans: analyzed.map((plan) => ({ id: plan.id, name: plan.name })),
    baselineId: baseline.id,
    baselineFellBack,
    missingPlanIds,
    sections: [
      buildCohortSection("Cohort scoreboard", COHORT_SCOREBOARD, analyzed, baseline.id),
      buildCohortSection(
        "Golden slots (whole-cohort coverage)",
        goldenCensusRows(baseline.features, COHORT_VALUES[0]),
        analyzed,
        baseline.id,
      ),
      buildPlanSection("Board-wide (both cohorts)", BOARD_WIDE, analyzed, baseline.id),
      buildPlanSection("Cross-cohort weave", CROSS_COHORT, analyzed, baseline.id),
    ],
    annotations: analyzed.flatMap((plan) => {
      const loadedPlan = byId.get(plan.id);
      return loadedPlan ? completenessAnnotations(loadedPlan, plan.features) : [];
    }),
    perPlan: analyzed.map((plan) => toPlanDetail(byId.get(plan.id), plan)),
    drift: await Promise.all(
      analyzed
        .filter((plan) => plan.id !== baseline.id)
        .map((plan) => toDriftReport(byId.get(baseline.id), byId.get(plan.id), plan.name)),
    ),
  };
};

export type PlanComparisonData = {
  plans: { id: string; name: string }[];
  baselineId: string;
  /** True when the requested baseline could not be loaded and a survivor took its place. */
  baselineFellBack: boolean;
  missingPlanIds: string[];
  sections: ScoreboardSection[];
  /** The invariant annotations — a slot count is never readable without these beside it. */
  annotations: CompletenessAnnotation[];
  perPlan: PlanDetail[];
  /** One entry per non-baseline plan. Empty when only the baseline loaded. */
  drift: DriftReport[];
};

/** Everything rendered *per plan* rather than per column: the rule verdict, the catalog warnings, the
 *  resolved extremes, and the three free-form blocks the bench prints per plan. */
export type PlanDetail = {
  planId: string;
  planName: string;
  verdict: { ok: boolean; softWarnCount: number; reasons: string[] };
  warnings: PlanWarning[];
  extremes: ResolvedExtremes;
  /** Pre-formatted distribution lines — "the signal totals hide". */
  distributions: string[];
  mirroredCells: MirroredCellLine[];
  /** Mean period per subject — the expert's heaviness-labeling input. */
  gradient: { subject: string; meanPeriod: string }[];
};

export type MirroredCellLine = { day: number; period: number; label: string };

export type DriftReport = {
  planId: string;
  planName: string;
  tier: DriftTier;
  diff: CatalogDiff;
};

const toPlanDetail = (loaded: LoadedPlan | undefined, analyzed: AnalyzedPlan): PlanDetail => {
  // Every analyzed plan came from a loaded one; the map lookup is a type-narrowing formality.
  if (!loaded) throw new Error(`Analyzed plan ${analyzed.id} has no loaded counterpart`);
  const verdict = verifyGeneration(loaded.snapshot, loaded.board);

  return {
    planId: analyzed.id,
    planName: analyzed.name,
    verdict: { ok: verdict.ok, softWarnCount: verdict.softWarnCount, reasons: verdict.reasons },
    // Catalog anomalies are part of the product, not diagnostics: an unflagged `zero-hours` course
    // reads as a complete one. They render beside the numbers.
    warnings: loaded.warnings,
    extremes: resolveExtremes(analyzed.features, loaded.naturalKeys),
    distributions: distributionLines(analyzed),
    mirroredCells: analyzed.features.crossCohort.mirroredCells.map(toMirroredLine),
    gradient: analyzed.features.subjects.map((subject) => ({
      subject: subject.subject,
      meanPeriod: num(subject.meanPeriod),
    })),
  };
};

const distributionLines = ({ features }: AnalyzedPlan): string[] => [
  distributionLine("teacher gaps", features.teachers.gapsPerTeacher),
  distributionLine("teacher day span", features.teachers.daySpan),
  ...COHORT_VALUES.flatMap((cohort: Cohort) => {
    const { students } = features.cohorts[cohort];
    return [
      distributionLine(`${cohort} student gaps`, students.gapsPerStudent),
      distributionLine(`${cohort} span efficiency`, students.spanEfficiency),
      distributionLine(`${cohort} late finishes`, students.lateFinishes),
    ] satisfies string[];
  }),
];

const toMirroredLine = (cell: MirroredCell): MirroredCellLine => ({
  day: cell.day,
  period: cell.period,
  label: subjectLabel(cell.name, cell.level),
});

/**
 * The fingerprint is the fast path — equal digests mean a clean comparison and the diff never runs.
 * Only when they differ do we pay for the structured diff that lets the banner NAME the drift.
 */
const toDriftReport = async (
  baseline: LoadedPlan | undefined,
  other: LoadedPlan | undefined,
  planName: string,
): Promise<DriftReport> => {
  if (!baseline || !other) throw new Error("Drift report needs both a baseline and a comparand");

  const [baselineDigest, otherDigest] = await Promise.all([
    computeCatalogFingerprint(baseline),
    computeCatalogFingerprint(other),
  ]);

  // Equal digests mean equal catalogs, so there is nothing for the diff to find — skip the fold.
  if (baselineDigest === otherDigest) {
    return { planId: other.id, planName, tier: "clean", diff: cleanDiff(baseline, other) };
  }

  const diff = diffCatalogs(baseline, other);
  return { planId: other.id, planName, tier: driftTier(diff), diff };
};

/** Re-exported so the island can name the distribution shape without importing the entity barrel. */
export type { Distribution };
