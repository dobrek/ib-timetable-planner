import { useDraggable } from "@dnd-kit/react";
import { GripVertical } from "lucide-react";
import type { CourseDrag, GroupDrag } from "../model/drag";
import type { PlannerGrouping } from "../model/grouping";
import type { HoursStat } from "../model/hours";
import { cn } from "@/shared/lib/cn";

type Props = {
  grouping: PlannerGrouping;
  names: Record<string, string>;
  /** courseId → placed/required hours, recomputed on every placement change. */
  hours: Map<string, HoursStat>;
};

/**
 * A palette hint box of co-runnable member courses, with two drag affordances:
 * each course row drags individually onto the grid, and the header drags the
 * whole group — dropping it fans one placement per member into the target cell.
 * The box is the group draggable with the header as its handle; it stays in
 * place while dragging (GroupDragOverlay carries the pointer-following clone).
 * Display names are resolved at the edge from `names`.
 */
export default function GroupingBox({ grouping, names, hours }: Props) {
  // While a GroupDragOverlay is mounted for this drag, the Feedback plugin uses
  // the overlay as the moving element and leaves this box in the palette layout,
  // so the isDragging treatment below is the in-place "in use" state.
  const { ref, handleRef, isDragging } = useDraggable<GroupDrag>({
    id: `grouping:${grouping.id}`,
    data: { kind: "grouping", groupingId: grouping.id },
  });

  return (
    <div
      ref={ref}
      data-slot="grouping-box"
      className={cn("bg-background rounded-lg border", isDragging && "border-dashed opacity-60")}
    >
      <div
        ref={handleRef}
        data-slot="grouping-header"
        className={cn(
          "flex cursor-grab items-center gap-2 rounded-t-lg px-3 py-2 text-sm font-medium",
          "hover:bg-accent hover:text-accent-foreground active:cursor-grabbing",
        )}
      >
        <GripVertical className="text-muted-foreground size-4" />
        <span>{grouping.memberIds.length} courses</span>
      </div>
      <ul className="space-y-1 px-2 pb-2">
        {grouping.memberIds.map((courseId) => (
          <PaletteCourse
            key={courseId}
            groupingId={grouping.id}
            courseId={courseId}
            name={names[courseId] ?? courseId}
            hours={hours.get(courseId)}
          />
        ))}
      </ul>
    </div>
  );
}

function PaletteCourse({
  groupingId,
  courseId,
  name,
  hours,
}: {
  groupingId: string;
  courseId: string;
  name: string;
  hours: HoursStat | undefined;
}) {
  const { ref, isDragging } = useDraggable<CourseDrag>({
    id: `palette:${groupingId}:${courseId}`,
    data: { kind: "course", courseId },
  });

  return (
    <li
      ref={ref}
      data-slot="palette-course"
      className={cn(
        "bg-background flex cursor-grab items-center gap-2 rounded-md border px-2 py-1.5 text-sm shadow-xs",
        "hover:bg-accent hover:text-accent-foreground active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <GripVertical className="text-muted-foreground size-4" />
      <span className="truncate">{name}</span>
      {hours && (
        <span
          data-slot="hours-counter"
          title="Hours placed / required"
          className={cn(
            "ml-auto shrink-0 tabular-nums",
            hours.placed === hours.required ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {hours.placed}/{hours.required}
        </span>
      )}
    </li>
  );
}
