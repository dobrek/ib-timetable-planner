import { err, ok, type Result } from "@/shared/lib/result";
import type { PlacementWeek, WeekMode } from "@/shared/config";
import type { CellData } from "./drag";
import { occupiesCell, type LocalPlacement, type PlannerPlacement } from "./placement";

// --- Drop-time week assignment (invariant: agnostic ⇒ both, biweekly ⇒ a|b) ---

/**
 * The week a freshly-dropped single course takes. An agnostic course runs every week (`both`);
 * a bi-weekly course resolves to the first **free** single week in the target cell (the week not
 * already taken by a same-cell occupant), falling back to `a` — deterministic, and the per-chip
 * control then swaps it. Never persists a bi-weekly course as `both`.
 */
export function resolveDropWeek(weekMode: WeekMode, placements: LocalPlacement[], cell: CellData): PlacementWeek {
  if (weekMode === "agnostic") return "both";
  const taken = new Set(placements.filter((p) => p.day === cell.day && p.period === cell.period).map((p) => p.week));
  if (!taken.has("a")) return "a";
  if (!taken.has("b")) return "b";
  return "a";
}

/**
 * Assign the members of an opposite-week grouping to alternating weeks — sort the ids, then
 * first → `a`, second → `b` (v1 groupings are pairs; alternation generalizes deterministically).
 */
export function oppositeWeekAssignment(memberIds: string[]): Map<string, PlacementWeek> {
  const assignment = new Map<string, PlacementWeek>();
  [...memberIds].sort().forEach((id, index) => assignment.set(id, index % 2 === 0 ? "a" : "b"));
  return assignment;
}

// --- Add ---

export function canAdd(placements: LocalPlacement[], courseId: string, cell: CellData): boolean {
  return !occupiesCell(placements, courseId, cell);
}

export function addOptimistic(
  prev: LocalPlacement[],
  tempId: string,
  courseId: string,
  cell: CellData,
  week: PlacementWeek,
): LocalPlacement[] {
  return [...prev, { id: tempId, courseId, day: cell.day, period: cell.period, week, pending: true }];
}

export function addReconcile(prev: LocalPlacement[], tempId: string, real: PlannerPlacement): LocalPlacement[] {
  return prev.map((p) => (p.id === tempId ? real : p));
}

export function addRollback(prev: LocalPlacement[], tempId: string): LocalPlacement[] {
  return prev.filter((p) => p.id !== tempId);
}

// --- Add group (batch) ---

export type BatchEntry = { tempId: string; courseId: string; week: PlacementWeek };
/** `result: null` means the member failed to persist and rolls back. */
export type BatchOutcome = { tempId: string; result: PlannerPlacement | null };

export function eligibleMembers(placements: LocalPlacement[], memberIds: string[], cell: CellData): string[] {
  return memberIds.filter((courseId) => canAdd(placements, courseId, cell));
}

export function addManyOptimistic(prev: LocalPlacement[], entries: BatchEntry[], cell: CellData): LocalPlacement[] {
  return [
    ...prev,
    ...entries.map(({ tempId, courseId, week }) => ({
      id: tempId,
      courseId,
      day: cell.day,
      period: cell.period,
      week,
      pending: true,
    })),
  ];
}

export function settleMany(prev: LocalPlacement[], outcomes: BatchOutcome[]): LocalPlacement[] {
  const resultByTempId = new Map(outcomes.map(({ tempId, result }) => [tempId, result]));
  return prev.flatMap((placement) => {
    if (!resultByTempId.has(placement.id)) return [placement];
    const result = resultByTempId.get(placement.id);
    return result ? [result] : [];
  });
}

export function groupFailureMessage(failedNames: string[], attempted: number): string {
  const noun = attempted === 1 ? "course" : "courses";
  return `${failedNames.length} of ${attempted} ${noun} failed to save: ${failedNames.join(", ")}`;
}

// --- Errors ---

/** Persistence-failure surface of the write path — id-based; display names resolve at the render edge. */
export type PlacementError =
  | { kind: "message"; message: string }
  | { kind: "groupFailure"; failedCourseIds: string[]; attempted: number };

export function placementErrorMessage(error: PlacementError, names: Record<string, string>): string {
  if (error.kind === "message") return error.message;
  const failedNames = error.failedCourseIds.map((id) => names[id] ?? id);
  return groupFailureMessage(failedNames, error.attempted);
}

// --- Move ---

export type MoveIntent = {
  oldId: string;
  origin: { day: number; period: number };
  courseId: string;
  /** The moved placement keeps its week — a move is a re-POST that must preserve A/B. */
  week: PlacementWeek;
};

export type MoveRejection = "not-found" | "pending" | "same-cell" | "occupied";

