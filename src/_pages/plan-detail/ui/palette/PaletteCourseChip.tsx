import { GripVertical } from "lucide-react";
import type { Ref } from "react";
import { subjectChipClass, type SubjectColor } from "@/shared/config";
import HoursCounter from "./HoursCounter";
import type { HoursStat } from "@/entities/timetable";
import { cn } from "@/shared/lib/class-names";
import FinishesEarlyBadge from "../FinishesEarlyBadge";

type Props = {
  name: string;
  /** placed/required hours for this course; the counter is omitted when absent. */
  hours?: HoursStat;
  /** Optional subject color; when set its bg/text pair replaces the chip's `bg-background`. */
  color?: SubjectColor | null;
  /** Course flagged `finishes_early` — shows the day-edge cue badge. */
  finishesEarly?: boolean;
  isDragging: boolean;
  ref?: Ref<HTMLDivElement>;
};

/**
 * Presentational palette chip for a single placeable course: a grip, a truncated
 * name, and an optional placed/required hours counter. Holds no drag logic — each
 * caller owns its `useDraggable` and forwards `ref` (React 19 ref-as-prop) plus
 * `isDragging`. Shared by the filter-promoted single chip and singleton (1-member)
 * groupings so a single course reads identically wherever it appears. The
 * `isDragging` opacity is the in-place "in use" treatment while the drag clone
 * follows the pointer.
 */
export default function PaletteCourseChip({ name, hours, color, finishesEarly, isDragging, ref }: Props) {
  return (
    <div
      ref={ref}
      data-slot="palette-course-chip"
      className={cn(
        // The subject pair replaces `bg-background` (single bg) when a color is set.
        color ? subjectChipClass(color) : "bg-background",
        "flex cursor-grab items-center gap-1 rounded-md border px-1.5 py-1 text-xs shadow-xs",
        // Neutral hover only when uncolored; a colored chip keeps its subject pair on hover.
        color ? "active:cursor-grabbing" : "hover:bg-accent hover:text-accent-foreground active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <GripVertical className="text-muted-foreground size-4" />
      <span className="truncate">{name}</span>
      {finishesEarly && <FinishesEarlyBadge />}
      <HoursCounter hours={hours} />
    </div>
  );
}
