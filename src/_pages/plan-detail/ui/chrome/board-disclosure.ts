import { useState, useSyncExternalStore } from "react";
import { DEFAULT_ZOOM, readZoom, subscribeZoom, writeZoom } from "../../lib/board-zoom";
import { DEFAULT_HINT_MODE, readHintMode, subscribeHintMode, writeHintMode } from "../../lib/drag-hint-mode";
import { writePaletteCollapsed } from "../../lib/palette-collapsed";
import { DEFAULT_SHELF_PINNED, readShelfPinned, subscribeShelfPinned, writeShelfPinned } from "../../lib/shelf-pinned";

/**
 * The board's UI-disclosure / per-device-preference hooks, lifted out of `PlannerBoard` so the
 * single-cohort board and the combined shell both consume the same instances from one place. They
 * stay in the UI layer (not `model/`) because they own presentation/persistence concerns; the
 * combined shell holds ONE of each as a shell-level singleton for the whole two-cohort view, so a
 * per-cohort hook never needs them.
 */

// Per-device hint encoding, persisted in localStorage. `useSyncExternalStore` returns the
// default during SSR and the hydration render (the island is `client:load`) via the server
// snapshot, then switches to the stored value — so the toggle's active state can't trip a
// hydration mismatch. Drags never run at hydration, so the cells themselves can't mismatch.
export function useHintMode() {
  const hintMode = useSyncExternalStore(subscribeHintMode, readHintMode, () => DEFAULT_HINT_MODE);
  return { hintMode, setHintMode: writeHintMode };
}

// Per-device board zoom, persisted in localStorage. Same `useSyncExternalStore` contract as
// `useHintMode` — the server snapshot (`DEFAULT_ZOOM`) drives SSR and the hydration render so the
// stored value can't trip a hydration mismatch, then the client switches to the persisted state.
export function useZoom() {
  const zoom = useSyncExternalStore(subscribeZoom, readZoom, () => DEFAULT_ZOOM);
  return { zoom, setZoom: writeZoom };
}

// Owns the shelf drawer's open/closed disclosure. `pinned` is the per-device persisted pref
// (useSyncExternalStore: server snapshot = default, so hydration can't mismatch); `expanded` is
// the runtime toggle. A pinned drawer is always open and never auto-collapses; lift / place-back
// collapse it only when not pinned. The grid reflows once when `shelfExpanded` flips — and only on
// these explicit toggles, never mid-drag (no drag mutates this state).
export function useShelfDisclosure() {
  const pinned = useSyncExternalStore(subscribeShelfPinned, readShelfPinned, () => DEFAULT_SHELF_PINNED);
  const [expanded, setExpanded] = useState(false);
  return {
    shelfExpanded: expanded || pinned,
    pinned,
    setExpanded,
    setPinned: writeShelfPinned,
    collapseUnlessPinned: () => {
      if (!pinned) setExpanded(false);
    },
  };
}

// Owns the palette's collapse disclosure. Seeded from the SSR `paletteCollapsed` prop (read from
// the cookie server-side), so the first client render matches the server and there is no hydration
// flash. Simpler than the shelf: no `useSyncExternalStore` (the cookie is read once at SSR — cross-
// tab sync is intentionally omitted, see palette-collapsed.ts) and no pin (the palette is never a
// drop target, so it never auto-collapses). The toggle writes the cookie so the choice survives a
// reload; like the shelf, the grid reflows only on these explicit clicks, never mid-drag.
export function usePaletteDisclosure(initialCollapsed: boolean) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  return {
    collapsed,
    setCollapsed: (next: boolean) => {
      setCollapsed(next);
      writePaletteCollapsed(next);
    },
  };
}
