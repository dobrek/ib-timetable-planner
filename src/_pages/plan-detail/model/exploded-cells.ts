import { cellKey } from "./collisions";

/**
 * The set of cells the author has currently expanded into individual chips (the
 * "ungrouped" view), keyed by `cellKey`. Ephemeral, in-session only — never persisted.
 * "Everything is a bundle" is the data model; grouped-vs-exploded is pure presentation,
 * so this resets to empty (all grouped) on every mount/reload.
 */
export type ExplodedCells = ReadonlySet<string>;

/** Is `(day, period)` currently exploded (showing individual chips)? */
export function isCellExploded(exploded: ExplodedCells, day: number, period: number): boolean {
  return exploded.has(cellKey(day, period));
}

/**
 * Set a cell's exploded view. `explode` true expands it into chips (ungroup); false
 * collapses it back to the bundled default (group). Returns a new set — never mutates.
 */
export function setCellExploded(exploded: ExplodedCells, day: number, period: number, explode: boolean): ExplodedCells {
  const key = cellKey(day, period);
  const next = new Set(exploded);
  if (explode) next.add(key);
  else next.delete(key);
  return next;
}

/**
 * A cell renders as a bundle iff it holds >=2 occupants and is not currently exploded.
 * A single-occupant cell is never a bundle; the data concept "is this bundled?" is always
 * true (every cell with courses is a bundle), so this is purely a render predicate.
 */
export function isBundled(occupantCount: number, exploded: boolean): boolean {
  return occupantCount >= 2 && !exploded;
}
