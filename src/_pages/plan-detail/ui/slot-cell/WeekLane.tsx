import type { CellOccupant } from "../../model/cell-occupants";
import { PlacedChip, type ChipWiring } from "./PlacedChip";

/**
 * One fortnightly lane (A or B) with a thin muted left rail. An empty lane shows a ghost "free"
 * placeholder so the remaining week capacity is visible. Renders its chips by importing
 * `PlacedChip` directly — no `render` callback threaded in. Tokens only.
 */
export function WeekLane({ label, chips, wiring }: { label: "A" | "B"; chips: CellOccupant[]; wiring: ChipWiring }) {
  return (
    <div data-slot="week-lane" aria-label={`Week ${label}`} className="flex items-stretch gap-1">
      <span
        aria-hidden="true"
        className="bg-secondary text-muted-foreground flex w-4 shrink-0 items-center justify-center rounded text-xs font-medium"
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {chips.length > 0 ? (
          chips.map((occupant) => <PlacedChip key={occupant.placement.id} occupant={occupant} {...wiring} />)
        ) : (
          <span
            data-slot="week-lane-ghost"
            aria-hidden="true"
            className="border-border text-muted-foreground rounded-md border border-dashed px-1.5 py-1 text-xs"
          >
            free
          </span>
        )}
      </div>
    </div>
  );
}
