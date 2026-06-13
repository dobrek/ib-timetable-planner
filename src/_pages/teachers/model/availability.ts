import type { AvailabilitySeverity } from "@/shared/config";
import type { TeacherAvailabilityCell } from "./teacher";

/**
 * Pure, coordinate-keyed optimistic transitions for the tri-state availability grid —
 * adapted from `plan-detail/model/slot-bundle.ts` but severity-bearing (a cell may
 * already exist with a different severity), not binary. Every function returns a new
 * array and never mutates; cells are keyed by `(day, period)`.
 */

/** An availability cell in island-local state. `pending` is true while a write is in flight. */
export type LocalAvailabilityCell = TeacherAvailabilityCell & { pending?: boolean };

const cellKey = (day: number, period: number): string => `${day}:${period}`;

/** The severity at a cell, or null when the cell is available (no row). */
export function severityAt(
  cells: readonly LocalAvailabilityCell[],
  day: number,
  period: number,
): AvailabilitySeverity | null {
  const key = cellKey(day, period);
  return cells.find((cell) => cellKey(cell.day, cell.period) === key)?.severity ?? null;
}

/** Click-cycle order for one cell: available → soft → strong → available. */
export function cycleSeverity(current: AvailabilitySeverity | null): AvailabilitySeverity | null {
  if (current === null) return "soft";
  if (current === "soft") return "strong";
  return null;
}

// --- Single-cell transitions ---

/** Optimistically set a cell to `severity` (or remove it when null), flagged pending. */
export function setCellOptimistic(
  cells: LocalAvailabilityCell[],
  day: number,
  period: number,
  severity: AvailabilitySeverity | null,
): LocalAvailabilityCell[] {
  return withCell(cells, day, period, severity, true);
}

/** Confirmed: clear the pending flag on a cell (no-op if the cell was cleared away). */
export function reconcileCell(cells: LocalAvailabilityCell[], day: number, period: number): LocalAvailabilityCell[] {
  const key = cellKey(day, period);
  return cells.map((cell) => (cellKey(cell.day, cell.period) === key ? settled(cell) : cell));
}

/** Failed: restore the cell to its pre-edit severity (or remove it when that was available). */
export function rollbackCell(
  cells: LocalAvailabilityCell[],
  day: number,
  period: number,
  previous: AvailabilitySeverity | null,
): LocalAvailabilityCell[] {
  return withCell(cells, day, period, previous, false);
}

// --- Whole-line transitions (a day column or a period row, as a set of coordinates) ---

/** A cell coordinate. A "line" is any set of them — a day column or a period row. */
export type CellCoord = { day: number; period: number };

/** Coordinates of one day column: periods 1..periods at `day`. */
export const columnCoords = (day: number, periods: number): CellCoord[] =>
  Array.from({ length: periods }, (_, index) => ({ day, period: index + 1 }));

/** Coordinates of one period row: days 1..days at `period`. */
export const rowCoords = (period: number, days: number): CellCoord[] =>
  Array.from({ length: days }, (_, index) => ({ day: index + 1, period }));

/** Optimistically set every cell on a line to `severity`, or clear the line when null. */
export function setLineOptimistic(
  cells: LocalAvailabilityCell[],
  coords: readonly CellCoord[],
  severity: AvailabilitySeverity | null,
): LocalAvailabilityCell[] {
  const keys = lineKeys(coords);
  const without = cells.filter((cell) => !keys.has(cellKey(cell.day, cell.period)));
  if (severity === null) return without;
  const line = coords.map((coord) => ({ day: coord.day, period: coord.period, severity, pending: true as const }));
  return [...without, ...line];
}

/** Confirmed: clear pending flags across a line. */
export function reconcileLine(cells: LocalAvailabilityCell[], coords: readonly CellCoord[]): LocalAvailabilityCell[] {
  const keys = lineKeys(coords);
  return cells.map((cell) => (keys.has(cellKey(cell.day, cell.period)) ? settled(cell) : cell));
}

/** Failed: restore a line to its captured pre-edit cells. */
export function rollbackLine(
  cells: LocalAvailabilityCell[],
  coords: readonly CellCoord[],
  previousLine: readonly TeacherAvailabilityCell[],
): LocalAvailabilityCell[] {
  const keys = lineKeys(coords);
  const without = cells.filter((cell) => !keys.has(cellKey(cell.day, cell.period)));
  const restored = previousLine.map((cell) => ({ day: cell.day, period: cell.period, severity: cell.severity }));
  return [...without, ...restored];
}

/** The current cells lying on a line, as plain (non-pending) coordinates — captured for rollback. */
export function lineCells(
  cells: readonly LocalAvailabilityCell[],
  coords: readonly CellCoord[],
): TeacherAvailabilityCell[] {
  const keys = lineKeys(coords);
  return cells
    .filter((cell) => keys.has(cellKey(cell.day, cell.period)))
    .map((cell) => ({ day: cell.day, period: cell.period, severity: cell.severity }));
}

const lineKeys = (coords: readonly CellCoord[]): Set<string> =>
  new Set(coords.map((coord) => cellKey(coord.day, coord.period)));

function withCell(
  cells: LocalAvailabilityCell[],
  day: number,
  period: number,
  severity: AvailabilitySeverity | null,
  pending: boolean,
): LocalAvailabilityCell[] {
  const key = cellKey(day, period);
  const without = cells.filter((cell) => cellKey(cell.day, cell.period) !== key);
  if (severity === null) return without;
  return [...without, pending ? { day, period, severity, pending: true } : { day, period, severity }];
}

/** Strip the pending flag, leaving a settled cell. */
function settled(cell: LocalAvailabilityCell): LocalAvailabilityCell {
  return { day: cell.day, period: cell.period, severity: cell.severity };
}
