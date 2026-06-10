import { err, ok, type Result } from "@/shared/lib/result";
import type { CellData } from "./drag";
import { occupiesCell, type LocalPlacement, type PlannerPlacement } from "./placement";

// --- Add ---

export function canAdd(placements: LocalPlacement[], courseId: string, cell: CellData): boolean {
  return !occupiesCell(placements, courseId, cell);
}

export function addOptimistic(
  prev: LocalPlacement[],
  tempId: string,
  courseId: string,
  cell: CellData,
): LocalPlacement[] {
  return [...prev, { id: tempId, courseId, day: cell.day, period: cell.period, pending: true }];
}

export function addReconcile(prev: LocalPlacement[], tempId: string, real: PlannerPlacement): LocalPlacement[] {
  return prev.map((p) => (p.id === tempId ? real : p));
}

export function addRollback(prev: LocalPlacement[], tempId: string): LocalPlacement[] {
  return prev.filter((p) => p.id !== tempId);
}

// --- Move ---

export type MoveIntent = {
  oldId: string;
  origin: { day: number; period: number };
  courseId: string;
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
  return ok({ oldId: row.id, origin: { day: row.day, period: row.period }, courseId: row.courseId });
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
