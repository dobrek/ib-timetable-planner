/**
 * What the board's left column shows, resolved once from server-assembled state. A single
 * tested decision rather than two conditions scattered across `PlannerBoard`'s render — the
 * seam the next palette state plugs into without touching the board's JSX (the board renders;
 * the guards/transitions live here, per the repo's model/-owns-decisions lesson).
 */
export type PaletteView = "empty" | "stale" | "ready";

/**
 * Total precedence: no groupings → `"empty"` (the compute prompt, regardless of staleness);
 * else out-of-date palette → `"stale"` (the recompute panel); else `"ready"` (the normal palette).
 * Empty wins over stale: a plan with no groupings has a null stored hash and would always read
 * stale, but the compute prompt is the right surface there.
 */
export const resolvePaletteView = ({
  groupingsCount,
  stale,
}: {
  groupingsCount: number;
  stale: boolean;
}): PaletteView => {
  if (groupingsCount === 0) return "empty";
  if (stale) return "stale";
  return "ready";
};
