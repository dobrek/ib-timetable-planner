import { useDraggable, useDroppable } from "@dnd-kit/react";
import { X } from "lucide-react";
import type { CellData, LocalPlacement, PlacementDrag } from "@/components/planner/types";
import { cn } from "@/lib/utils";

type Props = {
  day: number;
  period: number;
  occupants: LocalPlacement[];
  names: Record<string, string>;
  onRemove: (placementId: string) => void;
};

/**
 * A droppable time-slot cell. Cells are multi-occupancy — they render every
 * course-hour placed at this `(day, period)`. Phase 4 adds the collision outline.
 */
export default function SlotCell({ day, period, occupants, names, onRemove }: Props) {
  const { ref, isDropTarget } = useDroppable<CellData>({ id: `${day}:${period}`, data: { day, period } });

  return (
    <div
      ref={ref}
      data-slot="slot-cell"
      data-day={day}
      data-period={period}
      className={cn(
        "bg-background flex min-h-16 flex-col gap-1 p-1 transition-colors",
        isDropTarget && "bg-accent ring-ring ring-2 ring-inset",
      )}
    >
      {occupants.map((placement) => (
        <PlacedChip
          key={placement.id}
          placement={placement}
          name={names[placement.courseId] ?? placement.courseId}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function PlacedChip({
  placement,
  name,
  onRemove,
}: {
  placement: LocalPlacement;
  name: string;
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
      className={cn(
        "bg-secondary text-secondary-foreground flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs shadow-xs",
        placement.pending ? "opacity-60" : "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <span className="truncate">{name}</span>
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
