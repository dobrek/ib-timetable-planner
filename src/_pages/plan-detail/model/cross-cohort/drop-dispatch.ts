import type { Cohort, WeekMode } from "@/shared/config";
import type { PlannerGrouping } from "../grouping/grouping";
import type { ParkedMember } from "../placement/parked";
import { defaultParkedWeek, groupingParkedMembers } from "../placement/parked-members";
import type { CohortActions } from "../use-cohort-board-state";
import type { CombinedDropAction } from "./drop-router";

/**
 * The per-cohort slice of board state a drop dispatch needs: the optimistic action callbacks plus
 * the two pure inputs the group/park cases resolve against. A structural subset of `CohortBoardState`,
 * so the combined board can pass `c => byCohort[c]` directly and the single board a constant `() => state`.
 */
export type DropDispatchState = {
  actions: CohortActions;
  groupings: PlannerGrouping[];
  weekModeByCourseId: Map<string, WeekMode>;
};

/** The one impure, component-owned effect a drop can trigger beyond the placement writes. */
export type DropEffects = { collapseUnlessPinned: () => void };

/**
 * The ONE canonical drop dispatch both boards share — maps a resolved `CombinedDropAction` to the
 * right per-cohort `actions.*` call. Pure: it calls no hooks and closes over nothing; the cohort
 * state and the single impure effect are injected. `resolveState(cohort)` returns that cohort's
 * `{ actions, groupings, weekModeByCourseId }` — the single board passes `() => theState`, the
 * combined board `c => byCohort[c]`, so both dispatch identically (single = degenerate combined).
 *
 * `collapseUnlessPinned` fires on the shelf-bound transitions (`liftBundle`/`placeBack`/park) but
 * not on a board placement (`addCourse`/`dropGroup`/`movePlacement`/`moveBundle`). An unknown
 * grouping id resolves to an empty member list → `parkGroup`/`dropGroup` no-op (no park, no collapse).
 */
export function applyDropAction(
  action: CombinedDropAction,
  resolveState: (cohort: Cohort) => DropDispatchState,
  effects: DropEffects,
): void {
  const { actions, groupings, weekModeByCourseId } = resolveState(action.cohort);

  switch (action.kind) {
    case "addCourse":
      actions.addCourse(action.courseId, action.cell);
      break;
    case "dropGroup": {
      const grouping = groupings.find((candidate) => candidate.id === action.groupingId);
      actions.addGroup(grouping?.memberIds ?? [], action.cell, { oppositeWeek: grouping?.oppositeWeek ?? false });
      break;
    }
    case "movePlacement":
      actions.movePlacement(action.placementId, action.cell);
      break;
    case "moveBundle":
      actions.moveBundle(action.day, action.period, action.cell);
      break;
    case "liftBundle":
      actions.shelveBundle(action.day, action.period);
      effects.collapseUnlessPinned();
      break;
    case "placeBack":
      actions.placeBack(action.shelfBundleId, action.cell);
      effects.collapseUnlessPinned();
      break;
    case "parkCourse":
      park(
        [{ courseId: action.courseId, week: defaultParkedWeek(action.courseId, weekModeByCourseId) }],
        actions,
        effects,
      );
      break;
    case "parkGroup":
      park(groupingParkedMembers(action.groupingId, groupings, weekModeByCourseId), actions, effects);
      break;
  }
}

// Park a resolved member-set onto the shelf, then auto-collapse unless pinned. An empty set (an
// unknown grouping id) is a no-op — neither parks nor collapses — matching both boards' guards.
function park(members: ParkedMember[], actions: CohortActions, effects: DropEffects): void {
  if (members.length === 0) return;
  actions.parkMembers(members);
  effects.collapseUnlessPinned();
}
