import type { Cohort } from "@/shared/config";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import { SlotCellHost, type CellWiring } from "./slot-cell/SlotCellHost";
import type { CellCollisions } from "../../model/collision/collisions";
import { groupCellOccupants, type CellOccupant } from "../../model/collision/cell-occupants";
import type { LocalPlacement } from "../../model/placement/placement";
import { cellKey } from "../../model/collision/cell-key";

type Props = {
  days: number;
  periods: number;
  /** Pre-formatted accessible name for the grid (e.g. "DP1 timetable") — built at the board level. */
  gridLabel: string;
  /** The board's one cohort — stamped onto every cell so the dnd ids namespace and the router routes. */
  cohort: Cohort;
  placements: LocalPlacement[];
  names: Record<string, string>;
  /** cellKey → flags + structured violations for that cell. */
  collisions: Map<string, CellCollisions>;
  /** One bundled cell-wiring object, spread into each `SlotCellHost` — mirrors `PairedPlannerGrid`. */
  wiring: CellWiring;
};

/** The 10×5 (period × day) slot grid. Each cell is a droppable; cells are multi-occupancy. */
export default function PlannerGrid({
  days,
  periods,
  gridLabel,
  cohort,
  placements,
  names,
  collisions,
  wiring,
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
          <PeriodRow key={period} period={period} days={dayList} cohort={cohort} byCell={byCell} wiring={wiring} />
        ))}
      </div>
    </div>
  );
}

function PeriodRow({
  period,
  days,
  cohort,
  byCell,
  wiring,
}: {
  period: number;
  days: number[];
  cohort: Cohort;
  byCell: Map<string, CellOccupant[]>;
  wiring: CellWiring;
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
          cohort={cohort}
          occupants={byCell.get(cellKey(day, period)) ?? []}
          {...wiring}
        />
      ))}
    </div>
  );
}
