import type { Cohort } from "@/shared/config";
import type { CellData, DragData, DropTargetData, ShelfData } from "./drag";

/**
 * The routed outcome of a drop in the combined two-cohort view (S-06): which cohort's action to
 * run, with the resolved arguments — or `null` when the drop is a no-op or **rejected by the
 * cross-cohort guard**. Mirrors the single board's `switch (kind)` dispatch, but every relocating
 * drag (`placement`/`bundle`/`parked`) is confined to its own cohort.
 */
export type CombinedDropAction =
  | { kind: "addCourse"; cohort: Cohort; courseId: string; cell: CellData }
  | { kind: "dropGroup"; cohort: Cohort; groupingId: string; cell: CellData }
  | { kind: "movePlacement"; cohort: Cohort; placementId: string; cell: CellData }
  | { kind: "moveBundle"; cohort: Cohort; day: number; period: number; cell: CellData }
  | { kind: "liftBundle"; cohort: Cohort; day: number; period: number }
  | { kind: "placeBack"; cohort: Cohort; shelfBundleId: string; cell: CellData };

/**
 * Pure drop router + cross-cohort guard. `course`/`grouping` come from the (cohort-scoped) palette
 * and adopt the target cell's cohort. `placement`/`bundle`/`parked` carry their source cohort and
 * are **rejected** (→ `null`) when it differs from the target cell's cohort. A `bundle` dropped on
 * the shelf lifts off the board, routed by source cohort; other kinds on the shelf are no-ops.
 */
export const resolveCombinedDrop = (data: DragData, target: DropTargetData): CombinedDropAction | null => {
  const cell = isShelfTarget(target) ? null : target;
  const targetCohort = cell?.cohort;

  switch (data.kind) {
    case "course":
      return cell && targetCohort ? { kind: "addCourse", cohort: targetCohort, courseId: data.courseId, cell } : null;
    case "grouping":
      return cell && targetCohort
        ? { kind: "dropGroup", cohort: targetCohort, groupingId: data.groupingId, cell }
        : null;
    case "placement":
      return cell && targetCohort && data.cohort === targetCohort
        ? { kind: "movePlacement", cohort: targetCohort, placementId: data.placementId, cell }
        : null;
    case "bundle":
      if (cell && targetCohort) {
        return data.cohort === targetCohort
          ? { kind: "moveBundle", cohort: targetCohort, day: data.day, period: data.period, cell }
          : null;
      }
      return data.cohort ? { kind: "liftBundle", cohort: data.cohort, day: data.day, period: data.period } : null;
    case "parked":
      return cell && targetCohort && data.cohort === targetCohort
        ? { kind: "placeBack", cohort: targetCohort, shelfBundleId: data.shelfBundleId, cell }
        : null;
  }
};

/** The shelf droppable carries `{kind:"shelf"}`; a cell carries `{day,period,cohort?}` (no `kind`). */
const isShelfTarget = (target: DropTargetData): target is ShelfData => "kind" in target;
