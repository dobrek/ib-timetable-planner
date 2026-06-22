import type { PlacementWeek } from "@/shared/config";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui";

const WEEK_OPTIONS = [
  { value: "a", label: "Week A" },
  { value: "b", label: "Week B" },
] as const;

/**
 * Per-chip A/B control — shown only on a bi-weekly placement (`week ∈ {a,b}`). Moves the chip
 * between lanes by writing its placement week. A `ToggleGroup type="single"` exposes proper
 * `radiogroup`/`radio` semantics, arrow-key nav, and focus-visible rings. Pointer-down is stopped
 * on the group so grabbing it never starts a chip drag (selection flows through `onValueChange`,
 * not a click, so no `onClick` stop is needed).
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
    <ToggleGroup
      type="single"
      value={week}
      onValueChange={(value) => {
        // Radix emits "" when the active item is re-pressed; ignore it — a week is never cleared.
        if (value === "a" || value === "b") onSelect(value);
      }}
      data-slot="week-toggle"
      aria-label="Week"
      onPointerDown={(event: React.PointerEvent<HTMLDivElement>) => {
        event.stopPropagation();
      }}
    >
      {WEEK_OPTIONS.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={option.label}
          disabled={pending}
          size="xs"
          className="uppercase"
        >
          {option.value}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
