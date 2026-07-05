/**
 * Fixed, in-code positions of the purely **visual** breaks on the planner board: a faint band is
 * drawn after period 2 and after period 5, so the day reads as morning / mid / afternoon blocks.
 *
 * This is the single source of truth a future maintainer edits to move the breaks. It is cosmetic,
 * not domain logic — kept in `lib/` (per the `palette-collapsed` / `drag-hint-mode` precedent), never
 * in the constraint `model/`. Break positions are deliberately a const, not persisted or
 * user-configurable (see `change.md` → "Decision — scope locked").
 */
export const BREAK_AFTER_PERIODS: readonly number[] = [2, 5];

/**
 * Whether a visual break band should render *after* `period` on a grid of `totalPeriods` rows.
 * True only when `period` is a break position **and** it is not the last row — the `period <
 * totalPeriods` guard suppresses any trailing break below the final period (e.g. "after 5" still
 * renders on a `5x6` grid since period 5 precedes period 6, but is suppressed on a 5-period grid where
 * period 5 is the last row).
 */
export function breaksAfterPeriod(period: number, totalPeriods: number): boolean {
  return BREAK_AFTER_PERIODS.includes(period) && period < totalPeriods;
}
