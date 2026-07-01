/**
 * Per-device board-zoom preference, persisted in `localStorage` like the sibling cosmetic prefs
 * (`planner-drag-hint-mode`, `planner-shelf-pinned`) — no Supabase, never plan-scoped. One device-wide
 * zoom shared across every plan.
 *
 * The state is discriminated so "Fit" stays sticky and re-computes on resize (`{ mode: "fit" }`) while
 * a manual level is applied verbatim (`{ mode: "manual", level }`). Per lessons.md "Guard localStorage
 * with try/catch, not just typeof window": every getItem/setItem is wrapped so Safari private mode /
 * disabled storage / quota degrade silently to the default (reads) or a no-op (writes). Consume via
 * `useSyncExternalStore` with `DEFAULT_ZOOM` as the server snapshot so hydration stays deterministic.
 */
export type ZoomState = { mode: "manual"; level: number } | { mode: "fit" };

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 1.5;
export const ZOOM_STEP = 0.05;

export const DEFAULT_ZOOM: ZoomState = { mode: "manual", level: 1 };

const STORAGE_KEY = "planner-board-zoom";

const listeners = new Set<() => void>();

// `useSyncExternalStore` requires `getSnapshot` to return a referentially STABLE value whenever the
// underlying store is unchanged — the sibling prefs get this for free by returning primitives, but a
// fresh `parseZoom` object every call would make React see a new snapshot on every render and loop
// forever (React error #185). Cache the parsed state keyed on the raw string so an unchanged store
// returns the same object reference; only an actual write re-parses.
let snapshot: { raw: string | null; state: ZoomState } = { raw: null, state: DEFAULT_ZOOM };

/** Reads the stored zoom, defaulting to `{ manual, 1 }` on a miss, invalid value, or the server. */
export function readZoom(): ZoomState {
  if (typeof window === "undefined") return DEFAULT_ZOOM;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw !== snapshot.raw) snapshot = { raw, state: parseZoom(raw) };
    return snapshot.state;
  } catch {
    // Storage blocked (private mode / disabled) — treat as no preference.
    return DEFAULT_ZOOM;
  }
}

/** Persists the zoom and notifies subscribers (so `useSyncExternalStore` re-renders this tab). */
export function writeZoom(state: ZoomState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
 * Validates a raw stored string into a `ZoomState`, clamping a manual `level` into `[MIN, MAX]`.
 * Returns `DEFAULT_ZOOM` on null, parse error, or any shape that is neither a fit nor a finite-level
 * manual state — the read/SSR contract that keeps a persisted value from ever crashing the board.
 */
export function parseZoom(raw: string | null): ZoomState {
  if (raw === null) return DEFAULT_ZOOM;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isFitState(parsed)) return { mode: "fit" };
    if (isManualState(parsed)) return { mode: "manual", level: clampZoom(parsed.level) };
    return DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isFitState = (value: unknown): value is { mode: "fit" } => isRecord(value) && value.mode === "fit";

const isManualState = (value: unknown): value is { mode: "manual"; level: number } =>
  isRecord(value) && value.mode === "manual" && typeof value.level === "number" && Number.isFinite(value.level);

const clampZoom = (level: number): number => Math.min(Math.max(level, MIN_ZOOM), MAX_ZOOM);
