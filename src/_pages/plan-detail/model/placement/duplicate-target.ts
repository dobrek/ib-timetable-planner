import {
  type AvailabilityIndex,
  bucketByCell,
  cellKey,
  type CrossCohortIndex,
  type PlannerPlacement,
} from "@/entities/timetable";
import { deriveDropHints, type DropHint } from "../drop-hints";
import type { CellData } from "../drag";
import type { GroupingCourse } from "../grouping/grouping";

export type FindDuplicateTargetArgs = {
  /** The placed cell being duplicated; the scan starts at the cell right after it and wraps. */
  source: CellData;
  /** The source cell's occupants, resolved to validation-catalog courses. */
  members: GroupingCourse[];
  placements: PlannerPlacement[];
  catalogById: Map<string, GroupingCourse>;
  availability?: AvailabilityIndex;
  occupiedByTeacher?: CrossCohortIndex;
  /** Flagged-id set so the search skips cells the early-finish edge rule blocks (inherited via
   *  `deriveDropHints`). Omitted ⇒ empty ⇒ the edge rule contributes no blocks. */
  finishesEarlyByCourseId?: Set<string>;
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
 * entry); fall back to a non-blocking empty cell (`warn` / `opposite-week`); else `undefined`
 * (mirrors `Array.prototype.find` — a `find*` returns `undefined` when nothing matches).
 */
export function findDuplicateTarget({
  source,
  members,
  placements,
  catalogById,
  availability,
  occupiedByTeacher,
  finishesEarlyByCourseId,
  days,
  periods,
}: FindDuplicateTargetArgs): CellData | undefined {
  const hints = deriveDropHints(
    { members },
    placements,
    catalogById,
    availability,
    occupiedByTeacher,
    finishesEarlyByCourseId,
    { periods },
  );
  const occupied = bucketByCell(placements, catalogById);

  const emptyCells = rotatedColumnMajor(days, periods, source).filter(
    (cell) => !occupied.has(cellKey(cell.day, cell.period)),
  );

  const hintAt = (cell: CellData): DropHint | undefined => hints?.get(cellKey(cell.day, cell.period));

  return (
    emptyCells.find((cell) => hintAt(cell) === undefined) ?? emptyCells.find((cell) => isNonBlocking(hintAt(cell)))
  );
}

const isNonBlocking = (hint: DropHint | undefined): hint is "warn" | "opposite-week" =>
  hint === "warn" || hint === "opposite-week";

/** Column-major order starting at the cell AFTER `source`, wrapping around the grid. */
const rotatedColumnMajor = (days: number, periods: number, source: CellData): CellData[] => {
  const total = days * periods;
  const start = (source.day - 1) * periods + (source.period - 1) + 1;
  return Array.from({ length: total }, (_, i) => {
    const idx = (start + i) % total;
    return { day: Math.floor(idx / periods) + 1, period: (idx % periods) + 1 };
  });
};
