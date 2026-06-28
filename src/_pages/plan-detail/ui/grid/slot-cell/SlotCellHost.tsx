import type { Cohort, PlacementWeek } from "@/shared/config";
import type { CollisionInspectionTarget } from "../../overlay/CollisionDetailsDialog";
import SlotCell from "./SlotCell";
import { cellKey } from "../../../model/collision/cell-key";
import type { CellOccupant } from "../../../model/collision/cell-occupants";
import type { CellData } from "../../../model/drag";
import type { DropHint } from "../../../model/drop-hints";
import type { HintMode } from "../../../lib/drag-hint-mode";
import { isBundled } from "../../../model/exploded-cells";

/**
 * The cell wiring shared by every grid that renders cells — handlers plus the cell-level drag-hint
 * state. Declared once here (lifted out of `PlannerGrid`) so the single-cohort `PlannerGrid` and the
 * combined `PairedPlannerGrid` both feed `SlotCellHost` the same shape. Per-cell data (occupants,
 * the resolved hint) is added on top at each level.
 */
export type CellWiring = {
  /** cellKey → drag hint (sparse: absent = free); null when no drag is active. */
  dropHints: Map<string, DropHint> | null;
  /** Encoding for the hint cells while a drag is active. */
  hintMode: HintMode;
  /** Is `(day, period)` currently exploded (ungrouped view)? Drives the per-cell `bundled` derivation. */
  isExploded: (day: number, period: number) => boolean;
  /** The cell a duplicate just landed on (with a nonce), or null; the matching cell pulses. */
  justDuplicated: (CellData & { nonce: number }) | null;
  onRemove: (placementId: string) => void;
  onSetWeek: (placementId: string, week: PlacementWeek) => void;
  onToggleBundle: (day: number, period: number, bundled: boolean) => void;
  onRemoveBundle: (day: number, period: number) => void;
  onDuplicateBundle: (day: number, period: number) => void;
  onLiftBundle: (day: number, period: number) => void;
  onInspect: (target: CollisionInspectionTarget) => void;
};

/**
 * One slot's `SlotCell` plus its per-cell derivation: the drop-hint lookup + `hintActive`, the
 * `bundled` flag, and the `justDuplicated` pulse-key match. Extracting it keeps the cell plumbing in
 * one place so neither `PlannerGrid`'s `PeriodRow` nor the combined `PairedPlannerGrid` re-inlines
 * it. `cohort` (always set) namespaces the dnd ids; `dimmed` recedes a sibling-cohort cell during a
 * cross-cohort drag (combined only — absent/false on the single-cohort board).
 */
export function SlotCellHost({
  day,
  period,
  cohort,
  occupants,
  dimmed,
  dropHints,
  hintMode,
  isExploded,
  justDuplicated,
  onRemove,
  onSetWeek,
  onToggleBundle,
  onRemoveBundle,
  onDuplicateBundle,
  onLiftBundle,
  onInspect,
}: CellWiring & {
  day: number;
  period: number;
  cohort: Cohort;
  occupants: CellOccupant[];
  dimmed?: boolean;
}) {
  const key = cellKey(day, period);
  return (
    <SlotCell
      day={day}
      period={period}
      cohort={cohort}
      occupants={occupants}
      dropHint={dropHints?.get(key)}
      hintActive={dropHints !== null}
      hintMode={hintMode}
      bundled={isBundled(occupants.length, isExploded(day, period))}
      justDuplicated={justDuplicated !== null && cellKey(justDuplicated.day, justDuplicated.period) === key}
      dimmed={dimmed}
      onRemove={onRemove}
      onSetWeek={onSetWeek}
      onToggleBundle={onToggleBundle}
      onRemoveBundle={onRemoveBundle}
      onDuplicateBundle={onDuplicateBundle}
      onLiftBundle={onLiftBundle}
      onInspect={onInspect}
    />
  );
}
