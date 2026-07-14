import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/shared/ui";

/**
 * The "what am I looking at?" affordance for the blocks whose names do not explain themselves.
 *
 * These figures came out of the analyzer, not out of a timetabling vocabulary anyone shares — a reader
 * meeting "span efficiency" or "mirrored cells" for the first time cannot act on them, and a number
 * nobody can interpret is indistinguishable from a number nobody should trust. The copy is written from
 * the analyzer's source, so it states the actual formula rather than a plausible-sounding gloss.
 *
 * It explains; it still does not judge. No "good"/"bad" thresholds — the page reports, the expert reads.
 */
export function MetricHelp({ title, children }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          // The icon is decorative; the accessible name has to carry the whole affordance, because a
          // screen-reader user gets no shape to infer it from.
          aria-label={`What does "${title}" mean?`}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex cursor-pointer items-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
        >
          <Info aria-hidden="true" className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96">
        <PopoverHeader>
          <PopoverTitle>{title}</PopoverTitle>
        </PopoverHeader>
        <div className="text-muted-foreground mt-3 space-y-2 text-sm">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

type Props = { title: string; children: ReactNode };
