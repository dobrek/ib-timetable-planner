import { cva } from "class-variance-authority";
import { useDraggable } from "@dnd-kit/react";
import { TriangleAlert, UserX, X } from "lucide-react";
import type { PlacementWeek } from "@/shared/config";
import { Badge, Button } from "@/shared/ui";
import { cn } from "@/shared/lib/class-names";
import type { CollisionInspectionTarget } from "../CollisionDetailsDialog";
import type { CellCollisions } from "../../model/collisions";
import type { PlacementDrag } from "../../model/drag";
import type { LocalPlacement } from "../../model/placement";
import { isBiweekly } from "../../model/week";
import { stopDrag } from "./drag-inert";
import { WeekToggle } from "./WeekToggle";

/**
 * The cell-level data every chip in a cell shares. The chip resolves its own per-course flags
 * (name, blocking/warning/unavailable) from these, so neither `SlotCell` nor `WeekLane` has to
 * thread per-chip props or a `render` callback — each just hands the same wiring to every chip.
 */
export type ChipWiring = {
  day: number;
  period: number;
  names: Record<string, string>;
  /** Flags + structured violations for the cell (undefined when collision-free). */
  collisions: CellCollisions | undefined;
  bundled: boolean;
  onRemove: (placementId: string) => void;
  onSetWeek: (placementId: string, week: PlacementWeek) => void;
  onInspect: (target: CollisionInspectionTarget) => void;
};

/**
 * One placed course-hour. A chip in a blocking violation reads destructive and counts invalid; a
 * warn-only chip reads amber. The collision badge opens the details dialog; the A/B control (only
 * on a bi-weekly placement) moves the chip between week lanes. While the cell is bundled the chip's
 * own drag and remove go inert — the whole slot drags as one unit.
 */
export function PlacedChip({
  placement,
  day,
  period,
  names,
  collisions,
  bundled,
  onRemove,
  onSetWeek,
  onInspect,
}: ChipWiring & { placement: LocalPlacement }) {
  const { ref, isDragging } = useDraggable<PlacementDrag>({
    id: placement.id,
    data: { kind: "placement", placementId: placement.id, courseId: placement.courseId },
    disabled: bundled || placement.pending === true,
  });

  const name = names[placement.courseId] ?? placement.courseId;
  const blocking = collisions?.blockingIds.has(placement.courseId) ?? false;
  const warning = collisions?.warningIds.has(placement.courseId) ?? false;
  const unavailable = collisions?.unavailableIds.has(placement.courseId) ?? false;
  // A bi-weekly placement always resolves to a single week (a/b); agnostic stays `both`.
  const biweekly = isBiweekly(placement.week);

  return (
    <div
      ref={ref}
      data-slot="placed-chip"
      data-course-id={placement.courseId}
      data-conflicted={blocking ? "true" : undefined}
      data-warning={warning && !blocking ? "true" : undefined}
      className={cn(
        chipTone({ tone: blocking ? "blocking" : warning ? "warning" : "neutral" }),
        placement.pending && "opacity-60",
        !placement.pending && !bundled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <span className="truncate">{name}</span>
      {(blocking || warning) && (
        <Badge
          variant={blocking ? "destructive" : "warning"}
          asChild
          data-slot={unavailable ? "unavailable-badge" : "collision-badge"}
          className="cursor-pointer gap-0.5 px-1 py-0"
        >
          <button
            type="button"
            aria-label={unavailable ? "Show teacher-unavailable details" : "Show collision details"}
            {...stopDrag(() => {
              onInspect({ day, period, courseId: placement.courseId });
            })}
          >
            {unavailable ? <UserX className="size-3" /> : <TriangleAlert className="size-3" />}
            <span className="sr-only sm:not-sr-only">{unavailable ? "unavailable" : "collision"}</span>
          </button>
        </Badge>
      )}
      {/* The A/B control gates on week only (it opts out of drag), so a bundled opposite-week
          pair stays adjustable; the remove button stays bundled-gated like before. */}
      {(biweekly || !bundled) && (
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {biweekly && (
            <WeekToggle
              week={placement.week}
              pending={placement.pending === true}
              onSelect={(week) => {
                onSetWeek(placement.id, week);
              }}
            />
          )}
          {!bundled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-slot="remove-placement"
              aria-label={`Remove ${name}`}
              disabled={placement.pending}
              {...stopDrag(() => {
                onRemove(placement.id);
              })}
              className="text-muted-foreground hover:bg-destructive/20 hover:text-destructive size-5 rounded"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** 3-state chip border/bg/text variant, consistent with `badge.tsx`/`button.tsx`. Opacity (pending/
 *  dragging) composes separately — it is not a tone. */
const chipTone = cva("flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs shadow-xs", {
  variants: {
    tone: {
      blocking: "border-destructive bg-destructive/10 text-destructive",
      warning: "border-warning bg-warning/10 text-warning",
      neutral: "bg-secondary text-secondary-foreground",
    },
  },
  defaultVariants: { tone: "neutral" },
});
