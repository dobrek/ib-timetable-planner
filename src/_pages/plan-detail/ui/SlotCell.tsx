import { useDraggable, useDroppable } from "@dnd-kit/react";
import { TriangleAlert, X } from "lucide-react";
import { Badge } from "@/shared/ui";
import { Button } from "@/shared/ui";
import type { CollisionInspectionTarget } from "./CollisionDetailsDialog";
import type { CellCollisions } from "../model/collisions";
import { cellKey } from "../model/collisions";
import type { CellData, PlacementDrag } from "../model/drag";
import type { DropHint } from "../model/drop-hints";
import type { HintMode } from "../lib/drag-hint-mode";
import type { LocalPlacement } from "../model/placement";
import { cn } from "@/shared/lib/cn";

type Props = {
  day: number;
  period: number;
  occupants: LocalPlacement[];
  names: Record<string, string>;
  /** Flags + structured violations for this cell (undefined when collision-free). */
  collisions: CellCollisions | undefined;
  /** Drag hint for this cell (undefined = free while a drag is active, or no drag — see `hintActive`). */
  dropHint: DropHint | undefined;
  /** True while any drag is active; distinguishes "free" (undefined hint) from "no drag". */
  hintActive: boolean;
  /** Encoding for the hint: dim the blocked cells, or highlight the free ones. */
  hintMode: HintMode;
  onRemove: (placementId: string) => void;
  onInspect: (target: CollisionInspectionTarget) => void;
};

/**
 * A droppable time-slot cell. Cells are multi-occupancy — they render every
 * course-hour placed at this `(day, period)`. A cell with any collision gets a
 * destructive outline; conflicting chips are badged. The flag is a reactive derivation,
 * so it clears the instant a participant moves or is removed.
 */
export default function SlotCell({
  day,
  period,
  occupants,
  names,
  collisions,
  dropHint,
  hintActive,
  hintMode,
  onRemove,
  onInspect,
}: Props) {
  const { ref, isDropTarget } = useDroppable<CellData>({ id: cellKey(day, period), data: { day, period } });
  const conflicts = collisions?.conflictingIds;
  const hasCollision = (conflicts?.size ?? 0) > 0;
  // Sparse map: no entry while a drag is active means "free"; no active drag means "no hint".
  const hintState = hintActive ? (dropHint ?? "free") : undefined;

  return (
    <div
      ref={ref}
      data-slot="slot-cell"
      data-day={day}
      data-period={period}
      data-collision={hasCollision ? "true" : undefined}
      data-drop-hint={hintState}
      className={cn(
        "bg-background flex min-h-16 flex-col gap-1 p-1 transition-colors",
        // Hint treatment is gated off when hover/collision apply: those rings/bg must win, and
        // since every Tailwind ring sets the same custom property, co-occurrence can't be resolved
        // by className order — so we emit no hint class at all in those cases.
        hintState && !isDropTarget && !hasCollision && HINT_CLASS[hintMode][hintState],
        hasCollision && "ring-destructive ring-2 ring-inset",
        isDropTarget && "bg-accent ring-ring ring-2 ring-inset",
      )}
    >
      {occupants.map((placement) => (
        <PlacedChip
          key={placement.id}
          placement={placement}
          name={names[placement.courseId] ?? placement.courseId}
          conflicted={conflicts?.has(placement.courseId) ?? false}
          onRemove={onRemove}
          onInspect={() => {
            onInspect({ day, period, courseId: placement.courseId });
          }}
        />
      ))}
    </div>
  );
}

function PlacedChip({
  placement,
  name,
  conflicted,
  onRemove,
  onInspect,
}: {
  placement: LocalPlacement;
  name: string;
  conflicted: boolean;
  onRemove: (placementId: string) => void;
  onInspect: () => void;
}) {
  const { ref, isDragging } = useDraggable<PlacementDrag>({
    id: placement.id,
    data: { kind: "placement", placementId: placement.id, courseId: placement.courseId },
    disabled: placement.pending,
  });

  return (
    <div
      ref={ref}
      data-slot="placed-chip"
      data-course-id={placement.courseId}
      data-conflicted={conflicted ? "true" : undefined}
      className={cn(
        "flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs shadow-xs",
        conflicted ? "border-destructive bg-destructive/10 text-destructive" : "bg-secondary text-secondary-foreground",
        placement.pending ? "opacity-60" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <span className="truncate">{name}</span>
      {conflicted && (
        <Badge variant="destructive" asChild data-slot="collision-badge" className="cursor-pointer gap-0.5 px-1 py-0">
          <button
            type="button"
            aria-label="Show collision details"
            onClick={(event) => {
              event.stopPropagation();
              onInspect();
            }}
            onPointerDown={(event) => {
              // Keep the click from starting a drag on the chip.
              event.stopPropagation();
            }}
          >
            <TriangleAlert className="size-3" />
            <span className="sr-only sm:not-sr-only">collision</span>
          </button>
        </Badge>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-slot="remove-placement"
        aria-label={`Remove ${name}`}
        disabled={placement.pending}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(placement.id);
        }}
        onPointerDown={(event) => {
          // Keep the click from starting a drag on the chip.
          event.stopPropagation();
        }}
        className="text-muted-foreground hover:bg-destructive/20 hover:text-destructive ml-auto size-5 rounded"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

/**
 * Per-mode cell treatment for each hint state, token-driven (`--valid`, `--muted`). The
 * derivation is encoding-agnostic — only this table decides which side gets visual ink:
 * `dim-blocked` recedes blocked/partial and leaves free neutral; `highlight-free` tints
 * free with `--valid` and leaves blocked neutral. Empty strings are no-ops in `cn`.
 */
const HINT_CLASS: Record<HintMode, Record<DropHint | "free", string>> = {
  "dim-blocked": {
    free: "",
    partial: "bg-muted/60 opacity-70",
    blocked: "bg-muted opacity-40",
  },
  "highlight-free": {
    free: "bg-valid/10 ring-valid ring-2 ring-inset",
    partial: "bg-valid/5 ring-valid/40 ring-2 ring-inset",
    blocked: "",
  },
};
