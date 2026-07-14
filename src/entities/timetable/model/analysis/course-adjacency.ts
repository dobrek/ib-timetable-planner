import { expandLanes, laneStats } from "./lanes";
import type { AnalyzerRow, CourseAdjacencyFeatures } from "./types";

/**
 * The headline finding of the v0 report: the expert's boards carry hundreds of same-course adjacent
 * pairs (double periods) and **zero** same-day splits — "never a gap between two hours of the same
 * subject" is an invariant, not a preference. Subject identity is NOT needed: a student takes at most
 * one course per subject, so this is a same-`courseId` phenomenon at the row grain.
 *
 * Both halves are now modeled: the split is a hard rule (`courseDaySplit`, enforced in `board.fitsAt`
 * and the oracle), the doubles are a soft tier (`countDoublesDeficit`). This lens still measures both,
 * because the rule guarantees only that the two hours are *adjacent when they share a day* — nothing
 * makes them share one.
 *
 * Lane-expanded (a `both` row counts in both A and B lanes — the report's counting convention), so
 * a biweekly double is not silently worth half of an agnostic one.
 */
export const deriveCourseAdjacency = (rows: AnalyzerRow[]): CourseAdjacencyFeatures => {
  const lanes = expandLanes(rows, (row) => [row.courseId]).map((lane) => ({ ...lane, stats: laneStats(lane.periods) }));
  const splitLanes = lanes.filter((lane) => lane.stats.holes > 0);

  return {
    adjacentPairs: lanes.reduce((sum, lane) => sum + adjacentPairsOf(lane.periods), 0),
    sameDaySplits: splitLanes.length,
    splitCourseIds: [...new Set(splitLanes.map((lane) => lane.entityKey))],
  };
};

/** Consecutive-period pairs inside one lane: P1,P2,P3 is two pairs (a triple period), P1,P3 is none. */
const adjacentPairsOf = (periods: number[]): number =>
  periods.filter((period, index) => index > 0 && period === periods[index - 1] + 1).length;
