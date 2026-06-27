import type { HoursStat } from "../../model/hours";
import { cn } from "@/shared/lib/class-names";

type Props = {
  /** placed/required hours for this course; renders nothing when absent. */
  hours?: HoursStat;
};

/**
 * Right-aligned placed/required hours counter shared by the palette chip and the
 * display-only group member row. Renders nothing when hours are unknown; mutes the
 * text once placed equals required.
 */
export default function HoursCounter({ hours }: Props) {
  if (!hours) return null;
  return (
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
  );
}
