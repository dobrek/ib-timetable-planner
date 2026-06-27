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
 * **Single board = degenerate one-cohort case.** The single board runs under one provider with one
 * cohort, and its cells/drags carry NO cohort (tagging them would change the cell aria-label + the
 * parked-card tag, which are wired off the same `cohort` prop — so it stays untagged to preserve
 * behavior). A missing cohort therefore resolves to `activeCohort` (the board's one cohort): the
 * cross-cohort guard becomes a trivial pass (a cohort can't differ from itself) and the dispatch is
 * identical to the board's old `switch (kind)`. The combined view always tags both cells and
 * relocating drags, so every `?? activeCohort` is identity there and the strict guard is unchanged.
 */
export const resolveCombinedDrop = (
  data: DragData,
  target: DropTargetData,
  activeCohort: Cohort,
): CombinedDropAction | null => {
  const cell = isShelfTarget(target) ? null : target;
  // Untagged single-board cell → the board's one cohort; combined cell → its own (always set).
  const targetCohort = cell ? (cell.cohort ?? activeCohort) : null;

  switch (data.kind) {
    case "course":
      return cell && targetCohort
        ? { kind: "addCourse", cohort: targetCohort, courseId: data.courseId, cell }
        : { kind: "parkCourse", cohort: activeCohort, courseId: data.courseId };
    case "grouping":
      return cell && targetCohort
        ? { kind: "dropGroup", cohort: targetCohort, groupingId: data.groupingId, cell }
        : { kind: "parkGroup", cohort: activeCohort, groupingId: data.groupingId };
    case "placement": {
      const dragCohort = data.cohort ?? activeCohort;
      return cell && targetCohort && dragCohort === targetCohort
        ? { kind: "movePlacement", cohort: targetCohort, placementId: data.placementId, cell }
        : null;
    }
    case "bundle": {
      const dragCohort = data.cohort ?? activeCohort;
      if (cell && targetCohort) {
        return dragCohort === targetCohort
          ? { kind: "moveBundle", cohort: targetCohort, day: data.day, period: data.period, cell }
          : null;
      }
      return { kind: "liftBundle", cohort: dragCohort, day: data.day, period: data.period };
    }
    case "parked": {
      const dragCohort = data.cohort ?? activeCohort;
      return cell && targetCohort && dragCohort === targetCohort
        ? { kind: "placeBack", cohort: targetCohort, shelfBundleId: data.shelfBundleId, cell }
        : null;
    }
  }
};

/** The shelf droppable carries `{kind:"shelf"}`; a cell carries `{day,period,cohort?}` (no `kind`). */
const isShelfTarget = (target: DropTargetData): target is ShelfData => "kind" in target;
