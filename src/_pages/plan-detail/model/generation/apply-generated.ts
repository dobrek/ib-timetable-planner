import type { Cohort } from "@/shared/config";
import { cellKey, type GeneratedPlacement } from "@/entities/timetable";
import type { AffectedScope, AffectedSlice, HistoryEntry } from "../history/history-entry";
import type { PlaceEntry } from "../history/reconcile-apply";

/**
 * Pure builders behind the combined-level `applyGenerated` verb: project a verified engine
 * result into per-cohort segments (scope + captured `before` slice + staged place entries),
 * the plan-scoped region payload for the one atomic RPC, and the single two-cohort history
 * entry whose one undo press reverts both cohorts. Hook-free so the flow is unit-testable.
 */
export type GeneratedSegment = {
  cohort: Cohort;
  scope: AffectedScope;
  /** The pre-apply slice at the scoped cells — the undo target AND the region's existing rows. */
  before: AffectedSlice;
  entries: PlaceEntry[];
};

export const buildGeneratedSegments = (
  generated: GeneratedPlacement[],
  snapshotOf: (cohort: Cohort, scope: AffectedScope) => AffectedSlice,
  newTempId: () => string,
): GeneratedSegment[] =>
  (["dp1", "dp2"] as const)
    .map((cohort) => {
      const rows = generated.filter((row) => row.cohort === cohort);
      const scope: AffectedScope = {
        cells: [...new Set(rows.map((row) => cellKey(row.day, row.period)))],
        cardSets: [],
      };
      return {
        cohort,
        scope,
        before: snapshotOf(cohort, scope),
        entries: rows.map(
          (row): PlaceEntry => ({
            tempId: newTempId(),
            spec: { courseId: row.courseId, day: row.day, period: row.period, week: row.week, isOptional: false },
          }),
        ),
      };
    })
    .filter((segment) => segment.entries.length > 0);

/**
 * The region-replace payload: the affected cells plus their COMPLETE final content — the
 * existing rows captured in `before` (carrying their live `week`/`isOptional`, which the RPC
 * converges rather than resets) and the generated rows. One payload carries both cohorts.
 */
export const buildRegionPayload = (
  segments: GeneratedSegment[],
): {
  cells: { cohort: Cohort; day: number; period: number }[];
  placements: {
    cohort: Cohort;
    courseId: string;
    day: number;
    period: number;
    week: PlaceEntry["spec"]["week"];
    isOptional: boolean;
  }[];
} => ({
  cells: segments.flatMap(({ cohort, scope }) =>
    scope.cells.map((key) => {
      const [day, period] = key.split(":").map(Number);
      return { cohort, day, period };
    }),
  ),
  placements: segments.flatMap(({ cohort, before, entries }) => [
    ...before.placements.map(({ courseId, day, period, week, isOptional }) => ({
      cohort,
      courseId,
      day,
      period,
      week,
      isOptional,
    })),
    ...entries.map(({ spec }) => ({ cohort, ...spec })),
  ]),
});

/** One history entry for the whole generation — the sibling segment makes one undo press
 *  revert both cohorts. Null when nothing was generated (no entry to record). */
export const generationHistoryEntry = (segments: GeneratedSegment[]): HistoryEntry | null => {
  if (segments.length === 0) return null;
  const [main] = segments;
  const sibling = segments.length > 1 ? segments[1] : null;
  return {
    cohort: main.cohort,
    scope: main.scope,
    target: main.before,
    label: "Generate plan",
    ...(sibling ? { sibling: { cohort: sibling.cohort, scope: sibling.scope, target: sibling.before } } : {}),
  };
};
