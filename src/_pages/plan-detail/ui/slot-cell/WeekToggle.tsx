import type { PlacementWeek } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";
import { stopDrag } from "./drag-inert";

/**
 * Per-chip A/B control — shown only on a bi-weekly placement (`week ∈ {a,b}`). Moves the chip
 * between lanes by writing its placement week. Stops pointer-down so it never starts a chip drag.
 */
export function WeekToggle({
  week,
  pending,
  onSelect,
}: {
  week: PlacementWeek;
  pending: boolean;
  onSelect: (week: PlacementWeek) => void;
}) {
  return (
    <div
      data-slot="week-toggle"
      role="group"
      aria-label="Week"
      className="border-border flex overflow-hidden rounded border"
    >
      {(["a", "b"] as const).map((option) => (
        <button
          key={option}
          type="button"
          data-slot="week-toggle-option"
          aria-pressed={week === option}
          disabled={pending}
          {...stopDrag(() => {
            onSelect(option);
          })}
          className={cn(
            "px-1 text-xs font-medium uppercase",
            week === option
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
