import type { AvailabilityIndex } from "./availability-index";
import { bucketByCell, cellKey } from "./collisions";
import type { CrossCohortIndex } from "./cross-cohort-index";
import { deriveDropHints } from "./drop-hints";
import type { CellData } from "./drag";
import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";

export type FindDuplicateTargetArgs = {
  /** The placed cell being duplicated; the scan starts at the cell right after it and wraps. */
  source: CellData;
  /** The source cell's occupants, resolved to validation-catalog courses. */
  members: GroupingCourse[];
  placements: PlannerPlacement[];
  catalogById: Map<string, GroupingCourse>;
  availability?: AvailabilityIndex;
  occupiedByTeacher?: CrossCohortIndex;
  days: number;
  periods: number;
};

/**
 * The first empty cell where the whole member-set lands conflict-free, scanning column-major
 * (down the source's day, then the next day) **starting at the cell right after the source** and
 * **wrapping** around the grid — so a duplicate lands just below/after the bundle and never jumps
 * back to the week's top-left unless every cell after the source is full.
 *
 * Reuses `deriveDropHints` (a **copy** context — `{ members }`, no `excludePlacementIds`/`origin`,
 * so the source stays on the board and is never picked) and `bucketByCell` (the empty-cell test),
 * so it can't drift from drag-time validity. Two-tier: prefer a strictly-free empty cell (no hint
 * entry); fall back to a non-blocking empty cell (`warn` / `opposite-week`); else `null`.
 */
export function findDuplicateTarget({
  source,
  members,
  placements,
  catalogById,
  availability,
  occupiedByTeacher,
  days,
  periods,
}: FindDuplicateTargetArgs): CellData | null {
  // Copy context: no exclude/origin, so the what-if judges every cell against the FULL board.
  const hints = deriveDropHints({ members }, placements, catalogById, availability, occupiedByTeacher);
  const buckets = bucketByCell(placements, catalogById);
  const order = columnMajorOrder(days, periods);

  // Rotate the scan to begin at the cell AFTER the source (column-major), wrapping the grid.
  const start = (source.day - 1) * periods + (source.period - 1) + 1;

  let strictlyFree: CellData | null = null;
  let nonBlocking: CellData | null = null;
  for (let i = 0; i < order.length; i++) {
    const { day, period } = order[(start + i) % order.length];
    const key = cellKey(day, period);
    if (buckets.has(key)) continue; // only EMPTY cells (skips the source itself)
    const hint = hints?.get(key); // an empty cell can still be warn / blocked / opposite-week
    if (hint === undefined) strictlyFree ??= { day, period };
    else if (hint === "warn" || hint === "opposite-week") nonBlocking ??= { day, period };
    // "blocked" / "partial" → skip
  }
  return strictlyFree ?? nonBlocking ?? null;
}

/** Column-major cell order: day outer, period inner. */
const columnMajorOrder = (days: number, periods: number): CellData[] => {
  const order: CellData[] = [];
  for (let day = 1; day <= days; day++) for (let period = 1; period <= periods; period++) order.push({ day, period });
  return order;
};
