import { Fragment } from "react";
import { cohortLabel, type Cohort } from "@/shared/config";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import { SlotCellHost, type CellWiring } from "./slot-cell/SlotCellHost";
import type { CellCollisions } from "../../model/collision/collisions";
import { cellKey } from "../../model/collision/cell-key";
import { groupCellOccupants } from "../../model/collision/cell-occupants";
import type { LocalPlacement } from "../../model/placement/placement";

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
  gridLabel: string;
  dp1: PairedColumn;
  dp2: PairedColumn;
  /** Source cohort of the active drag (or the palette's active cohort) — the OTHER column's cells
   *  recede as non-targets. Null = no drag / no cohort signal, so nothing dims. */
  activeDragCohort: Cohort | null;
};

/**
 * The combined two-cohort grid (S-06): one grid where each day header spans two sub-columns
 * (DP1 | DP2) over shared period rows, interleaving each cohort's `SlotCellHost`. Each cell carries
 * its own `cohort`, so the dnd ids are namespaced (no collision under the single provider) while the
 * collision/hint maps stay keyed by bare `cellKey`. The cell internals (`SlotCell`, `PlacedChip`,
 * `WeekToggle`) are reused unchanged; this component owns only the column-spanning header + the
 * DP1/DP2 interleave + the sibling-dim signal.
 */
export default function PairedPlannerGrid({ days, periods, gridLabel, dp1, dp2, activeDragCohort }: Props) {
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const periodList = Array.from({ length: periods }, (_, i) => i + 1);
  const columns: [PairedColumn, PairedColumn] = [dp1, dp2];
  // Resolve each column's occupants once (name + collision flags), exactly as the single grid does.
  const byCell = columns.map((column) => groupCellOccupants(column.placements, column.names, column.collisions));

  return (
    <div data-slot="paired-planner-grid" className="w-max min-w-full">
      <div
        role="grid"
        aria-label={gridLabel}
        className="bg-border grid gap-px rounded-lg"
        style={{ gridTemplateColumns: `auto repeat(${days}, minmax(7rem, 1fr) minmax(7rem, 1fr))` }}
      >
        {/* Day headers — each spans both cohort sub-columns. */}
        <div role="row" className="contents">
          <div role="presentation" className="bg-background p-2" />
          {dayList.map((day) => (
            <div
              key={day}
              role="columnheader"
              style={{ gridColumn: "span 2" }}
              className="bg-background text-muted-foreground p-2 text-center text-xs font-medium"
            >
              {dayLabel(day)}
            </div>
          ))}
        </div>

        {/* Cohort sub-labels under each day. */}
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
                    dimmed={activeDragCohort !== null && activeDragCohort !== column.cohort}
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
