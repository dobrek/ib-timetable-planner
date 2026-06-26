/**
 * Per-device "keep the shelf drawer pinned open" preference, persisted in `localStorage`
 * like the `planner-drag-hint-mode` cosmetic pref (no Supabase — the parked SET is
 * server-owned; only this drawer-pin flag is local).
 *
 * Per lessons.md "Guard localStorage with try/catch, not just typeof window": every
 * getItem/setItem is wrapped so Safari private mode / disabled storage / quota degrade
 * silently to the default (reads) or a no-op (writes). Consume via `useSyncExternalStore`
 * with the default `false` as the server snapshot so hydration stays deterministic.
 */
export const DEFAULT_SHELF_PINNED = false;

const STORAGE_KEY = "planner-shelf-pinned";

const listeners = new Set<() => void>();

/** Reads the stored pin, defaulting to `false` on a miss, invalid value, or the server. */
export function readShelfPinned(): boolean {
  if (typeof window === "undefined") return DEFAULT_SHELF_PINNED;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Storage blocked (private mode / disabled) — treat as no preference.
    return DEFAULT_SHELF_PINNED;
  }
}

/** Persists the pin and notifies subscribers (so `useSyncExternalStore` re-renders this tab). */
export function writeShelfPinned(pinned: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, pinned ? "true" : "false");
  } catch {
    // Storage blocked — preference won't persist; degrade silently.
  }
  for (const listener of listeners) listener();
}

/** Subscribe to pin changes — same-tab writes via `writeShelfPinned`, other tabs via `storage`. */
export function subscribeShelfPinned(listener: () => void): () => void {
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
