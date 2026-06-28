import { Fragment } from "react";
import { cohortLabel, type Cohort, type PlacementWeek } from "@/shared/config";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import SlotCell from "./slot-cell/SlotCell";
import type { CollisionInspectionTarget } from "../overlay/CollisionDetailsDialog";
import type { CellCollisions } from "../../model/collision/collisions";
import { cellKey } from "../../model/collision/cell-key";
import { groupCellOccupants } from "../../model/collision/cell-occupants";
import type { CellData } from "../../model/drag";
import type { DropHint } from "../../model/drop-hints";
import { isBundled } from "../../model/exploded-cells";
import type { LocalPlacement } from "../../model/placement/placement";
import type { HintMode } from "../../lib/drag-hint-mode";

/**
 * The cell wiring shared by every column the grid renders — the cell-level drag-hint state plus the
 * per-chip handlers. One `CellWiring` object is built per column (see `useCellWiring`) and spread into
 * each of that column's cells; the grid resolves the per-cell values (this cell's hint, `bundled`, the
 * `justDuplicated` pulse match) from it inline, so `SlotCell` stays a dumb presentational component
 * taking already-resolved scalars.
 */
export type CellWiring = {
  /** cellKey → drag hint (sparse: absent = free); null when no drag is active. */
  dropHints: Map<string, DropHint> | null;
  /** Encoding for the hint cells while a drag is active. */
  hintMode: HintMode;
  /** Is `(day, period)` currently exploded (ungrouped view)? Drives the per-cell `bundled` derivation. */
  isExploded: (day: number, period: number) => boolean;
  /** The cell a duplicate just landed on (with a nonce), or null; the matching cell pulses. */
  justDuplicated: (CellData & { nonce: number }) | null;
  onRemove: (placementId: string) => void;
  onSetWeek: (placementId: string, week: PlacementWeek) => void;
  onToggleBundle: (day: number, period: number, bundled: boolean) => void;
  onRemoveBundle: (day: number, period: number) => void;
  onDuplicateBundle: (day: number, period: number) => void;
  onLiftBundle: (day: number, period: number) => void;
  onInspect: (target: CollisionInspectionTarget) => void;
};

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
            {dayList.map((day) => {
              // One key per cell (cohort-free); each column resolves its own per-cell values from its
              // shared wiring (the drop-hint lookup, `bundled`, the `justDuplicated` pulse match).
              const key = cellKey(day, period);
              return (
                <Fragment key={day}>
                  {columns.map((column, index) => {
                    const { dropHints, hintMode, isExploded, justDuplicated, ...handlers } = column.wiring;
                    const occupants = byCell[index].get(key) ?? [];
                    return (
                      <SlotCell
                        key={column.cohort}
                        day={day}
                        period={period}
                        cohort={column.cohort}
                        occupants={occupants}
                        dropHint={dropHints?.get(key)}
                        hintActive={dropHints !== null}
                        hintMode={hintMode}
                        bundled={isBundled(occupants.length, isExploded(day, period))}
                        justDuplicated={
                          justDuplicated !== null && cellKey(justDuplicated.day, justDuplicated.period) === key
                        }
                        dimmed={multi && activeDragCohort !== null && activeDragCohort !== column.cohort}
                        {...handlers}
                      />
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
