import { useMemo } from "react";
import GroupingBox from "@/components/planner/GroupingBox";
import GroupingFilter from "@/components/planner/GroupingFilter";
import type { PlannerGrouping } from "@/components/planner/types";
import type { HoursStat } from "@/lib/planner/hours";

type PlannerPaletteProps = {
  groupings: PlannerGrouping[];
  names: Record<string, string>;
  hours: Map<string, HoursStat>;
  leadingCourseId: string | null;
  onLeadingChange: (courseId: string | null) => void;
};

/**
 * The palette aside: a leading-course filter over a scrollable list of grouping hint
 * boxes. The membership filter is purely a rendering concern, so it lives here.
 */
export default function PlannerPalette({
  groupings,
  names,
  hours,
  leadingCourseId,
  onLeadingChange,
}: PlannerPaletteProps) {
  const visibleGroupings = useMemo(
    () => (leadingCourseId ? groupings.filter((g) => g.memberIds.includes(leadingCourseId)) : groupings),
    [groupings, leadingCourseId],
  );

  return (
    <aside data-slot="planner-palette" className="flex min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <GroupingFilter groupings={groupings} names={names} value={leadingCourseId} onChange={onLeadingChange} />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {visibleGroupings.map((grouping) => (
          <GroupingBox key={grouping.id} grouping={grouping} names={names} hours={hours} />
        ))}
      </div>
    </aside>
  );
}
