import ComputeGroupingsEmptyState from "@/components/planner/ComputeGroupingsEmptyState";
import type { PlannerBoardProps } from "@/components/planner/types";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Planner island root. Phase 2 renders the empty-state bootstrap and a static
 * palette + grid; Phase 3 layers drag-and-drop and optimistic persistence on top,
 * Phase 4 the reactive collision/hours derivations.
 */
export default function PlannerBoard(props: PlannerBoardProps) {
  const { planId, cohortId, days, periods, groupings, names } = props;

  if (groupings.length === 0) {
    return (
      <div data-slot="planner-board" className="p-6">
        <ComputeGroupingsEmptyState planId={planId} cohortId={cohortId} />
      </div>
    );
  }

  return (
    <div data-slot="planner-board" className="grid gap-6 p-6 lg:grid-cols-[20rem_1fr]">
      <aside data-slot="planner-palette" className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">Groupings</h2>
        {groupings.map((grouping) => (
          <div key={grouping.id} className="rounded-lg border p-3">
            <ul className="space-y-1 text-sm">
              {grouping.memberIds.map((courseId) => (
                <li key={courseId} data-slot="palette-course">
                  {names[courseId] ?? courseId}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      <PlannerGrid days={days} periods={periods} />
    </div>
  );
}

function PlannerGrid({ days, periods }: { days: number; periods: number }) {
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const periodList = Array.from({ length: periods }, (_, i) => i + 1);

  return (
    <div data-slot="planner-grid" className="overflow-x-auto">
      <div
        className="bg-border grid gap-px rounded-lg"
        style={{ gridTemplateColumns: `auto repeat(${days}, minmax(6rem, 1fr))` }}
      >
        <div className="bg-background p-2" />
        {dayList.map((day) => (
          <div key={day} className="bg-background text-muted-foreground p-2 text-center text-xs font-medium">
            {DAY_LABELS[day - 1] ?? `Day ${day}`}
          </div>
        ))}

        {periodList.map((period) => (
          <PeriodRow key={period} period={period} days={dayList} />
        ))}
      </div>
    </div>
  );
}

function PeriodRow({ period, days }: { period: number; days: number[] }) {
  return (
    <>
      <div className="bg-background text-muted-foreground p-2 text-center text-xs font-medium">P{period}</div>
      {days.map((day) => (
        <div
          key={day}
          data-slot="slot-cell"
          data-day={day}
          data-period={period}
          className={cn("bg-background min-h-16 p-1")}
        />
      ))}
    </>
  );
}
