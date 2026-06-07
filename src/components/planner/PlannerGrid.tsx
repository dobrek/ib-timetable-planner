import SlotCell from "@/components/planner/SlotCell";
import type { LocalPlacement } from "@/components/planner/types";
import { cellKey } from "@/lib/planner/collisions";

type Props = {
  days: number;
  periods: number;
  placements: LocalPlacement[];
  names: Record<string, string>;
  /** cellKey → set of course ids in collision for that cell. */
  collisions: Map<string, Set<string>>;
  onRemove: (placementId: string) => void;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The 10×5 (period × day) slot grid. Each cell is a droppable; cells are multi-occupancy. */
export default function PlannerGrid({ days, periods, placements, names, collisions, onRemove }: Props) {
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
            {DAY_LABELS[day - 1] ?? `Day ${day}`}
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
            onRemove={onRemove}
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
  onRemove,
}: {
  period: number;
  days: number[];
  byCell: Map<string, LocalPlacement[]>;
  names: Record<string, string>;
  collisions: Map<string, Set<string>>;
  onRemove: (placementId: string) => void;
}) {
  return (
    <>
      <div className="bg-background text-muted-foreground flex items-center justify-center p-2 text-xs font-medium">
        P{period}
      </div>
      {days.map((day) => (
        <SlotCell
          key={day}
          day={day}
          period={period}
          occupants={byCell.get(cellKey(day, period)) ?? []}
          names={names}
          conflicts={collisions.get(cellKey(day, period))}
          onRemove={onRemove}
        />
      ))}
    </>
  );
}

/**
 * Group placements by cell, with each cell's occupants in a deterministic order
 * (display name, then courseId) so the chip order is stable across reloads — the DB
 * read has no inherent ordering.
 */
const groupByCell = (placements: LocalPlacement[], names: Record<string, string>): Map<string, LocalPlacement[]> => {
  const map = new Map<string, LocalPlacement[]>();
  for (const placement of placements) {
    const key = cellKey(placement.day, placement.period);
    const existing = map.get(key);
    if (existing) existing.push(placement);
    else map.set(key, [placement]);
  }
  for (const occupants of map.values()) occupants.sort((a, b) => compareByName(a, b, names));
  return map;
};

const compareByName = (a: LocalPlacement, b: LocalPlacement, names: Record<string, string>): number => {
  const byName = (names[a.courseId] ?? a.courseId).localeCompare(names[b.courseId] ?? b.courseId);
  return byName !== 0 ? byName : a.courseId.localeCompare(b.courseId);
};
