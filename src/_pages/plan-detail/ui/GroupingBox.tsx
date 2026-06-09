import { useState } from "react";
import { useDraggable } from "@dnd-kit/react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { Button } from "@/shared/ui";
import type { CourseDrag } from "@/_pages/plan-detail/model/types";
import type { PlannerGrouping } from "@/entities/grouping";
import type { HoursStat } from "@/_pages/plan-detail/model/hours";
import { cn } from "@/shared/lib/cn";

type Props = {
  grouping: PlannerGrouping;
  names: Record<string, string>;
  /** courseId → placed/required hours, recomputed on every placement change. */
  hours: Map<string, HoursStat>;
};

/**
 * A palette hint box: an expandable list of co-runnable member courses. Each course
 * is individually draggable onto the grid — the box never drops as a unit (the course
 * is the unit of placement). Display names are resolved at the edge from `names`.
 */
export default function GroupingBox({ grouping, names, hours }: Props) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div data-slot="grouping-box" className="rounded-lg border">
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setExpanded((value) => !value);
        }}
        className="h-auto w-full justify-start gap-2 px-3 py-2 text-sm font-medium"
      >
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span>{grouping.memberIds.length} courses</span>
      </Button>
      {expanded && (
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
      )}
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
