import { useDraggable } from "@dnd-kit/react";
import { GripVertical } from "lucide-react";
import HoursCounter from "./HoursCounter";
import PaletteCourseChip from "./PaletteCourseChip";
import type { GroupDrag } from "../model/drag";
import type { PlannerGrouping } from "../model/grouping";
import type { HoursStat } from "../model/hours";
import { cn } from "@/shared/lib/class-names";

type Props = {
  grouping: PlannerGrouping;
  names: Record<string, string>;
  /** courseId → placed/required hours, recomputed on every placement change. */
  hours: Map<string, HoursStat>;
};

/**
 * A palette hint box of co-runnable member courses with a single gesture: grab anywhere on
 * the box to drag the whole group — dropping it fans one placement per member into the target
 * cell. The whole box is the group draggable (no separate handle); the header keeps one grip as
 * the only draggability hint, and member rows are display-only (name + hours, never draggable).
 * A 1-member grouping is effectively a single course, so it renders as a chip instead of a box.
 * The box stays in place while dragging (GroupDragOverlay carries the pointer-following clone).
 * Display names are resolved at the edge from `names`.
 */
export default function GroupingBox({ grouping, names, hours }: Props) {
  // While a GroupDragOverlay is mounted for this drag, the Feedback plugin uses the overlay as
  // the moving element and leaves this box in the palette layout, so the isDragging treatment
  // below is the in-place "in use" state.
  const { ref, isDragging } = useDraggable<GroupDrag>({
    id: `grouping:${grouping.id}`,
    data: { kind: "grouping", groupingId: grouping.id },
  });

  if (grouping.memberIds.length === 1) {
    const memberId = grouping.memberIds[0];
    return (
      <PaletteCourseChip
        ref={ref}
        name={names[memberId] ?? memberId}
        hours={hours.get(memberId)}
        isDragging={isDragging}
      />
    );
  }

  return (
    <div
      ref={ref}
      data-slot="grouping-box"
      className={cn(
        "bg-background cursor-grab rounded-lg border active:cursor-grabbing",
        "hover:bg-accent hover:text-accent-foreground",
        isDragging && "border-dashed opacity-60",
      )}
    >
      <div data-slot="grouping-header" className="flex items-center gap-2 rounded-t-lg px-3 py-2 text-sm font-medium">
        <GripVertical className="text-muted-foreground size-4" />
        <span>{grouping.memberIds.length} courses</span>
        <span data-slot="students-counter" className="text-muted-foreground ml-auto shrink-0 tabular-nums">
          {grouping.coverageCount} students
        </span>
      </div>
      <ul className="space-y-1 px-2 pb-2">
        {grouping.memberIds.map((courseId) => (
          <MemberRow key={courseId} name={names[courseId] ?? courseId} hours={hours.get(courseId)} />
        ))}
      </ul>
    </div>
  );
}

function MemberRow({ name, hours }: { name: string; hours: HoursStat | undefined }) {
  return (
    <li data-slot="grouping-member" className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
      <span className="truncate">{name}</span>
      <HoursCounter hours={hours} />
    </li>
  );
}
