import { COHORT_VALUES, type Cohort } from "@/shared/config";
import type { PlanQualityFeatures } from "@/entities/timetable";
import type { PlanNaturalKeys } from "../api/load-plan-analysis";
import type { MetricCell } from "./extremes";
import type { CohortMetricRow, PlanMetricRow } from "./metric-catalog";

/**
 * The scoreboard: N plans as N (or 2N) columns of a shared metric matrix.
 *
 * **No baseline, and no deltas.** The measurements never needed one — `analyzePlan` has zero pairwise
 * coupling, so every number here is a property of one plan alone. Only a delta would need a reference,
 * and a delta needs a *direction*, not a privileged plan; calling one plan "the baseline" smuggles back
 * exactly the this-one-is-the-truth framing the analyzer exists to avoid (the weighted-scalar
 * tier-bleed lesson). So this is the form `bench/plan-report.ts` prints and the expert already read in
 * analyzer run #1: the columns side by side, and the reader does the judging.
 *
 * It reports; it never judges. No ranking, no composite, no better/worse — and no subtraction that
 * quietly implies a direction.
 */

export type ScoreboardColumn = {
  planId: string;
  planName: string;
  /** Present on the cohort-grain sections, absent on the board-wide ones. */
  cohort?: Cohort;
};

export type ScoreboardSection = {
  title: string;
  columns: ScoreboardColumn[];
  rows: ScoreboardRow[];
};

export type ScoreboardRow = {
  id: string;
  label: string;
  /** One formatted cell per column, index-aligned. Exactly what the bench would print — plus, on the
   *  two rows that name a person, a link to that person's timetable. */
  cells: MetricCell[];
};

export type AnalyzedPlan = {
  id: string;
  name: string;
  features: PlanQualityFeatures;
  /** The analyzer speaks in ids; these turn a worst-case key into a name and a link. */
  naturalKeys: PlanNaturalKeys;
};

/** Cohort-grain section: N plans × 2 cohorts = 2N columns. */
export const buildCohortSection = (
  title: string,
  rows: CohortMetricRow[],
  plans: AnalyzedPlan[],
): ScoreboardSection => {
  const cells = plans.flatMap((plan) => COHORT_VALUES.map((cohort) => ({ plan, cohort })));

  return {
    title,
    columns: cells.map(({ plan, cohort }) => ({ planId: plan.id, planName: plan.name, cohort })),
    rows: rows.map((row) => ({
      id: row.id,
      label: row.label,
      cells: cells.map(({ plan, cohort }) => row.read(plan.features, cohort)),
    })),
  };
};

/** Plan-grain section: N plans = N columns. */
export const buildPlanSection = (title: string, rows: PlanMetricRow[], plans: AnalyzedPlan[]): ScoreboardSection => ({
  title,
  columns: plans.map((plan) => ({ planId: plan.id, planName: plan.name })),
  rows: rows.map((row) => ({
    id: row.id,
    label: row.label,
    cells: plans.map((plan) => row.read(plan.features, { planId: plan.id, naturalKeys: plan.naturalKeys })),
  })),
});
