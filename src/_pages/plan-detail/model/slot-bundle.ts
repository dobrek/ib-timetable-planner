/**
 * A persisted unbundled override, keyed by cell coordinate. Its presence means the
 * cell is explicitly **UNbundled** (opt-out / grouped-by-default — see the migration
 * and `api/slot-bundles.ts`). Predicates and optimistic transitions over this type
 * land in Phase 2; this file is the type-only seed so the Phase 1 server path compiles.
 */
export type SlotOverride = { day: number; period: number };
