import type { PlacementWeek } from "@/shared/config";

/** One course in a parked (shelved) bundle, carrying its A/B week and optional flag so the formation survives. */
export type ParkedMember = { courseId: string; week: PlacementWeek; isOptional: boolean };

/**
 * A parked bundle: the server-durable off-board unit (a `shelf_bundles` row + its
 * `shelf_bundle_courses`). It holds no slot — identity + its course set only. The loader
 * projects this from Supabase; the board prop carries it. The optimistic `LocalParkedBundle`
 * variant + transitions live in `shelf-transitions.ts` (Phase 3).
 */
export type ParkedBundle = { id: string; members: ParkedMember[] };

/**
 * A parked bundle in island-local state. `pending` is true while an optimistic card's
 * server id has not yet reconciled — place-back/discard are gated until it clears, mirroring
 * `LocalPlacement.pending`.
 */
export type LocalParkedBundle = ParkedBundle & { pending?: boolean };
