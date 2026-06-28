import type { Cohort } from "@/shared/config";
import type { CellData, DragData, DropTargetData, ShelfData } from "../drag";

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
  | { kind: "placeBack"; cohort: Cohort; shelfBundleId: string; cell: CellData }
  | { kind: "parkCourse"; cohort: Cohort; courseId: string }
  | { kind: "parkGroup"; cohort: Cohort; groupingId: string };

/**
 * Pure drop router + cross-cohort guard — the ONE router both boards use. `course`/`grouping` come
 * from the (cohort-scoped) palette: dropped on a cell they adopt its cohort (`addCourse`/`dropGroup`);
 * dropped on the cell-less shelf they **park** under `activeCohort` (`parkCourse`/`parkGroup`) — the
 * only cohort signal a cohort-free palette drag carries off-board (the palette's active cohort).
 * `placement`/`bundle`/`parked` carry their source cohort and are **rejected** (→ `null`) when it
 * differs from the target cell's cohort. A `bundle` on the shelf lifts off the board, routed by source
 * cohort; a `placement`/`parked` on the shelf is a no-op.
 *
 * Every cell and relocating drag is cohort-tagged — the combined view's two columns, and the single
 * board its one cohort (a focus mode of the same board). So `targetCohort` reads straight off the
 * cell and the cross-cohort guard compares two real cohorts. `activeCohort` survives only for the
 * off-board park case: a cohort-free palette `course`/`grouping` dropped on the cell-less shelf parks
 * under it (in focus mode = the focused cohort; in combined = the palette's active cohort).
 */
export const resolveCombinedDrop = (
  data: DragData,
  target: DropTargetData,
  activeCohort: Cohort,
): CombinedDropAction | null => {
  const cell = isShelfTarget(target) ? null : target;
  const targetCohort = cell ? cell.cohort : null;

  switch (data.kind) {
    case "course":
      return cell && targetCohort
        ? { kind: "addCourse", cohort: targetCohort, courseId: data.courseId, cell }
        : { kind: "parkCourse", cohort: activeCohort, courseId: data.courseId };
    case "grouping":
      return cell && targetCohort
        ? { kind: "dropGroup", cohort: targetCohort, groupingId: data.groupingId, cell }
        : { kind: "parkGroup", cohort: activeCohort, groupingId: data.groupingId };
    case "placement":
      return cell && targetCohort && data.cohort === targetCohort
        ? { kind: "movePlacement", cohort: targetCohort, placementId: data.placementId, cell }
        : null;
    case "bundle": {
      if (cell && targetCohort) {
        return data.cohort === targetCohort
          ? { kind: "moveBundle", cohort: targetCohort, day: data.day, period: data.period, cell }
          : null;
      }
      return { kind: "liftBundle", cohort: data.cohort, day: data.day, period: data.period };
    }
    case "parked":
      return cell && targetCohort && data.cohort === targetCohort
        ? { kind: "placeBack", cohort: targetCohort, shelfBundleId: data.shelfBundleId, cell }
        : null;
  }
};

/** The shelf droppable carries `{kind:"shelf"}`; a cell carries `{day,period,cohort?}` (no `kind`). */
const isShelfTarget = (target: DropTargetData): target is ShelfData => "kind" in target;
