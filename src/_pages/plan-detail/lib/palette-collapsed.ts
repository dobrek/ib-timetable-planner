/**
 * Per-device "collapse the planner palette to a rail" preference. Unlike the sibling
 * cosmetic prefs (`planner-shelf-pinned`, `planner-drag-hint-mode`, which use
 * `localStorage`), this one is cookie-backed so the **server** can read it in
 * `src/pages/plans/[id]/index.astro` and seed the island's initial state — making the
 * collapsed/expanded choice flash-free across reloads (a `localStorage` read can only
 * happen post-hydration, which would render expanded for one frame then snap shut).
 *
 * No Astro Action: per lessons.md, Actions transport app-data mutations, not per-device
 * cosmetic prefs. The flag is non-HttpOnly so the client toggle can write it directly.
 *
 * Known minor gap: a cookie has no cross-tab sync event (unlike the `localStorage`
 * `storage` event), so a collapse in one tab won't propagate to another. Acceptable for
 * a cosmetic per-tab toggle.
 */
export const COOKIE_NAME = "planner-palette-collapsed";

export const DEFAULT_PALETTE_COLLAPSED = false;

const MAX_AGE_SECONDS = 31_536_000; // ~1 year

/**
 * Pure parse of the raw cookie value into the collapse flag — shared by the server read
 * (Astro page) and any client read. Safe to import server-side: no `document`/`window`
 * at module scope. Any value other than the literal `"true"` (including `undefined`)
 * falls back to the default expanded state.
 */
export function parsePaletteCollapsed(value: string | undefined): boolean {
  return value === "true";
}

/**
 * Client-side cookie write for the collapse toggle. No-op on the server (guards
 * `typeof document`), consistent with the storage-guard idiom in `shelf-pinned.ts`.
 * `Secure` is set only over HTTPS — adding it unconditionally would drop the cookie on
 * `http://localhost` during dev. Scoped to `path=/plans` so it doesn't ride along on
 * every asset/API request.
 */
export function writePaletteCollapsed(collapsed: boolean): void {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=${collapsed ? "true" : "false"}; path=/plans; max-age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}
