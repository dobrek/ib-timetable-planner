import { COHORT_VALUES } from "@/shared/config";
import type { CohortFeatures, Distribution, PlanQualityFeatures } from "@/entities/timetable";

/**
 * The bench renderer's pure formatters, lifted verbatim from `bench/plan-report.ts` (where they are
 * module-private) so the in-app scoreboard prints the same strings the CLI does. The two surfaces are
 * cross-checked against each other digit-for-digit, so a "tidier" formatter here would be a bug.
 */

/** Integers as-is, everything else to 2dp — so a slot count reads `48`, not `48.00`. */
export const num = (value: number): string => (Number.isInteger(value) ? `${value}` : value.toFixed(2));

export const pct = (share: number): string => `${Math.round(share * 100)}%`;

export const distributionLine = (name: string, values: Distribution): string =>
  `${name}: min ${num(values.min)} · p10 ${num(values.p10)} · median ${num(values.median)} · mean ${num(values.mean)} · max ${num(values.max)}`;

export const sumCohorts = (features: PlanQualityFeatures, read: (cohort: CohortFeatures) => number): number =>
  COHORT_VALUES.reduce((sum, cohort) => sum + read(features.cohorts[cohort]), 0);

/**
 * Both cohorts' **samples** pooled — NOT the mean of the two cohort means.
 *
 * Averaging means would weight a 27-student cohort the same as a 34-student one, quietly inventing a
 * number that describes no actual population. This is a load-bearing distinction, not a micro-detail:
 * it must survive any "simplification" of this module.
 */
export const pooledMean = (features: PlanQualityFeatures, read: (cohort: CohortFeatures) => Distribution): number => {
  const parts = COHORT_VALUES.map((cohort) => read(features.cohorts[cohort]));
  const samples = parts.reduce((sum, part) => sum + part.count, 0);
  return samples === 0 ? 0 : parts.reduce((sum, part) => sum + part.mean * part.count, 0) / samples;
};

/** `Chemistry HL` / `Chemistry` — level `none` is the absent sentinel and is dropped. Mirrors the
 *  bench's `courseName`. */
export const subjectLabel = (name: string, level: string): string => (level === "none" ? name : `${name} ${level}`);
