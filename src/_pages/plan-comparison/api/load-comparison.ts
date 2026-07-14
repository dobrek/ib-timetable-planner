import type { SupabaseClient } from "@/shared/api";
import { COHORT_VALUES, type Cohort } from "@/shared/config";
import { analyzePlan, verifyGeneration, type MirroredCell } from "@/entities/timetable";
import { computeCatalogFingerprint } from "../model/catalog-fingerprint";
import { driftTier, gridOf, sameGrid, type DriftTier, type GridShape } from "../model/drift-tier";
import { buildCohortSection, buildPlanSection, type AnalyzedPlan, type ScoreboardSection } from "../model/scoreboard";
import { BOARD_WIDE, COHORT_SCOREBOARD, CROSS_COHORT, goldenCensusRows } from "../model/metric-catalog";
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
export const loadComparison = async (supabase: SupabaseClient, planIds: string[]): Promise<ComparisonLoad> => {
  const settled = await Promise.allSettled(planIds.map((id) => loadPlanAnalysis(supabase, id)));

  const plans = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const missingPlanIds = settled.flatMap((result, index) => (result.status === "rejected" ? [planIds[index]] : []));

  if (plans.length === 0) return { data: null, missingPlanIds };

  return { data: await buildComparisonData(plans, missingPlanIds), missingPlanIds };
};

export type ComparisonLoad = {
  /** `null` only when NOT ONE plan loaded — the route 404s on that. One survivor is still a page. */
  data: PlanComparisonData | null;
  missingPlanIds: string[];
};

/** Pure assembly, exported so tests can drive it from fixture plans without a database. */
export const buildComparisonData = async (
  plans: LoadedPlan[],
  missingPlanIds: string[] = [],
): Promise<PlanComparisonData> => {
  const analyzed: AnalyzedPlan[] = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    features: analyzePlan(plan.input),
    naturalKeys: plan.naturalKeys,
  }));
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  // The first plan is a *reference for wording only* — "what differs from what" needs an order, and the
  // golden labels need a census to read the analyzer's own band settings off. It is not a baseline: no
  // number below is measured against it.
  const [reference, ...comparands] = analyzed;

  // ONE fingerprint per plan. Hashing inside `toDriftReport` would re-hash the reference — the same plan
  // every time — once per comparand: 2(N−1) digests where N does. The projection is the page's most
  // expensive pure step (it includes `choices`, which is O(students × courses)), so it is worth doing
  // exactly once each.
  const digests = new Map(
    await Promise.all(plans.map(async (plan) => [plan.id, await computeCatalogFingerprint(plan)] as const)),
  );

  return {
    plans: analyzed.map((plan) => ({ id: plan.id, name: plan.name })),
    missingPlanIds,
    sections: [
      buildCohortSection("Cohort scoreboard", COHORT_SCOREBOARD, analyzed),
      buildCohortSection(
        "Golden slots (whole-cohort coverage)",
        goldenCensusRows(reference.features, COHORT_VALUES[0]),
        analyzed,
      ),
      buildPlanSection("Board-wide (both cohorts)", BOARD_WIDE, analyzed),
      buildPlanSection("Cross-cohort weave", CROSS_COHORT, analyzed),
    ],
    perPlan: analyzed.map((plan) => toPlanDetail(byId.get(plan.id), plan)),
    drift: comparands.map((plan) =>
      toDriftReport(byId.get(reference.id), byId.get(plan.id), digests, plan.name, reference.name),
    ),
  };
};

export type PlanComparisonData = {
  /** The compared plans, in the order the URL named them. None is privileged. */
  plans: { id: string; name: string }[];
  missingPlanIds: string[];
  sections: ScoreboardSection[];
  perPlan: PlanDetail[];
  /** One entry per plan after the first. Empty when only one plan loaded — nothing to compare it to. */
  drift: DriftReport[];
};

/** Everything rendered *per plan* rather than per column: the rule verdict, the catalog warnings, and
 *  the free-form blocks the bench prints per plan. The worst-case extremes are NOT here — they are
 *  scoreboard rows, where they are named and linked, and repeating them was pure duplication. */
export type PlanDetail = {
  planId: string;
  planName: string;
  verdict: { ok: boolean; softWarnCount: number; reasons: string[] };
  warnings: PlanWarning[];
  /** Pre-formatted distribution lines — "the signal totals hide". */
  distributions: string[];
  mirroredCells: MirroredCellLine[];
  /** Mean period per subject — the expert's heaviness-labeling input. */
  gradient: { subject: string; meanPeriod: string }[];
};

export type MirroredCellLine = { day: number; period: number; label: string };

/** One comparand's catalog, set against the first-listed plan's — an ordering, not a judgement. */
export type DriftReport = {
  planId: string;
  planName: string;
  /** The plan this one is described *relative to* (the first in the selection). */
  referenceName: string;
  tier: DriftTier;
  /** Both board shapes, so the `incomparable` banner can name them. Carried even when they agree. */
  grid: { reference: GridShape; other: GridShape };
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
 * The whole drift verdict, from two digests and two grid shapes.
 *
 * The fingerprint is the entire catalog check: equal natural-key digests mean equal catalogs, and
 * unequal ones mean they differ. That is precisely what the banner reports, so nothing more is
 * computed — an earlier cut folded a full structured diff to print per-category counts, and the counts
 * turned out to be noise the reader could not act on (see `drift-tier.ts`).
 */
const toDriftReport = (
  reference: LoadedPlan | undefined,
  other: LoadedPlan | undefined,
  digests: Map<string, string>,
  planName: string,
  referenceName: string,
): DriftReport => {
  if (!reference || !other) throw new Error("Drift report needs both a reference and a comparand");

  const referenceDigest = digests.get(reference.id);
  const otherDigest = digests.get(other.id);
  // Explicitly, because the failure would be SILENT and would fail *open*: two absent digests are two
  // `undefined`s, which compare equal, which reads as `clean` — a missing fingerprint would render "the
  // catalogs match" over two plans nobody compared. The fingerprint is the whole drift detector; it does
  // not get to fail quietly.
  if (referenceDigest === undefined || otherDigest === undefined) {
    throw new Error("Drift report needs a catalog fingerprint for both plans");
  }

  const grid = { reference: gridOf(reference), other: gridOf(other) };
  const tier = driftTier({
    gridEqual: sameGrid(grid.reference, grid.other),
    catalogEqual: referenceDigest === otherDigest,
  });

  return { planId: other.id, planName, referenceName, tier, grid };
};
