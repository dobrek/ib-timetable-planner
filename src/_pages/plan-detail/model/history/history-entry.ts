import type { Cohort, PlacementWeek } from "@/shared/config";
import type { ParkedMember } from "../placement/parked";
import type { PlannerPlacement } from "@/entities/timetable";

// The vocabulary the whole undo/redo feature shares: what an edit touched (`AffectedScope`),
// the snapshot of that region (`AffectedSlice`), one history entry, and the reconcile plan that
// drives the live slice to a target. All framework-free — the pure engine and the write-path
// executor both speak these types.

/**
 * The region an edit touched: the cell keys (via `model/collision/cell-key`) and the shelf
 * member-sets. A move touches its source + target cells; a lift touches the source cell plus the
 * card's member-set; a remove touches one cell. `cardSets` is matched as a multiset (order-free).
 */
export type AffectedScope = {
  cells: string[];
  cardSets: ParkedMember[][];
};

/**
 * Board state read at a scope: the placements sitting at the scoped cells (a clean
 * `PlannerPlacement` shape, no local-only `pending`) and the scoped cards' member-sets. Captured
 * once as `before` at edit time and again live as the forward (redo) target at undo time.
 */
export type AffectedSlice = {
  placements: PlannerPlacement[];
  cards: ParkedMember[][];
};

/**
 * One step of history. `target` is the slice to reconcile *to*: an undo entry holds the `before`
 * slice (the pre-edit state); once undone it becomes a redo entry holding the captured-forward
 * slice (the post-edit state). `cohort` routes the reconcile to the right cohort's write path.
 */
export type HistoryEntry = {
  cohort: Cohort;
  scope: AffectedScope;
  target: AffectedSlice;
  label: string;
};

/** A placement identified by its business key — never by id (identity is not preserved across replay). */
export type PlacementKey = { courseId: string; day: number; period: number; week: PlacementWeek; isOptional: boolean };

/** The coordinates to (re-)place a course-hour at. Same shape as a key; named for intent at call sites. */
export type PlacementSpec = PlacementKey;

/**
 * The minimal RPC plan driving the live affected slice to a target, operation-agnostically.
 * Removes precede places (and card-deletes precede card-creates) so a re-place can never collide
 * with a row the same plan is about to delete — the executor applies them in that order.
 */
export type ReconcilePlan = {
  toRemove: PlacementKey[];
  toPlace: PlacementSpec[];
  cardsToDelete: ParkedMember[][];
  cardsToCreate: ParkedMember[][];
};
