import { useMemo } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/react";
import { Copy, Link, Trash2, Unlink } from "lucide-react";
import type { PlacementWeek } from "@/shared/config";
import { Button } from "@/shared/ui";
import { cn } from "@/shared/lib/class-names";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import type { CollisionInspectionTarget } from "../CollisionDetailsDialog";
import { cellKey } from "../../model/collisions";
import type { CellOccupant } from "../../model/cell-occupants";
import type { BundleDrag, CellData } from "../../model/drag";
import type { DropHint } from "../../model/drop-hints";
import type { HintMode } from "../../lib/drag-hint-mode";
import { resolveCellTone } from "../../model/cell-tone";
import { hasBiweekly, partitionByWeek } from "../../model/week";
import { toneClass } from "./tone-class";
import { stopDrag } from "./drag-inert";
import { PlacedChip, type ChipWiring } from "./PlacedChip";
import { WeekLane } from "./WeekLane";

type Props = {
  day: number;
  period: number;
  occupants: CellOccupant[];
  /** Drag hint for this cell (undefined = free while a drag is active, or no drag — see `hintActive`). */
  dropHint: DropHint | undefined;
  /** True while any drag is active; distinguishes "free" (undefined hint) from "no drag". */
  hintActive: boolean;
  /** Encoding for the hint: dim the blocked cells, or highlight the free ones. */
  hintMode: HintMode;
  /** True when this cell behaves as one unit (>=2 occupants, not explicitly ungrouped). */
  bundled: boolean;
  /** True for the cell a duplicate just landed on — drives a one-shot highlight pulse. */
  justDuplicated: boolean;
  onRemove: (placementId: string) => void;
  onSetWeek: (placementId: string, week: PlacementWeek) => void;
  onToggleBundle: (day: number, period: number, bundled: boolean) => void;
  onRemoveBundle: (day: number, period: number) => void;
  onDuplicateBundle: (day: number, period: number) => void;
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
  dropHint,
  hintActive,
  hintMode,
  bundled,
  justDuplicated,
  onRemove,
  onSetWeek,
  onToggleBundle,
  onRemoveBundle,
  onDuplicateBundle,
  onInspect,
}: Props) {
  const { setCellRef, isDropTarget, isDragging } = useCellDnd(day, period, bundled);

  // Cell tone is an exact derivation of the per-occupant flags: `hasBlocking ≡ any occupant
  // blocking`, same for warning — so the cell needs no `CellCollisions` record of its own.
  const hasBlocking = occupants.some((o) => o.blocking);
  const hasWarning = occupants.some((o) => o.warning);
  // Sparse map: no entry while a drag is active means "free"; no active drag means "no hint".
  const hintState = hintActive ? (dropHint ?? "free") : undefined;
  const hasHeader = occupants.length >= 2;
  // Progressive disclosure: lanes appear only once a bi-weekly placement is present; the
  // ~95% agnostic-only cell renders via the unchanged flat path.
  const biweekly = hasBiweekly(occupants, (o) => o.placement.week);
  // One pass groups occupants by week, replacing three inline `.filter()` re-scans of the same
  // array. Only computed for the lane branch — the ~95% agnostic-only cell skips the allocation.
  const byWeek = biweekly ? partitionByWeek(occupants, (o) => o.placement.week) : null;
  // One ordered, exhaustive precedence resolution replaces the negated-class ladder; the
  // opacity axis (`isDragging`) and the grab cursor compose separately below.
  const tone = resolveCellTone({ hasBlocking, isDropTarget, hasWarning, hintState, bundled });
  // The cell-level handlers shared by every chip. Each chip carries its own resolved
  // `CellOccupant` (name + flags), so this wiring holds only the slot-level identity + callbacks.
  // NOTE: this is a fresh object each render, so it would defeat a `React.memo(PlacedChip)` —
  // stabilize it (e.g. `useMemo` in a named hook) before adding that memo, or the memo no-ops.
  const chipWiring: ChipWiring = { day, period, bundled, onRemove, onSetWeek, onInspect };

  return (
    <div
      ref={setCellRef}
      data-slot="slot-cell"
      role="gridcell"
      // Named even when empty so an empty drop target is still locatable by role + name.
      aria-label={`${dayLabel(day)}, ${periodLabel(period)}`}
      className={cn(
        // `relative` anchors the single-occupant duplicate control absolutely within the cell.
        "bg-background relative flex min-h-16 flex-col gap-1 p-1 transition-colors",
        // One tone, resolved once with ordered precedence — no negated-class ladder.
        toneClass(tone, hintMode),
        // The whole bundled cell is grabbable; interactive children opt out of the drag. This is
        // an interaction affordance, not a tone, so it composes independently of the cell tone.
        bundled && "cursor-grab active:cursor-grabbing",
        // Opacity axis is independent of tone: a dragging origin cell dims regardless of its tone.
        isDragging && "opacity-60",
        // One-shot "the copy landed here" highlight (semantic ring token). Pulse is motion-safe;
        // reduced-motion keeps the static ring. Self-clears when the board drops the highlight.
        justDuplicated && "ring-ring ring-2 ring-inset motion-safe:animate-pulse",
      )}
    >
      {hasHeader && (
        <div data-slot="bundle-header" className="flex items-center justify-between rounded px-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="toggle-bundle"
            aria-label={bundled ? "Ungroup slot" : "Group slot"}
            {...stopDrag(() => {
              onToggleBundle(day, period, bundled);
            })}
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground size-5 rounded"
          >
            {bundled ? <Link className="size-3.5" /> : <Unlink className="size-3.5" />}
          </Button>
          {/* Duplicate + (bundled-only) trash group at the right. Unlike the trash, the duplicate
              button shows for EVERY ≥2 cell — grouped or exploded — so ungrouping never hides it. */}
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-slot="duplicate-bundle"
              aria-label="Duplicate slot to next free slot"
              {...stopDrag(() => {
                onDuplicateBundle(day, period);
              })}
              className="text-muted-foreground hover:bg-accent hover:text-accent-foreground size-5 rounded"
            >
              <Copy className="size-3.5" />
            </Button>
            {bundled && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-slot="remove-bundle"
                aria-label="Remove all from slot"
                {...stopDrag(() => {
                  onRemoveBundle(day, period);
                })}
                className="text-muted-foreground hover:bg-destructive/20 hover:text-destructive size-5 rounded"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}

      {byWeek ? (
        <div data-slot="week-lanes" className="flex flex-col gap-1">
          {/* Agnostic occupants run every week → rendered above the lanes, spanning both. */}
          {byWeek.both.map((occupant) => (
            <PlacedChip key={occupant.placement.id} occupant={occupant} {...chipWiring} />
          ))}
          <WeekLane label="A" chips={byWeek.a} wiring={chipWiring} />
          <WeekLane label="B" chips={byWeek.b} wiring={chipWiring} />
        </div>
      ) : (
        occupants.map((occupant) => <PlacedChip key={occupant.placement.id} occupant={occupant} {...chipWiring} />)
      )}

      {/* Single-occupant cells have no header; the duplicate affordance is an always-visible sibling
          control (never a PlacedChip prop), parked in the cell's free bottom-right so it doesn't
          overlap the chip's remove/A-B controls. */}
      {occupants.length === 1 && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-slot="duplicate-single"
          aria-label={`Duplicate ${occupants[0].name} to next free slot`}
          {...stopDrag(() => {
            onDuplicateBundle(day, period);
          })}
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground absolute right-0.5 bottom-0.5 size-5 rounded"
        >
          <Copy className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

/**
 * The cell's dnd-kit integration as one named behavioral flow. The cell is both a droppable and
 * (while bundled) the whole-slot bundle draggable; this hook owns both registrations and the
 * merged ref, returning the merged callback plus the two reactive flags. Extracting it keeps the
 * component body declarative — no raw `useMemo` — and names the dnd flow the way the slice's
 * design goals ask for.
 */
function useCellDnd(day: number, period: number, bundled: boolean) {
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
  // Kept local (a single consumer today) per "promote on second consumer".
  const setCellRef = useMemo(() => mergeRefs(dropRef, dragRef), [dropRef, dragRef]);
  return { setCellRef, isDropTarget, isDragging };
}

/** Merge several dnd-kit callback refs into one — local to `useCellDnd`'s two-ref cell. */
const mergeRefs =
  (...refs: ((node: Element | null) => void)[]) =>
  (node: Element | null) => {
    for (const ref of refs) ref(node);
  };
