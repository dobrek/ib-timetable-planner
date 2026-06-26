import type { PlacementWeek } from "@/shared/config";

/** One course in a parked (shelved) bundle, carrying its A/B week so the formation survives. */
export type ParkedMember = { courseId: string; week: PlacementWeek };

/**
 * A parked bundle: the server-durable off-board unit (a `shelf_bundles` row + its
 * `shelf_bundle_courses`). It holds no slot — identity + its course set only. The loader
 * projects this from Supabase; the board prop carries it. The optimistic `LocalParkedBundle`
 * variant + transitions live in `shelf-transitions.ts` (Phase 3).
 */
export type ParkedBundle = { id: string; members: ParkedMember[] };
