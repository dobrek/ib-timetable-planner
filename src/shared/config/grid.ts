import { DEFAULT_GRID_PRESET } from "./grid-presets";

export type GridDimensions = { days: number; periods: number };

/**
 * Hard grid bounds, mirroring the DB check constraints (`placements_day_range`,
 * `placements_period_range`). Placement validation and preset parsing both read these
 * so a rendered cell can never be rejected by the action or the database.
 */
export const GRID_BOUNDS = { maxDays: 7, maxPeriods: 12 } as const;

const PRESET_RE = /^(\d+)x(\d+)$/;

/**
 * Fallback when `slot_grid_preset` is missing or malformed — derived from the shared
 * canonical default so the create-plan select and the board fallback can't drift.
 */
export const DEFAULT_GRID: GridDimensions = parseDimensions(DEFAULT_GRID_PRESET) ?? { days: 5, periods: 10 };

/**
 * Parse a plan's `slot_grid_preset` into grid dimensions. The documented order is
 * `<days>x<periods>` — so `5x10` is 5 days × 10 periods (days 1..5, periods 1..10).
 * Anything unparseable, non-positive, or beyond {@link GRID_BOUNDS} falls back to
 * {@link DEFAULT_GRID} rather than rendering an invalid grid. This is the single
 * place the preset convention is interpreted.
 */
export const parseGridPreset = (preset: string | null | undefined): GridDimensions =>
  parseDimensions(preset) ?? DEFAULT_GRID;

function parseDimensions(preset: string | null | undefined): GridDimensions | null {
  const match = typeof preset === "string" ? PRESET_RE.exec(preset.trim()) : null;
  if (!match) return null;

  const days = Number(match[1]);
  const periods = Number(match[2]);
  if (days < 1 || periods < 1 || days > GRID_BOUNDS.maxDays || periods > GRID_BOUNDS.maxPeriods) return null;

  return { days, periods };
}
