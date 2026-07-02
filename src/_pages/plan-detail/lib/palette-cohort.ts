import type { Cohort } from "@/shared/config";

/**
 * Per-device "which cohort the combined-board palette is showing" selection. Cookie-backed —
 * exactly like the sibling `planner-palette-collapsed` pref — so the **server** can read it in
 * `src/pages/plans/[id]/index.astro` and seed the island's initial `paletteCohort` state flash-free.
 *
 * This matters because a stale-grouping recompute triggers a full-document `refreshPage()` that
 * remounts the board island. Without a seed the palette selection snaps back to `dp1`, so
 * recomputing the dp2 palette would silently drop the user back on dp1. The cookie carries the
 * choice across that reload.
 *
 * Only meaningful in combined mode — in focus mode the active cohort is pinned to `?focus=`, and
 * the write only fires from the combined-mode cohort switcher. No Astro Action: per lessons.md,
 * Actions transport app-data mutations, not per-device view prefs. Non-HttpOnly so the client
 * switcher can write it directly.
 *
 * Known minor gaps, both inherited from and consistent with `palette-collapsed.ts`: a cookie has no
 * cross-tab sync event, and it is shared across plans (`path=/plans`, not per-plan). Acceptable for
 * a cosmetic per-device selection.
 */
export const COOKIE_NAME = "planner-palette-cohort";

export const DEFAULT_PALETTE_COHORT: Cohort = "dp1";

const MAX_AGE_SECONDS = 31_536_000; // ~1 year

/**
 * Pure parse of the raw cookie value into the selected cohort — the SSR↔client contract shared by
 * the server read (Astro page) and the client seed, so the first SSR paint matches the first client
 * paint. The cohort set is a fixed two-value enum, so only the literal `"dp2"` selects dp2; anything
 * else (including `undefined`) falls back to the `dp1` default. Safe to import server-side: no
 * `document`/`window` at module scope.
 */
export function parsePaletteCohort(value: string | undefined): Cohort {
  return value === "dp2" ? "dp2" : DEFAULT_PALETTE_COHORT;
}

/**
 * Client-side cookie write for the palette cohort switcher. No-op on the server (guards
 * `typeof document`). Mirrors `writePaletteCollapsed`: `Secure` only over HTTPS (so the cookie isn't
 * dropped on `http://localhost` in dev), scoped to `path=/plans` so it doesn't ride along on every
 * asset/API request.
 */
export function writePaletteCohort(cohort: Cohort): void {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=${cohort}; path=/plans; max-age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}
