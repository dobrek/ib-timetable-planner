import type { CellData, DragData, DropTargetData, ShelfData } from "./drag";

/**
 * The routed outcome of a drop on the single-cohort board — the pure decision lifted out of
 * `PlannerBoard.handleDrop`'s `switch (data.kind)` so it can be unit-tested. Mirrors
 * `CombinedDropAction` exactly, minus the per-cohort tag + cross-cohort guard (a single board has
 * one cohort, so a relocating drag can never cross). `null` is a no-op (placement/parked on the
 * shelf, or a drop the board ignores). Park variants stay catalog-pure — they carry only ids; the
 * board resolves the off-board members via `model/parked-members`, exactly as the combined board
 * does. This shared shape is the on-ramp to the Phase 7 router unification.
 */
export type SingleDropAction =
  | { kind: "addCourse"; courseId: string; cell: CellData }
  | { kind: "dropGroup"; groupingId: string; cell: CellData }
  | { kind: "movePlacement"; placementId: string; cell: CellData }
  | { kind: "moveBundle"; day: number; period: number; cell: CellData }
  | { kind: "liftBundle"; day: number; period: number }
  | { kind: "placeBack"; shelfBundleId: string; cell: CellData }
  | { kind: "parkCourse"; courseId: string }
  | { kind: "parkGroup"; groupingId: string };

/**
 * Pure drop router for the single board. A `course`/`grouping` lands on a cell (`addCourse`/
 * `dropGroup`) or, on the cell-less shelf, parks (`parkCourse`/`parkGroup`). A `bundle` on a cell
 * moves/merges, on the shelf lifts off the board. A `placement` only moves onto a cell; a `parked`
 * card only places back onto a cell — both are no-ops on the shelf. Identical in shape to
 * `resolveCombinedDrop`, with no cohort to resolve or guard.
 */
export const resolveSingleDrop = (data: DragData, target: DropTargetData): SingleDropAction | null => {
  const cell = isShelfTarget(target) ? null : target;

  switch (data.kind) {
    case "course":
      return cell
        ? { kind: "addCourse", courseId: data.courseId, cell }
        : { kind: "parkCourse", courseId: data.courseId };
    case "grouping":
      return cell
        ? { kind: "dropGroup", groupingId: data.groupingId, cell }
        : { kind: "parkGroup", groupingId: data.groupingId };
    case "placement":
      return cell ? { kind: "movePlacement", placementId: data.placementId, cell } : null;
    case "bundle":
      return cell
        ? { kind: "moveBundle", day: data.day, period: data.period, cell }
        : { kind: "liftBundle", day: data.day, period: data.period };
    case "parked":
      return cell ? { kind: "placeBack", shelfBundleId: data.shelfBundleId, cell } : null;
  }
};

/** The shelf droppable carries `{kind:"shelf"}`; a cell carries `{day,period}` (no `kind`). */
const isShelfTarget = (target: DropTargetData): target is ShelfData => "kind" in target;
