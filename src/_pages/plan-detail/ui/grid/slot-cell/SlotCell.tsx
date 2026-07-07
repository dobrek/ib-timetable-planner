import { useMemo } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/react";
import { cohortLabel, type Cohort, type PlacementWeek } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import {
  cellKey,
  type CellOccupant,
  type CollisionInspectionTarget,
  hasBiweekly,
  partitionByWeek,
} from "@/entities/timetable";
import type { BundleDrag, CellDropData } from "../../../model/drag";
import type { DropHint } from "../../../model/drop-hints";
import type { HintMode } from "../../../lib/drag-hint-mode";
import { resolveCellTone } from "../../../model/collision/cell-tone";
import { toneClass } from "./tone-class";
import { SlotHeader } from "./SlotHeader";
import { PlacedChip, type ChipWiring } from "./PlacedChip";
import { WeekLane } from "./WeekLane";

type Props = {
  day: number;
  period: number;
  /** The cell's cohort — always set (one board, two columns in combined; the single board its one
   *  cohort). Namespaces the dnd ids and stamps the drag/drop data so the shared router routes by it. */
  cohort: Cohort;
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
  /** Combined view (S-06): true while a drag is active over the *other* cohort — recede this cell
   *  as a non-target so accidental cross-cohort drops on adjacent cells are visually discouraged. */
  dimmed?: boolean;
  /** Placement ids matched by the active highlight lens; null = lens inactive. Shared by every
   *  chip in the cell — each `PlacedChip` resolves its own membership. */
  lensMatched: Set<string> | null;
  onRemove: (placementId: string) => void;
  onSetWeek: (placementId: string, week: PlacementWeek) => void;
  onSetOptional: (placementId: string, isOptional: boolean) => void;
  onToggleBundle: (day: number, period: number, bundled: boolean) => void;
  onRemoveBundle: (day: number, period: number) => void;
  onDuplicateBundle: (day: number, period: number) => void;
  onLiftBundle: (day: number, period: number) => void;
  onInspect: (target: CollisionInspectionTarget) => void;
};

/**
 * A droppable time-slot cell. Cells are multi-occupancy — they render every
 * course-hour placed at this `(day, period)`. A cell with any collision gets a
 * destructive outline; conflicting chips are badged. The flag is a reactive derivation,
 * so it clears the instant a participant moves or is removed.
 *
 * Every non-empty cell renders a `SlotHeader` control strip: a duplicate control always, a
 * group/ungroup toggle once it holds >=2 courses, and a bulk-remove trash while bundled. While
 * bundled the whole cell is the drag surface and the per-chip drag/remove affordances go inert.
 */
export default function SlotCell({
  day,
  period,
  cohort,
  occupants,
  dropHint,
  hintActive,
  hintMode,
  bundled,
  justDuplicated,
  dimmed,
  lensMatched,
  onRemove,
  onSetWeek,
  onSetOptional,
  onToggleBundle,
  onRemoveBundle,
  onDuplicateBundle,
  onLiftBundle,
  onInspect,
}: Props) {
  const { setCellRef, isDropTarget, isDragging } = useCellDnd(day, period, bundled, cohort);

  // Cell tone is an exact derivation of the per-occupant flags: `hasBlocking ≡ any occupant
  // blocking`, same for warning — so the cell needs no `CellCollisions` record of its own.
  const hasBlocking = occupants.some((o) => o.blocking);
  const hasWarning = occupants.some((o) => o.warning);
  // Sparse map: no entry while a drag is active means "free"; no active drag means "no hint".
  const hintState = hintActive ? (dropHint ?? "free") : undefined;
  // Every non-empty cell shows the control strip; the toggle only matters once grouping does (>=2).
  const hasOccupants = occupants.length > 0;
  const showToggle = occupants.length >= 2;
  // A single occupant names itself in the duplicate label; a bundle just says "slot".
  const duplicateLabel =
    occupants.length === 1 ? `Duplicate ${occupants[0].name} to next free slot` : "Duplicate slot to next free slot";
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
  const chipWiring: ChipWiring = {
    day,
    period,
    cohort,
    bundled,
    lensMatched,
    onRemove,
    onSetWeek,
    onSetOptional,
    onInspect,
  };

  return (
    <div
      ref={setCellRef}
      data-slot="slot-cell"
      role="gridcell"
      // Named even when empty so an empty drop target is still locatable by role + name. The cohort
      // prefixes the name so the two same-slot DP1|DP2 cells are distinct in combined and a screen
      // reader always announces the column (focus mode names its one cohort too).
      aria-label={`${cohortLabel(cohort)}, ${dayLabel(day)}, ${periodLabel(period)}`}
      className={cn(
        "bg-background flex min-h-16 flex-col gap-1 p-1 transition-colors",
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
        // Sibling-cohort recede during a cross-cohort drag (opacity is not a color token).
        dimmed && "opacity-40",
      )}
    >
      {hasOccupants && (
        <SlotHeader
          day={day}
          period={period}
          bundled={bundled}
          showToggle={showToggle}
          duplicateLabel={duplicateLabel}
          onToggleBundle={onToggleBundle}
          onDuplicateBundle={onDuplicateBundle}
          onLiftBundle={onLiftBundle}
          onRemoveBundle={onRemoveBundle}
        />
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
function useCellDnd(day: number, period: number, bundled: boolean, cohort: Cohort) {
  // Cohort namespaces the dnd ids so two columns sharing day/period space don't collide under one
  // provider (and the single board's one cohort tags identically). The collision/hint map key stays
  // `cellKey` (cohort never enters it) — each column keeps its own Map.
  const key = cellKey(day, period);
  const scopedKey = `${cohort}:${key}`;
  const { ref: dropRef, isDropTarget } = useDroppable<CellDropData>({ id: scopedKey, data: { day, period, cohort } });
  // Whole-slot drag: the entire bundled cell is the drag surface (no handle). We deliberately
  // avoid a handle on the header — dnd-kit's default `preventActivation` short-circuits for any
  // target inside a handle, so header buttons would start a drag instead of clicking. With no
  // handle, the interactive `<button>`s (toggle, trash, conflict badge) are auto-excluded from
  // activation, while grabbing a chip or the cell body moves the slot as one unit. Only active
  // while bundled, so loose chips keep their own per-chip drags.
  const { ref: dragRef, isDragging } = useDraggable<BundleDrag>({
    id: `bundle:${scopedKey}`,
    data: { kind: "bundle", day, period, cohort },
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
