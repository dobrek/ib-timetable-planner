/**
 * Canonical `(day, period)` cell identity, shared by the grid, droppables, and the collision map.
 *
 * Lives in its own dependency-free leaf module (not in `collisions.ts`) so the index builders
 * (`availability-index`, `cross-cohort-index`) and the board-only constraints can format the key
 * without importing `collisions` — that import would close a runtime cycle, since `collisions`
 * imports the constraint registry and the empty-index defaults. With `cellKey` here, those
 * back-edges disappear and the empty-index constants can be imported canonically.
 */
export const cellKey = (day: number, period: number): string => `${day}:${period}`;
