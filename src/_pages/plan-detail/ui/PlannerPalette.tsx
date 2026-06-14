import { useMemo, useState } from "react";
import GroupingBox from "./GroupingBox";
import GroupingFilter from "./GroupingFilter";
import { sortGroupingsForPalette } from "../model/sort-groupings";
import type { PlannerGrouping } from "../model/grouping";
import type { HoursStat } from "../model/hours";

type PlannerPaletteProps = {
  groupings: PlannerGrouping[];
  names: Record<string, string>;
  hours: Map<string, HoursStat>;
};

/**
 * The palette aside: a leading-course filter over a scrollable list of grouping hint
 * boxes. The filter is purely a rendering concern — nothing outside the palette reads
 * it — so both the selection state and the membership filter live here.
 */
export default function PlannerPalette({ groupings, names, hours }: PlannerPaletteProps) {
  const sortedGroupings = useMemo(() => sortGroupingsForPalette(groupings), [groupings]);
  const { leadingCourseId, setLeadingCourseId, visibleGroupings } = useLeadingFilter(sortedGroupings);

  return (
    <aside data-slot="planner-palette" className="flex min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <GroupingFilter groupings={groupings} names={names} value={leadingCourseId} onChange={setLeadingCourseId} />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {visibleGroupings.map((grouping) => (
          <GroupingBox key={grouping.id} grouping={grouping} names={names} hours={hours} />
        ))}
      </div>
    </aside>
  );
}

function useLeadingFilter(groupings: PlannerGrouping[]) {
  const [leadingCourseId, setLeadingCourseId] = useState<string | null>(null);
  const visibleGroupings = leadingCourseId
    ? groupings.filter((grouping) => grouping.memberIds.includes(leadingCourseId))
    : groupings;
  return { leadingCourseId, setLeadingCourseId, visibleGroupings };
}
