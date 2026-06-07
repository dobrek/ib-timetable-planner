import { useDraggable, useDroppable } from "@dnd-kit/react";
import { TriangleAlert, X } from "lucide-react";
import { cellKey } from "@/lib/planner/collisions";
import type { CellData, LocalPlacement, PlacementDrag } from "@/components/planner/types";
import { cn } from "@/lib/utils";

type Props = {
  day: number;
  period: number;
  occupants: LocalPlacement[];
  names: Record<string, string>;
  /** Course ids in collision within this cell (undefined when none). */
  conflicts: Set<string> | undefined;
  onRemove: (placementId: string) => void;
};

/**
 * A droppable time-slot cell. Cells are multi-occupancy — they render every
 * course-hour placed at this `(day, period)`. A cell with any collision gets a
 * destructive outline; conflicting chips are badged. The flag is a reactive derivation,
 * so it clears the instant a participant moves or is removed.
 */
export default function SlotCell({ day, period, occupants, names, conflicts, onRemove }: Props) {
  const { ref, isDropTarget } = useDroppable<CellData>({ id: cellKey(day, period), data: { day, period } });
  const hasCollision = (conflicts?.size ?? 0) > 0;

  return (
    <div
      ref={ref}
      data-slot="slot-cell"
      data-day={day}
      data-period={period}
      data-collision={hasCollision ? "true" : undefined}
      className={cn(
        "bg-background flex min-h-16 flex-col gap-1 p-1 transition-colors",
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
}: {
  placement: LocalPlacement;
  name: string;
  conflicted: boolean;
  onRemove: (placementId: string) => void;
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
        <span
          data-slot="collision-badge"
          title="Collision: shares a student or teacher with another course in this slot"
          className="text-destructive inline-flex items-center gap-0.5 font-medium"
        >
          <TriangleAlert className="size-4" />
          <span className="sr-only sm:not-sr-only">collision</span>
        </span>
      )}
      <button
        type="button"
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
        className="hover:bg-destructive/20 ml-auto rounded p-0.5 disabled:opacity-50"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
