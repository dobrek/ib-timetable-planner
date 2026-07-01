/**
 * Per-device board-zoom preference, persisted in `localStorage` like the sibling cosmetic prefs
 * (`planner-drag-hint-mode`, `planner-shelf-pinned`) — no Supabase, never plan-scoped. One device-wide
 * zoom level (a plain number, 1 = 100%) shared across every plan.
 *
 * Per lessons.md "Guard localStorage with try/catch, not just typeof window": every getItem/setItem is
 * wrapped so Safari private mode / disabled storage / quota degrade silently to the default (reads) or a
 * no-op (writes). Consume via `useSyncExternalStore` with `DEFAULT_ZOOM` as the server snapshot so
 * hydration stays deterministic; a primitive return is inherently stable, so `getSnapshot` can't loop.
 */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1.5;
export const ZOOM_STEP = 0.05;

export const DEFAULT_ZOOM = 1;

const STORAGE_KEY = "planner-board-zoom";

const listeners = new Set<() => void>();

/** Reads the stored level, defaulting to `1` on a miss, invalid value, or the server. */
export function readZoom(): number {
  if (typeof window === "undefined") return DEFAULT_ZOOM;
  try {
    return parseZoom(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage blocked (private mode / disabled) — treat as no preference.
    return DEFAULT_ZOOM;
  }
}

/** Persists the level and notifies subscribers (so `useSyncExternalStore` re-renders this tab). */
export function writeZoom(level: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clampZoom(level)));
  } catch {
    // Storage blocked — preference won't persist; degrade silently.
  }
  for (const listener of listeners) listener();
}

/** Subscribe to zoom changes — same-tab writes via `writeZoom`, other tabs via `storage`. */
export function subscribeZoom(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/**
 * Validates a raw stored string into a zoom level, clamping into `[MIN, MAX]`. Returns `DEFAULT_ZOOM` on
 * null, empty, or a non-finite value — the read/SSR contract that keeps a corrupt persisted value from
 * ever escaping the slider's range or crashing the board.
 */
export function parseZoom(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_ZOOM;
  const level = Number(raw);
  return Number.isFinite(level) ? clampZoom(level) : DEFAULT_ZOOM;
}

const clampZoom = (level: number): number => Math.min(Math.max(level, MIN_ZOOM), MAX_ZOOM);
