import { z } from "zod";

/**
 * The active plan-detail surface, parsed from `?focus=`: a single cohort focus (`dp1`/`dp2`) or the
 * combined two-cohort board. Anything else — a missing or garbage param — coerces to `combined`, the
 * default landing surface ("combined is the board"). Co-located in `lib/` so both the route parsing
 * (`plans/[id]/index.astro`) and the chrome (`CohortSwitcher`, the unified board) share one source.
 */
export const boardSurfaceSchema = z.enum(["dp1", "dp2", "combined"]).catch("combined");

export type BoardSurface = z.infer<typeof boardSurfaceSchema>;
