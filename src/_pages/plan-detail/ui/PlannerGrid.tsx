import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import { SlotCellHost, type CellWiring } from "./slot-cell/SlotCellHost";
import type { CellCollisions } from "../model/collisions";
import { groupCellOccupants, type CellOccupant } from "../model/cell-occupants";
import type { LocalPlacement } from "../model/placement";
import { cellKey } from "../model/collisions";

type Props = CellWiring & {
  days: number;
  periods: number;
  /** Pre-formatted accessible name for the grid (e.g. "DP1 timetable") — built at the board level. */
  gridLabel: string;
  placements: LocalPlacement[];
  names: Record<string, string>;
  /** cellKey → flags + structured violations for that cell. */
  collisions: Map<string, CellCollisions>;
};

/** The 10×5 (period × day) slot grid. Each cell is a droppable; cells are multi-occupancy. */
export default function PlannerGrid({
  days,
  periods,
  gridLabel,
  placements,
  names,
  collisions,
  dropHints,
  hintMode,
  isExploded,
  justDuplicated,
  onRemove,
  onSetWeek,
  onToggleBundle,
  onRemoveBundle,
  onDuplicateBundle,
  onLiftBundle,
  onInspect,
}: Props) {
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const periodList = Array.from({ length: periods }, (_, i) => i + 1);
  // Resolve each occupant's display name + collision flags once, here, where `names`/`collisions`
  // are held — the cell/chip components below never see the map or a `CellCollisions` record.
  const byCell = groupCellOccupants(placements, names, collisions);

  return (
    <div data-slot="planner-grid" className="w-max min-w-full">
      <div
        role="grid"
        aria-label={gridLabel}
        className="bg-border grid gap-px rounded-lg"
        style={{ gridTemplateColumns: `auto repeat(${days}, minmax(7rem, 1fr))` }}
      >
        {/* `contents` keeps each row out of the CSS grid box model while still exposing
            `role="row"` so cells nest under rows in the accessibility tree. */}
        <div role="row" className="contents">
          <div role="presentation" className="bg-background p-2" />
          {dayList.map((day) => (
            <div
              key={day}
              role="columnheader"
              className="bg-background text-muted-foreground p-2 text-center text-xs font-medium"
            >
              {dayLabel(day)}
            </div>
          ))}
        </div>

        {periodList.map((period) => (
          <PeriodRow
            key={period}
            period={period}
            days={dayList}
            byCell={byCell}
            dropHints={dropHints}
            hintMode={hintMode}
            isExploded={isExploded}
            justDuplicated={justDuplicated}
            onRemove={onRemove}
            onSetWeek={onSetWeek}
            onToggleBundle={onToggleBundle}
            onRemoveBundle={onRemoveBundle}
            onDuplicateBundle={onDuplicateBundle}
            onLiftBundle={onLiftBundle}
            onInspect={onInspect}
          />
        ))}
      </div>
    </div>
  );
}

function PeriodRow({
  period,
  days,
  byCell,
  dropHints,
  hintMode,
  isExploded,
  justDuplicated,
  onRemove,
  onSetWeek,
  onToggleBundle,
  onRemoveBundle,
  onDuplicateBundle,
  onLiftBundle,
  onInspect,
}: CellWiring & {
  period: number;
  days: number[];
  byCell: Map<string, CellOccupant[]>;
}) {
  return (
    <div role="row" className="contents">
      <div
        role="rowheader"
        className="bg-background text-muted-foreground flex items-center justify-center p-2 text-xs font-medium"
      >
        {periodLabel(period)}
      </div>
      {days.map((day) => (
        <SlotCellHost
          key={day}
          day={day}
          period={period}
          occupants={byCell.get(cellKey(day, period)) ?? []}
          dropHints={dropHints}
          hintMode={hintMode}
          isExploded={isExploded}
          justDuplicated={justDuplicated}
          onRemove={onRemove}
          onSetWeek={onSetWeek}
          onToggleBundle={onToggleBundle}
          onRemoveBundle={onRemoveBundle}
          onDuplicateBundle={onDuplicateBundle}
          onLiftBundle={onLiftBundle}
          onInspect={onInspect}
        />
      ))}
    </div>
  );
}
