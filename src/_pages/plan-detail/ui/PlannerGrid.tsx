import type { PlacementWeek } from "@/shared/config";
import type { CollisionInspectionTarget } from "./CollisionDetailsDialog";
import SlotCell from "./slot-cell";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import type { CellCollisions } from "../model/collisions";
import type { DropHint } from "../model/drop-hints";
import type { HintMode } from "../lib/drag-hint-mode";
import type { LocalPlacement } from "../model/placement";
import { isBundled } from "../model/slot-bundle";
import { cellKey } from "../model/collisions";
import { groupBy } from "@/shared/lib/collections";

type Props = {
  days: number;
  periods: number;
  placements: LocalPlacement[];
  names: Record<string, string>;
  /** cellKey → flags + structured violations for that cell. */
  collisions: Map<string, CellCollisions>;
  /** cellKey → drag hint (sparse: absent = free); null when no drag is active. */
  dropHints: Map<string, DropHint> | null;
  /** Encoding for the hint cells while a drag is active. */
  hintMode: HintMode;
  /** Is `(day, period)` explicitly ungrouped? Drives the per-cell `bundled` derivation. */
  isOverridden: (day: number, period: number) => boolean;
  onRemove: (placementId: string) => void;
  onSetWeek: (placementId: string, week: PlacementWeek) => void;
  onToggleBundle: (day: number, period: number, bundled: boolean) => void;
  onRemoveBundle: (day: number, period: number) => void;
  onInspect: (target: CollisionInspectionTarget) => void;
};

/** The 10×5 (period × day) slot grid. Each cell is a droppable; cells are multi-occupancy. */
export default function PlannerGrid({
  days,
  periods,
  placements,
  names,
  collisions,
  dropHints,
  hintMode,
  isOverridden,
  onRemove,
  onSetWeek,
  onToggleBundle,
  onRemoveBundle,
  onInspect,
}: Props) {
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const periodList = Array.from({ length: periods }, (_, i) => i + 1);
  const byCell = groupByCell(placements, names);

  return (
    <div data-slot="planner-grid" className="w-max min-w-full">
      <div
        className="bg-border grid gap-px rounded-lg"
        style={{ gridTemplateColumns: `auto repeat(${days}, minmax(7rem, 1fr))` }}
      >
        <div className="bg-background p-2" />
        {dayList.map((day) => (
          <div key={day} className="bg-background text-muted-foreground p-2 text-center text-xs font-medium">
            {dayLabel(day)}
          </div>
        ))}

        {periodList.map((period) => (
          <PeriodRow
            key={period}
            period={period}
            days={dayList}
            byCell={byCell}
            names={names}
            collisions={collisions}
            dropHints={dropHints}
            hintMode={hintMode}
            isOverridden={isOverridden}
            onRemove={onRemove}
            onSetWeek={onSetWeek}
            onToggleBundle={onToggleBundle}
            onRemoveBundle={onRemoveBundle}
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
  names,
  collisions,
  dropHints,
  hintMode,
  isOverridden,
  onRemove,
  onSetWeek,
  onToggleBundle,
  onRemoveBundle,
  onInspect,
}: {
  period: number;
  days: number[];
  byCell: Map<string, LocalPlacement[]>;
  names: Record<string, string>;
  collisions: Map<string, CellCollisions>;
  dropHints: Map<string, DropHint> | null;
  hintMode: HintMode;
  isOverridden: (day: number, period: number) => boolean;
  onRemove: (placementId: string) => void;
  onSetWeek: (placementId: string, week: PlacementWeek) => void;
  onToggleBundle: (day: number, period: number, bundled: boolean) => void;
  onRemoveBundle: (day: number, period: number) => void;
  onInspect: (target: CollisionInspectionTarget) => void;
}) {
  return (
    <>
      <div className="bg-background text-muted-foreground flex items-center justify-center p-2 text-xs font-medium">
        {periodLabel(period)}
      </div>
      {days.map((day) => {
        const occupants = byCell.get(cellKey(day, period)) ?? [];
        return (
          <SlotCell
            key={day}
            day={day}
            period={period}
            occupants={occupants}
            names={names}
            collisions={collisions.get(cellKey(day, period))}
            dropHint={dropHints?.get(cellKey(day, period))}
            hintActive={dropHints !== null}
            hintMode={hintMode}
            bundled={isBundled(occupants.length, isOverridden(day, period))}
            onRemove={onRemove}
            onSetWeek={onSetWeek}
            onToggleBundle={onToggleBundle}
            onRemoveBundle={onRemoveBundle}
            onInspect={onInspect}
          />
        );
      })}
    </>
  );
}

/**
 * Group placements by cell, with each cell's occupants in a deterministic order
 * (display name, then courseId) so the chip order is stable across reloads — the DB
 * read has no inherent ordering.
 */
const groupByCell = (placements: LocalPlacement[], names: Record<string, string>): Map<string, LocalPlacement[]> => {
  const map = groupBy(placements, (placement) => cellKey(placement.day, placement.period));
  for (const occupants of map.values()) occupants.sort((a, b) => compareByName(a, b, names));
  return map;
};

const compareByName = (a: LocalPlacement, b: LocalPlacement, names: Record<string, string>): number => {
  const byName = (names[a.courseId] ?? a.courseId).localeCompare(names[b.courseId] ?? b.courseId);
  return byName !== 0 ? byName : a.courseId.localeCompare(b.courseId);
};
