/**
 * Fixed, in-code wall-clock times for each period — the display-only companion of
 * `BREAK_AFTER_PERIODS` (same precedent: cosmetic const, not domain logic, not persisted).
 * The product currently targets a single school, so one placeholder bell schedule suffices:
 * 45-minute periods with longer gaps after P2 and P5, aligned with the visual breaks.
 *
 * `periodTimeRange` is the single lookup seam: a future per-plan timetable (schema +
 * editing UI) replaces this const behind the same function without touching consumers.
 * Never scatter time literals through the UI.
 */
export type PeriodTimeRange = { start: string; end: string };

export const periodTimeRange = (period: number): PeriodTimeRange | null => PERIOD_TIMES.get(period) ?? null;

const PERIOD_TIMES: ReadonlyMap<number, PeriodTimeRange> = new Map([
  [1, { start: "08:15", end: "09:00" }],
  [2, { start: "09:05", end: "09:50" }],
  [3, { start: "10:10", end: "10:55" }],
  [4, { start: "11:00", end: "11:45" }],
  [5, { start: "11:50", end: "12:35" }],
  [6, { start: "13:10", end: "13:55" }],
  [7, { start: "14:00", end: "14:45" }],
  [8, { start: "14:50", end: "15:35" }],
  [9, { start: "15:40", end: "16:25" }],
  [10, { start: "16:25", end: "17:10" }],
]);
