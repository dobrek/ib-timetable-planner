import { Fragment } from "react";
import { cohortLabel, type Cohort } from "@/shared/config";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import { SlotCellHost, type CellWiring } from "./slot-cell/SlotCellHost";
import type { CellCollisions } from "../../model/collision/collisions";
import { groupCellOccupants } from "../../model/collision/cell-occupants";
import type { LocalPlacement } from "../../model/placement/placement";
import { cellKey } from "../../model/collision/cell-key";

/** One cohort column's render inputs: its placements + name/collision maps and its cell wiring. */
export type PairedColumn = {
  cohort: Cohort;
  placements: LocalPlacement[];
  names: Record<string, string>;
  collisions: Map<string, CellCollisions>;
  wiring: CellWiring;
};

type Props = {
  days: number;
  periods: number;
  /** Pre-formatted accessible name for the grid (e.g. "DP1 timetable") — built at the board level. */
  gridLabel: string;
  /** The cohort columns to render: one in focus mode, two (DP1 | DP2) in combined. Each day header
   *  spans its sub-columns; with a single column there is no sub-label row and no sibling-dim. */
  columns: PairedColumn[];
  /** Source cohort of the active drag (or the palette's active cohort) — the OTHER column's cells
   *  recede as non-targets. Null = no drag / no cohort signal; ignored when there is one column. */
  activeDragCohort: Cohort | null;
};

/**
 * The one slot grid: period rows over `columns` day sub-columns. With a single column it is the
 * degenerate focus-mode grid — one sub-column per day, no cohort sub-label row, no sibling-dim — and
 * renders byte-for-byte as the pre-merge single grid. With two columns each day header spans both
 * cohort sub-columns (DP1 | DP2), a sub-label row names them, and the sibling column recedes during a
 * cross-cohort drag. Every cell carries its own `cohort`, so the dnd ids namespace (no collision under
 * the single provider) while the collision/hint maps stay keyed by bare `cellKey`. The cell internals
 * (`SlotCell`, `PlacedChip`, `WeekToggle`) are reused unchanged.
 */
export default function PlannerGrid({ days, periods, gridLabel, columns, activeDragCohort }: Props) {
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const periodList = Array.from({ length: periods }, (_, i) => i + 1);
  const multi = columns.length > 1;
  // Resolve each column's occupants once (name + collision flags), exactly as before per column.
  const byCell = columns.map((column) => groupCellOccupants(column.placements, column.names, column.collisions));
  const subColumns = columns.map(() => "minmax(7rem, 1fr)").join(" ");

  return (
    <div data-slot="planner-grid" className="w-max min-w-full">
      <div
        role="grid"
        aria-label={gridLabel}
        className="bg-border grid gap-px rounded-lg"
        style={{ gridTemplateColumns: `auto repeat(${days}, ${subColumns})` }}
      >
        {/* `contents` keeps each row out of the CSS grid box model while still exposing
            `role="row"` so cells nest under rows in the accessibility tree. */}
        <div role="row" className="contents">
          <div role="presentation" className="bg-background p-2" />
          {dayList.map((day) => (
            <div
              key={day}
              role="columnheader"
              style={multi ? { gridColumn: `span ${columns.length}` } : undefined}
              className="bg-background text-muted-foreground p-2 text-center text-xs font-medium"
            >
              {dayLabel(day)}
            </div>
          ))}
        </div>

        {/* Cohort sub-labels under each day — combined only (a single column needs none). */}
        {multi && (
          <div role="row" className="contents">
            <div role="presentation" className="bg-background p-1" />
            {dayList.map((day) => (
              <Fragment key={day}>
                {columns.map((column) => (
                  <div
                    key={column.cohort}
                    role="columnheader"
                    className="bg-background text-muted-foreground p-1 text-center text-xs font-medium"
                  >
                    {cohortLabel(column.cohort)}
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        )}

        {periodList.map((period) => (
          <div role="row" className="contents" key={period}>
            <div
              role="rowheader"
              className="bg-background text-muted-foreground flex items-center justify-center p-2 text-xs font-medium"
            >
              {periodLabel(period)}
            </div>
            {dayList.map((day) => (
              <Fragment key={day}>
                {columns.map((column, index) => (
                  <SlotCellHost
                    key={column.cohort}
                    day={day}
                    period={period}
                    cohort={column.cohort}
                    occupants={byCell[index].get(cellKey(day, period)) ?? []}
                    dimmed={multi && activeDragCohort !== null && activeDragCohort !== column.cohort}
                    {...column.wiring}
                  />
                ))}
              </Fragment>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