export function moveIntent(
  placements: LocalPlacement[],
  placementId: string,
  cell: CellData,
): Result<MoveIntent, MoveRejection> {
  const row = placements.find((p) => p.id === placementId);
  if (!row) return err("not-found");
  if (row.pending) return err("pending");
  if (row.day === cell.day && row.period === cell.period) return err("same-cell");
  if (occupiesCell(placements, row.courseId, cell)) return err("occupied");
  return ok({ oldId: row.id, origin: { day: row.day, period: row.period }, courseId: row.courseId, week: row.week });
}

export function moveOptimistic(prev: LocalPlacement[], id: string, cell: CellData): LocalPlacement[] {
  return prev.map((p) => (p.id === id ? { ...p, day: cell.day, period: cell.period, pending: true } : p));
}

export function moveReconcile(prev: LocalPlacement[], id: string, created: PlannerPlacement): LocalPlacement[] {
  return prev.map((p) => (p.id === id ? created : p));
}

export function moveRollback(
  prev: LocalPlacement[],
  id: string,
  origin: { day: number; period: number },
): LocalPlacement[] {
  return prev.map((p) => (p.id === id ? { ...p, ...origin, pending: false } : p));
}

// --- Remove ---

export type RemoveRejection = "not-found" | "pending";

export function removeTarget(
  placements: LocalPlacement[],
  placementId: string,
): Result<LocalPlacement, RemoveRejection> {
  const row = placements.find((p) => p.id === placementId);
  if (!row) return err("not-found");
  if (row.pending) return err("pending");
  return ok(row);
}

export function removeOptimistic(prev: LocalPlacement[], id: string): LocalPlacement[] {
  return prev.filter((p) => p.id !== id);
}

export function removeRollback(prev: LocalPlacement[], row: LocalPlacement): LocalPlacement[] {
  return [...prev, row];
}

// --- Set week (A/B) ---

/** Optimistically move a chip to the other lane. The row already has a real id (only placed
 * bi-weekly chips expose the control), so no `pending` gate is needed — the control stays live. */
export function setWeekOptimistic(prev: LocalPlacement[], id: string, week: PlacementWeek): LocalPlacement[] {
  return prev.map((p) => (p.id === id ? { ...p, week } : p));
}

export function setWeekReconcile(prev: LocalPlacement[], id: string, updated: PlannerPlacement): LocalPlacement[] {
  return prev.map((p) => (p.id === id ? updated : p));
}

export function setWeekRollback(prev: LocalPlacement[], id: string, prevWeek: PlacementWeek): LocalPlacement[] {
  return prev.map((p) => (p.id === id ? { ...p, week: prevWeek } : p));
}

// --- Bundle move/remove (whole-slot batch) ---

/** Every placement id sitting at a cell — the membership of a whole-slot drag/remove. */
export function occupantPlacementIds(placements: LocalPlacement[], cell: CellData): string[] {
  return placements.filter((p) => p.day === cell.day && p.period === cell.period).map((p) => p.id);
}

export type BundlePartition = { movers: string[]; mergers: string[] };

/**
 * Split a bundle's occupants by the destination — the batch analogue of `moveIntent`'s
 * per-row `occupiesCell` check, generalized from reject to skip. A **merger** is an
 * occupant whose course already sits at the target (its twin stays; the source row is
 * dropped, never moved onto its twin — which would create a duplicate-course collision
 * both transiently and post-settle). A **mover** is everyone else.
 */
export function partitionBundleMove(placements: LocalPlacement[], ids: string[], target: CellData): BundlePartition {
  const idSet = new Set(ids);
  const movers: string[] = [];
  const mergers: string[] = [];
  for (const row of placements) {
    if (!idSet.has(row.id)) continue;
    if (occupiesCell(placements, row.courseId, target)) mergers.push(row.id);
    else movers.push(row.id);
  }
  return { movers, mergers };
}

/**
 * Apply a whole-slot move in ONE pass: movers get the target coords + `pending` (keeping
 * their old id, like `moveOptimistic`); mergers are filtered out (their target twin already
 * holds that course). No intermediate twin is ever created, so the board derives only the
 * initial and final states — never a transient duplicate-course flag.
 */
export function moveManyOptimistic(
  prev: LocalPlacement[],
  movers: string[],
  mergers: string[],
  target: CellData,
): LocalPlacement[] {
  const moverSet = new Set(movers);
  const mergerSet = new Set(mergers);
  return prev.flatMap((p) => {
    if (mergerSet.has(p.id)) return [];
    if (moverSet.has(p.id)) return [{ ...p, day: target.day, period: target.period, pending: true }];
    return [p];
  });
}

/** Remove every placement in `ids` in one immutable pass (whole-slot bulk remove). */
export function removeManyOptimistic(prev: LocalPlacement[], ids: string[]): LocalPlacement[] {
  const idSet = new Set(ids);
  return prev.filter((p) => !idSet.has(p.id));
}
