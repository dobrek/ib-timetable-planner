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
 * state swaps the placeholder for a filled "N criteria" treatment; below `md` it collapses to the
 * icon (the aria-label keeps the accessible name intact). Spread-friendly so `PopoverTrigger
 * asChild` can wire it as the picker's anchor.
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
      {active ? (
        <span className="hidden font-medium whitespace-nowrap tabular-nums md:inline">
          {criteriaCount} {criteriaCount === 1 ? "criterion" : "criteria"}
        </span>
      ) : (
        <span className="hidden whitespace-nowrap md:inline">Highlight courses, teachers, students…</span>
      )}
      <kbd
        aria-hidden="true"
        className="bg-muted text-muted-foreground pointer-events-none hidden rounded border px-1 font-mono text-[10px] md:inline"
      >
        ⌘K
      </kbd>
    </button>
  );
}
