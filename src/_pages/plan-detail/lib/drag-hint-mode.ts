/**
 * Per-device encoding preference for drag hints, persisted in `localStorage` like the
 * existing `theme` / `sidebar-collapsed` cosmetic prefs (no Supabase — purely cosmetic).
 *
 * - `dim-blocked` (default): recede blocked/partial cells, leave free cells neutral.
 * - `highlight-free`: positively tint free cells.
 */
export type HintMode = "dim-blocked" | "highlight-free";

export const DEFAULT_HINT_MODE: HintMode = "dim-blocked";

const STORAGE_KEY = "planner-drag-hint-mode";

const listeners = new Set<() => void>();

/** Reads the stored mode, defaulting to `dim-blocked` on a miss, invalid value, or the server. */
export function readHintMode(): HintMode {
  if (typeof window === "undefined") return DEFAULT_HINT_MODE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isHintMode(stored) ? stored : DEFAULT_HINT_MODE;
  } catch {
    // Storage blocked (private mode / disabled) — treat as no preference.
    return DEFAULT_HINT_MODE;
  }
}

/** Persists the mode and notifies subscribers (so `useSyncExternalStore` re-renders this tab). */
export function writeHintMode(mode: HintMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage blocked — preference won't persist; degrade silently.
  }
  for (const listener of listeners) listener();
}

/** Subscribe to mode changes — same-tab writes via `writeHintMode`, other tabs via `storage`. */
export function subscribeHintMode(listener: () => void): () => void {
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

export const isHintMode = (value: string | null): value is HintMode =>
  value === "dim-blocked" || value === "highlight-free";
