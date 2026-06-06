import { useState } from "react";
import { useDraggable } from "@dnd-kit/react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { CourseDrag, PlannerGrouping } from "@/components/planner/types";
import { cn } from "@/lib/utils";

type Props = {
  grouping: PlannerGrouping;
  names: Record<string, string>;
};

/**
 * A palette hint box: an expandable list of co-runnable member courses. Each course
 * is individually draggable onto the grid — the box never drops as a unit (the course
 * is the unit of placement). Display names are resolved at the edge from `names`.
 */
export default function GroupingBox({ grouping, names }: Props) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div data-slot="grouping-box" className="rounded-lg border">
      <button
        type="button"
        onClick={() => {
          setExpanded((value) => !value);
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
      >
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span>{grouping.memberIds.length} courses</span>
      </button>
      {expanded && (
        <ul className="space-y-1 px-2 pb-2">
          {grouping.memberIds.map((courseId) => (
            <PaletteCourse
              key={courseId}
              groupingId={grouping.id}
              courseId={courseId}
              name={names[courseId] ?? courseId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PaletteCourse({ groupingId, courseId, name }: { groupingId: string; courseId: string; name: string }) {
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
    </li>
  );
}
