import type { ReactNode } from "react";
import { Button } from "@/shared/ui";
import { cn } from "@/shared/lib/class-names";
import { stopDrag } from "../../../lib/drag-inert";

/** Hover tone for a header control: a neutral accent, or the destructive red for remove. */
type Tone = "accent" | "destructive";

const TONE_CLASS: Record<Tone, string> = {
  accent: "hover:bg-accent hover:text-accent-foreground",
  destructive: "hover:bg-destructive/20 hover:text-destructive",
};

type Props = {
  /** Accessible name — the only label a header control exposes (icon-only). */
  label: string;
  dataSlot: string;
  onClick: () => void;
  /** Defaults to the neutral accent; remove controls pass `"destructive"`. */
  tone?: Tone;
  /** The lucide icon. */
  children: ReactNode;
};

/**
 * The one ghost-icon button every slot-header control is built from — a single home for the
 * shared shape (size, semantic tokens, the `stopDrag` wrapper that keeps a click from starting
 * the whole-slot drag). Each control (`SlotHeader`) is then just an icon + label + handler.
 */
export function SlotHeaderButton({ label, dataSlot, onClick, tone = "accent", children }: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      data-slot={dataSlot}
      aria-label={label}
      {...stopDrag(onClick)}
      className={cn("text-muted-foreground size-5 rounded", TONE_CLASS[tone])}
    >
      {children}
    </Button>
  );
}
