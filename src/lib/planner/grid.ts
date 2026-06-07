export type GridDimensions = { days: number; periods: number };

/** Fallback when `slot_grid_preset` is missing or malformed — the S-01 demo grid. */
export const DEFAULT_GRID: GridDimensions = { days: 5, periods: 10 };

const PRESET_RE = /^(\d+)x(\d+)$/;

/**
 * Parse a plan's `slot_grid_preset` into grid dimensions. The documented order is
 * `<days>x<periods>` — so `5x10` is 5 days × 10 periods (days 1..5, periods 1..10).
 * Anything unparseable or non-positive falls back to {@link DEFAULT_GRID} rather than
 * rendering a NaN grid. This is the single place the preset convention is interpreted.
 */
export const parseGridPreset = (preset: string | null | undefined): GridDimensions => {
  const match = typeof preset === "string" ? PRESET_RE.exec(preset.trim()) : null;
  if (!match) return DEFAULT_GRID;

  const days = Number(match[1]);
  const periods = Number(match[2]);
  if (days < 1 || periods < 1) return DEFAULT_GRID;

  return { days, periods };
};
