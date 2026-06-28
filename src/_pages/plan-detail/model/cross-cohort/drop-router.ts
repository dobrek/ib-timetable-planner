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
 * from the (cohort-scoped) palette and are confined to `activeCohort`: dropped on an `activeCohort`
 * cell they place (`addCourse`/`dropGroup`); dropped on the OTHER cohort's cell they are **rejected**
 * (→ `null`) — a palette drag can never persist a course/grouping under a cohort whose catalog it
 * doesn't belong to; dropped on the cell-less shelf they **park** under `activeCohort`
 * (`parkCourse`/`parkGroup`). `placement`/`bundle`/`parked` carry their source cohort and are likewise
 * **rejected** when it differs from the target cell's cohort. A `bundle` on the shelf lifts off the
 * board, routed by source cohort; a `placement`/`parked` on the shelf is a no-op.
 *
 * Every cell and relocating drag is cohort-tagged — the combined view's two columns, and the single
 * board its one cohort (a focus mode of the same board). So `targetCohort` reads straight off the
 * cell and the cross-cohort guard compares two real cohorts. `activeCohort` is the palette's cohort:
 * it is the only cohort signal a cohort-free palette drag carries, used both to confine on-board
 * `course`/`grouping` placement and to route the off-board park (in focus mode = the focused cohort;
 * in combined = the palette's active cohort).
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
      if (!cell) return { kind: "parkCourse", cohort: activeCohort, courseId: data.courseId };
      return targetCohort === activeCohort
        ? { kind: "addCourse", cohort: activeCohort, courseId: data.courseId, cell }
        : null;
    case "grouping":
      if (!cell) return { kind: "parkGroup", cohort: activeCohort, groupingId: data.groupingId };
      return targetCohort === activeCohort
        ? { kind: "dropGroup", cohort: activeCohort, groupingId: data.groupingId, cell }
        : null;
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
