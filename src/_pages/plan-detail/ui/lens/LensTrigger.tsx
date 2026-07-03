import type { ComponentProps } from "react";
import { Search } from "lucide-react";
import { cn } from "@/shared/lib/class-names";

type Props = ComponentProps<"button"> & {
  /** Committed criteria count — >0 switches the trigger to its filled active treatment. */
  criteriaCount: number;
};

/**
 * The lens's fake-input entry point: a `<button>` styled like a search input (magnifier,
 * placeholder text, `⌘K` kbd hint) so the feature and its shortcut advertise themselves in one
 * element — announced honestly as a button (stable `aria-label`, no focus-trap ambiguity). Active
 * state shows a filled "N criteria" treatment; below `md` it collapses to the icon (the aria-label
 * keeps the accessible name intact). Spread-friendly so `PopoverTrigger asChild` can wire it as
 * the picker's anchor.
 *
 * The trigger's width is FIXED at its empty-state size: the placeholder span always stays in flow
 * (turned `invisible` while active) and the count overlays it, so toggling criteria never resizes
 * the trigger and the top-bar elements to its left don't jump.
 */
export default function LensTrigger({ criteriaCount, className, ...props }: Props) {
  const active = criteriaCount > 0;
  return (
    <button
      type="button"
      data-slot="lens-trigger"
      aria-label="Highlight courses, teachers, students"
      title="Highlight courses, teachers, students (⌘K)"
      className={cn(
        "border-input flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-sm shadow-xs transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
        className,
      )}
      {...props}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <span className="relative hidden md:inline-block">
        {/* Width anchor: always rendered so active/empty occupy the same footprint. */}
        <span aria-hidden={active || undefined} className={cn("whitespace-nowrap", active && "invisible")}>
          Highlight courses, teachers, students…
        </span>
        {active && (
          <span className="absolute inset-y-0 left-0 flex items-center font-medium whitespace-nowrap tabular-nums">
            {criteriaCount} {criteriaCount === 1 ? "criterion" : "criteria"}
          </span>
        )}
      </span>
      <kbd
        aria-hidden="true"
        className="bg-muted text-muted-foreground pointer-events-none hidden rounded border px-1 font-mono text-[10px] md:inline"
      >
        ⌘K
      </kbd>
    </button>
  );
}
