/**
 * What the board's left column shows, resolved once from server-assembled state. A single
 * tested decision rather than two conditions scattered across `PlannerBoard`'s render — the
 * seam the next palette state plugs into without touching the board's JSX (the board renders;
 * the guards/transitions live here, per the repo's model/-owns-decisions lesson).
 */
export type PaletteView = "hidden" | PaletteContent;

/** What the palette panel's body shows, once there is a palette at all. */
export type PaletteContent = "empty" | "stale" | "ready";

/**
 * Total precedence: a caller who may not edit → `"hidden"` (no palette at all, S-405: every one of
 * its states is a write surface — drag, compute, recompute); else no groupings → `"empty"` (the
 * compute prompt, regardless of staleness); else out-of-date palette → `"stale"` (the recompute
 * panel); else `"ready"` (the normal palette). Hidden wins over empty, which is what keeps a viewer's
 * focus mode on the timetable: the board swaps itself for the compute prompt only on `"empty"`.
 * Empty wins over stale: a plan with no groupings has a null stored hash and would always read
 * stale, but the compute prompt is the right surface there.
 */
export const resolvePaletteView = ({
  groupingsCount,
  stale,
  canEdit,
}: {
  groupingsCount: number;
  stale: boolean;
  canEdit: boolean;
}): PaletteView => (canEdit ? resolvePaletteContent({ groupingsCount, stale }) : "hidden");

/**
 * The palette panel's own body: the same precedence below `"hidden"`. The panel mounts only when the
 * board resolved a palette, so it asks this — never a capability it does not hold.
 */
export const resolvePaletteContent = ({
  groupingsCount,
  stale,
}: {
  groupingsCount: number;
  stale: boolean;
}): PaletteContent => {
  if (groupingsCount === 0) return "empty";
  if (stale) return "stale";
  return "ready";
};
