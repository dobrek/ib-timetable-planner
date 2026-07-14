import { COHORT_VALUES, type Cohort } from "@/shared/config";
import type { PlanQualityFeatures } from "@/entities/timetable";
import type { CohortMetricRow, PlanMetricRow } from "./metric-catalog";
import { num } from "./format";

/**
 * Baseline-relative deltas.
 *
 * With two plans a delta column is unambiguous; with N, the natural generalization is one plan
 * designated the reference — the golden/expert plan, in the motivating use case — and the rest rendered
 * as delta-vs-baseline.
 *
 * **A signed delta and nothing more.** No ranking, no composite, no "better/worse" verdict, not even an
 * implied one: fewer teacher gaps is better and more golden cells is better, but this model must not
 * say so. Direction is the expert's call — that stance is the whole reason the analyzer emits a feature
 * vector rather than a score, and it has scar tissue behind it (the weighted-scalar tier-bleed bug).
 */

/** One rendered cell: the formatted value, plus a delta when the row is numeric and not the baseline's. */
export type MetricCell = {
  /** The formatted value, exactly as the bench would print it. */
  text: string;
  /** Signed difference vs the baseline's cell. `null` on text rows and on the baseline's own column. */
  delta: number | null;
  /** The delta, pre-formatted with an explicit sign — `+3`, `−1.25`, `0`. `null` when `delta` is. */
  deltaText: string | null;
};

export type ScoreboardColumn = {
  planId: string;
  planName: string;
  cohort?: Cohort;
  isBaseline: boolean;
};

export type ScoreboardSection = {
  title: string;
  /** Column headers, in render order. */
  columns: ScoreboardColumn[];
  rows: ScoreboardRow[];
};

export type ScoreboardRow = {
  id: string;
  label: string;
  /** One per column, index-aligned. */
  cells: MetricCell[];
};

export type AnalyzedPlan = {
  id: string;
  name: string;
  features: PlanQualityFeatures;
};

/** Cohort-grain section: N plans × 2 cohorts = 2N columns. */
export const buildCohortSection = (
  title: string,
  rows: CohortMetricRow[],
  plans: AnalyzedPlan[],
  baselineId: string,
): ScoreboardSection => {
  const baseline = baselineOf(plans, baselineId);
  // Each column carries its own plan, so no index arithmetic reconstructs the pairing later.
  const cells = plans.flatMap((plan) => COHORT_VALUES.map((cohort) => ({ plan, cohort })));
  const cellsOf = (row: CohortMetricRow) =>
    cells.map(({ plan, cohort }) =>
      toCell({
        text: row.read(plan.features, cohort),
        kind: row.kind,
        isBaseline: plan.id === baselineId,
        value: row.value?.(plan.features, cohort),
        // Compared cohort-to-cohort: dp1 against the baseline's dp1, never against its dp2.
        baselineValue: row.value?.(baseline.features, cohort),
      }),
    );

  return {
    title,
    columns: cells.map(({ plan, cohort }) => ({
      planId: plan.id,
      planName: plan.name,
      cohort,
      isBaseline: plan.id === baselineId,
    })),
    rows: rows.map((row) => ({ id: row.id, label: row.label, cells: cellsOf(row) })),
  };
};

/** Plan-grain section: N plans = N columns. */
export const buildPlanSection = (
  title: string,
  rows: PlanMetricRow[],
  plans: AnalyzedPlan[],
  baselineId: string,
): ScoreboardSection => {
  const columns = plans.map((plan) => ({ planId: plan.id, planName: plan.name, isBaseline: plan.id === baselineId }));
  const baseline = baselineOf(plans, baselineId);
  const cellsOf = (row: PlanMetricRow) =>
    plans.map((plan) =>
      toCell({
        text: row.read(plan.features),
        kind: row.kind,
        isBaseline: plan.id === baselineId,
        value: row.value?.(plan.features),
        baselineValue: row.value?.(baseline.features),
      }),
    );

  return { title, columns, rows: rows.map((row) => ({ id: row.id, label: row.label, cells: cellsOf(row) })) };
};

/** The designated baseline, or the first plan when the id does not resolve — the route falls back the
 *  same way and says so, because deltas against a missing baseline would be meaningless numbers. */
export const baselineOf = (plans: AnalyzedPlan[], baselineId: string): AnalyzedPlan =>
  plans.find((plan) => plan.id === baselineId) ?? plans[0];

type CellInput = {
  text: string;
  kind: "number" | "text";
  isBaseline: boolean;
  value: number | undefined;
  baselineValue: number | undefined;
};

const toCell = ({ text, kind, isBaseline, value, baselineValue }: CellInput): MetricCell => {
  // The baseline is the reference, so it carries no delta against itself; text rows carry none by
  // definition. Written as one early return rather than a `comparable` boolean so the checks actually
  // narrow `value`/`baselineValue` to numbers below.
  if (kind !== "number" || isBaseline || value === undefined || baselineValue === undefined) {
    return { text, delta: null, deltaText: null };
  }

  const delta = round(value - baselineValue);
  return { text, delta, deltaText: signed(delta) };
};

/** Kill floating-point dust: `2.35 − 2.87` must not render as `−0.5200000000000002`. */
const round = (value: number): number => Math.round(value * 100) / 100;

/** An explicit sign on every non-zero delta, and a true minus sign (U+2212) rather than a hyphen, so a
 *  negative delta cannot be misread as a dash in a dense table. */
const signed = (delta: number): string => {
  if (delta === 0) return "0";
  return delta > 0 ? `+${num(delta)}` : `−${num(Math.abs(delta))}`;
};
