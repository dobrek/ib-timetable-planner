import { useDraggable } from "@dnd-kit/react";
import { GripVertical } from "lucide-react";
import HoursCounter from "./HoursCounter";
import PaletteCourseChip from "./PaletteCourseChip";
import { type CourseDisplay, type HoursStat, resolveCourseDisplay } from "@/entities/timetable";
import type { GroupDrag } from "../../model/drag";
import type { PlannerGrouping } from "../../model/grouping/grouping";
import { subjectChipClass, type SubjectColor } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui";
import FinishesEarlyBadge from "../FinishesEarlyBadge";

type Props = {
  grouping: PlannerGrouping;
  courseDisplay: Record<string, CourseDisplay>;
  /** courseId → placed/required hours, recomputed on every placement change. */
  hours: Map<string, HoursStat>;
  /** Plan-scoped `finishes_early` ids — member rows/chips of flagged courses show the cue badge. */
  finishesEarly: Set<string>;
};

/**
 * A palette hint box of co-runnable member courses with a single gesture: grab anywhere on
 * the box to drag the whole group — dropping it fans one placement per member into the target
 * cell. The whole box is the group draggable (no separate handle); the header keeps one grip as
 * the only draggability hint, and member rows are display-only (name + hours, never draggable).
 * A 1-member grouping is effectively a single course, so it renders as a chip instead of a box.
 * The box stays in place while dragging (GroupDragOverlay carries the pointer-following clone).
 * Display names are resolved at the edge from `courseDisplay`.
 */
export default function GroupingBox({ grouping, courseDisplay, hours, finishesEarly }: Props) {
  // While a GroupDragOverlay is mounted for this drag, the Feedback plugin uses the overlay as
  // the moving element and leaves this box in the palette layout, so the isDragging treatment
  // below is the in-place "in use" state.
  const { ref, isDragging } = useDraggable<GroupDrag>({
    id: `grouping:${grouping.id}`,
    data: { kind: "grouping", groupingId: grouping.id },
  });

  if (grouping.memberIds.length === 1) {
    const memberId = grouping.memberIds[0];
    const display = resolveCourseDisplay(courseDisplay, memberId);
    return (
      <PaletteCourseChip
        ref={ref}
        name={display.name}
        color={display.color}
        hours={hours.get(memberId)}
        finishesEarly={finishesEarly.has(memberId)}
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
      <div data-slot="grouping-header" className="flex items-center gap-2 rounded-t-lg px-2 py-1.5 text-xs font-medium">
        <GripVertical className="text-muted-foreground size-4" />
        <span>{grouping.memberIds.length} courses</span>
        {grouping.oppositeWeek && (
          <Badge data-slot="opposite-week-badge" variant="secondary" title="Members run on alternating weeks (A/B)">
            A/B
          </Badge>
        )}
        <span data-slot="students-counter" className="text-muted-foreground ml-auto shrink-0 tabular-nums">
          {grouping.coverageCount} students
        </span>
      </div>
      <ul className="space-y-1 px-2 pb-2">
        {grouping.memberIds.map((courseId) => {
          const display = resolveCourseDisplay(courseDisplay, courseId);
          return (
            <MemberRow
              key={courseId}
              name={display.name}
              color={display.color}
              hours={hours.get(courseId)}
              finishesEarly={finishesEarly.has(courseId)}
            />
          );
        })}
      </ul>
    </div>
  );
}

function MemberRow({
  name,
  color,
  hours,
  finishesEarly,
}: {
  name: string;
  color: SubjectColor | null;
  hours: HoursStat | undefined;
  finishesEarly: boolean;
}) {
  return (
    <li
      data-slot="grouping-member"
      // No base background on the row → the subject pair is a single, safe add (empty when uncolored).
      className={cn("flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs", subjectChipClass(color))}
    >
      <span className="truncate">{name}</span>
      {finishesEarly && <FinishesEarlyBadge />}
      <HoursCounter hours={hours} />
    </li>
  );
}
