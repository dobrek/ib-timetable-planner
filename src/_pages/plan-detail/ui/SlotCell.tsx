import { useMemo } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/react";
import { Link, Trash2, TriangleAlert, Unlink, UserX, X } from "lucide-react";
import { Badge } from "@/shared/ui";
import { Button } from "@/shared/ui";
import type { CollisionInspectionTarget } from "./CollisionDetailsDialog";
import type { CellCollisions } from "../model/collisions";
import { cellKey } from "../model/collisions";
import type { BundleDrag, CellData, PlacementDrag } from "../model/drag";
import type { DropHint } from "../model/drop-hints";
import type { HintMode } from "../lib/drag-hint-mode";
import type { LocalPlacement } from "../model/placement";
import { cn } from "@/shared/lib/class-names";

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
  /** True when this cell behaves as one unit (>=2 occupants, not explicitly ungrouped). */
  bundled: boolean;
  onRemove: (placementId: string) => void;
  onToggleBundle: (day: number, period: number, bundled: boolean) => void;
  onRemoveBundle: (day: number, period: number) => void;
  onInspect: (target: CollisionInspectionTarget) => void;
};

/**
 * A droppable time-slot cell. Cells are multi-occupancy — they render every
 * course-hour placed at this `(day, period)`. A cell with any collision gets a
 * destructive outline; conflicting chips are badged. The flag is a reactive derivation,
 * so it clears the instant a participant moves or is removed.
 *
 * When the cell holds >=2 courses it grows a header strip carrying a group/ungroup toggle
 * and (while bundled) a bulk-remove trash. While bundled the header doubles as the
 * whole-slot drag handle and the per-chip drag/remove affordances go inert.
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
  bundled,
  onRemove,
  onToggleBundle,
  onRemoveBundle,
  onInspect,
}: Props) {
  const { ref: dropRef, isDropTarget } = useDroppable<CellData>({ id: cellKey(day, period), data: { day, period } });
  // Whole-slot drag: the entire bundled cell is the drag surface (no handle). We deliberately
  // avoid a handle on the header — dnd-kit's default `preventActivation` short-circuits for any
  // target inside a handle, so header buttons would start a drag instead of clicking. With no
  // handle, the interactive `<button>`s (toggle, trash, conflict badge) are auto-excluded from
  // activation, while grabbing a chip or the cell body moves the slot as one unit. Only active
  // while bundled, so loose chips keep their own per-chip drags.
  const { ref: dragRef, isDragging } = useDraggable<BundleDrag>({
    id: `bundle:${cellKey(day, period)}`,
    data: { kind: "bundle", day, period },
    disabled: !bundled,
  });
  // The cell is both a droppable and a bundle draggable; merge the two stable callback refs.
  const setCellRef = useMemo(
    () => (node: Element | null) => {
      dropRef(node);
      dragRef(node);
    },
    [dropRef, dragRef],
  );

  const blockingIds = collisions?.blockingIds;
  const warningIds = collisions?.warningIds;
  const unavailable = collisions?.unavailableIds;
  const hasBlocking = (blockingIds?.size ?? 0) > 0;
  const hasWarning = (warningIds?.size ?? 0) > 0;
  // Sparse map: no entry while a drag is active means "free"; no active drag means "no hint".
  const hintState = hintActive ? (dropHint ?? "free") : undefined;
  const hasHeader = occupants.length >= 2;

  return (
    <div
      ref={setCellRef}
      data-slot="slot-cell"
      data-day={day}
      data-period={period}
      data-collision={hasBlocking ? "true" : undefined}
      data-availability={hasWarning && !hasBlocking ? "soft" : undefined}
      data-bundled={bundled ? "true" : undefined}
      data-drop-hint={hintState}
      className={cn(
        "bg-background flex min-h-16 flex-col gap-1 p-1 transition-colors",
        // Hint treatment is gated off when hover/blocking apply: those rings/bg must win, and
        // since every Tailwind ring sets the same custom property, co-occurrence can't be resolved
        // by className order — so we emit no hint class at all in those cases.
        hintState && !isDropTarget && !hasBlocking && HINT_CLASS[hintMode][hintState],
        // Soft-NO amber ring (static; no active drag). Loses to blocking, the drop target, and
        // the active-drag hint — slotted into the same ring ladder as collision.
        hasWarning && !hasBlocking && !isDropTarget && !hintState && "ring-warning bg-warning/5 ring-2 ring-inset",
        // Faint containment cue, gated off so the collision/warn/drop-target rings still win.
        bundled &&
          !hasBlocking &&
          !hasWarning &&
          !isDropTarget &&
          "bg-accent/40 ring-ring rounded-md ring-1 ring-inset",
        // The whole bundled cell is grabbable; interactive children opt out of the drag.
        bundled && "cursor-grab active:cursor-grabbing",
        hasBlocking && "ring-destructive ring-2 ring-inset",
        isDropTarget && "bg-accent ring-ring ring-2 ring-inset",
        isDragging && "opacity-60",
      )}
    >
      {hasHeader && (
        <div data-slot="slot-bundle-header" className="flex items-center justify-between rounded px-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="toggle-bundle"
            aria-label={bundled ? "Ungroup slot" : "Group slot"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleBundle(day, period, bundled);
            }}
            onPointerDown={(event) => {
              // The <button> is auto-excluded from drag activation (dnd-kit's preventActivation
              // treats it as interactive); stopPropagation is just defensive belt-and-braces.
              event.stopPropagation();
            }}
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground size-5 rounded"
          >
            {bundled ? <Link className="size-3.5" /> : <Unlink className="size-3.5" />}
          </Button>
          {bundled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-slot="remove-bundle"
              aria-label="Remove all from slot"
              onClick={(event) => {
                event.stopPropagation();
                onRemoveBundle(day, period);
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              className="text-muted-foreground hover:bg-destructive/20 hover:text-destructive size-5 rounded"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      )}

      {occupants.map((placement) => (
        <PlacedChip
          key={placement.id}
          placement={placement}
          name={names[placement.courseId] ?? placement.courseId}
          blocking={blockingIds?.has(placement.courseId) ?? false}
          warning={warningIds?.has(placement.courseId) ?? false}
          unavailable={unavailable?.has(placement.courseId) ?? false}
          bundled={bundled}
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
  blocking,
  warning,
  unavailable,
  bundled,
  onRemove,
  onInspect,
}: {
  placement: LocalPlacement;
  name: string;
  /** In a blocking violation (collision or strong-NO) — destructive treatment, counts invalid. */
  blocking: boolean;
  /** In a warn violation only (soft-NO) — amber treatment, non-blocking. */
  warning: boolean;
  /** Flagged by a teacher-unavailable violation — distinguishes the badge from a plain collision. */
  unavailable: boolean;
  bundled: boolean;
  onRemove: (placementId: string) => void;
  onInspect: () => void;
}) {
  const { ref, isDragging } = useDraggable<PlacementDrag>({
    id: placement.id,
    data: { kind: "placement", placementId: placement.id, courseId: placement.courseId },
    disabled: bundled || placement.pending === true,
  });

  return (
    <div
      ref={ref}
      data-slot="placed-chip"
      data-course-id={placement.courseId}
      data-conflicted={blocking ? "true" : undefined}
      data-warning={warning && !blocking ? "true" : undefined}
      className={cn(
        "flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs shadow-xs",
        blocking
          ? "border-destructive bg-destructive/10 text-destructive"
          : warning
            ? "border-warning bg-warning/10 text-warning"
            : "bg-secondary text-secondary-foreground",
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
            onClick={(event) => {
              event.stopPropagation();
              onInspect();
            }}
            onPointerDown={(event) => {
              // Keep the click from starting a drag on the chip.
              event.stopPropagation();
            }}
          >
            {unavailable ? <UserX className="size-3" /> : <TriangleAlert className="size-3" />}
            <span className="sr-only sm:not-sr-only">{unavailable ? "unavailable" : "collision"}</span>
          </button>
        </Badge>
      )}
      {!bundled && (
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
      )}
    </div>
  );
}

/**
 * Per-mode cell treatment for each hint state, token-driven (`--valid`, `--warning`,
 * `--muted`). The derivation is encoding-agnostic — only this table decides which side gets
 * visual ink: `dim-blocked` recedes blocked/partial and leaves free neutral; `highlight-free`
 * tints free with `--valid` and leaves blocked neutral. `warn` (soft-NO, a valid-but-advisory
 * drop) always reads amber, never dimmed. Empty strings are no-ops in `cn`.
 */
const HINT_CLASS: Record<HintMode, Record<DropHint | "free", string>> = {
  "dim-blocked": {
    free: "",
    warn: "bg-warning/10 ring-warning/40 ring-2 ring-inset",
    partial: "bg-muted/60 opacity-70",
    blocked: "bg-muted opacity-40",
  },
  "highlight-free": {
    free: "bg-valid/10 ring-valid ring-2 ring-inset",
    warn: "bg-warning/10 ring-warning/50 ring-2 ring-inset",
    partial: "bg-valid/5 ring-valid/40 ring-2 ring-inset",
    blocked: "",
  },
};
