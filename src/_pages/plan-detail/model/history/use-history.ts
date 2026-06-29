import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { Cohort } from "@/shared/config";
import type { AffectedScope, AffectedSlice, HistoryEntry } from "./history-entry";
import { createInMemoryHistoryStore, type HistoryStore } from "./history-store";

// The plan-level undo/redo orchestration, split into TWO hooks called at the two ends of the cohort
// assembly to resolve the ordering cycle: `useHistoryRecorder` produces the stable `record` BEFORE
// `usePlacements` runs (each cohort receives it as `onRecord`); `useHistoryControls` binds `undo`/
// `redo` to the cohort apis AFTER both bases exist. Neither hook reads a not-yet-built value at
// render — exactly how `useCombinedBoardState` already sequences the live cross-index cycle.

/** The per-cohort write-path surface the controls drive (a projection of `usePlacements`). */
export type CohortHistoryApi = {
  applyReconcile: (target: AffectedSlice, scope: AffectedScope) => Promise<{ ok: boolean }>;
  snapshot: (scope: AffectedScope) => AffectedSlice;
  busy: boolean;
};

export type HistoryControls = {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
};

/**
 * Owns the history store (a lazily-initialized `useState`, so the one instance survives re-renders)
 * and the stable `record` callback each cohort's `usePlacements` receives as `onRecord`. `record`
 * tags the cohort and pushes the entry (which clears the redo branch — a fresh edit invalidates
 * redo); the push re-emits to the store's subscribers, so the controls re-derive `canUndo`/labels
 * via `useSyncExternalStore` — no manual version counter. Built first, at the top of the orchestrator.
 */
export function useHistoryRecorder(): {
  store: HistoryStore;
  record: (cohort: Cohort, entry: Omit<HistoryEntry, "cohort">) => void;
} {
  const [store] = useState(createInMemoryHistoryStore);

  const record = useCallback(
    (cohort: Cohort, entry: Omit<HistoryEntry, "cohort">) => {
      store.push({ ...entry, cohort });
    },
    [store],
  );

  return { store, record };
}

/**
 * The undo/redo engine over the two cohorts' reconcile/snapshot methods. Called AFTER both
 * `useCohortPlacements` return, so `cohortApis` already exists. Each control:
 *   1. peeks the top entry (no-op if none),
 *   2. captures the live forward target via `snapshot` (the post-edit state at undo time),
 *   3. reconciles the board to the entry's target,
 *   4. and ONLY on success moves the entry to the opposite stack (commit-on-success) — on failure
 *      the executor already rolled the client back + surfaced the error, and the entry stays retryable.
 * **In-flight guard:** `canUndo`/`canRedo` AND the controls themselves are gated on `!busy` (either
 * cohort), so a rapid ⌘Z during an unsettled edit can't pop a not-yet-recorded entry or read a
 * one-render-lagged ref. The keymap and buttons consume these same flags, covering every trigger.
 */
export function useHistoryControls(store: HistoryStore, cohortApis: Record<Cohort, CohortHistoryApi>): HistoryControls {
  // The store's stacks live in closure (mutable, outside React's data flow), so reading them in
  // render is impure — the React Compiler would memoize such reads to their first (empty) value, so
  // the labels would never appear. `useSyncExternalStore` is the supported way: every stack mutation
  // re-emits and hands back a fresh, stable snapshot, so each pop/push re-renders the toolbar with no
  // manual version counter. The same `getSnapshot` serves SSR (the seed empty snapshot).
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // Synchronous reentrancy lock. `busy` is render state (`setReconciling`), so it lags the keydown
  // event stream — a rapid double-trigger inside one render frame would otherwise slip past it. The
  // ref is set/cleared synchronously, independent of render timing, serializing dispatch to one
  // reconcile at a time so the second can't read a one-render-lagged ref.
  const inFlightRef = useRef(false);

  const busy = cohortApis.dp1.busy || cohortApis.dp2.busy;
  const canUndo = snapshot.canUndo && !busy;
  const canRedo = snapshot.canRedo && !busy;

  function step(
    pop: () => HistoryEntry | undefined,
    restore: (entry: HistoryEntry) => void,
    commit: (entry: HistoryEntry) => void,
  ) {
    if (busy || inFlightRef.current) return;
    // Pop synchronously at dispatch — fixing the entry's identity now, so a concurrent fresh edit or
    // a rapid double-trigger can never strip the wrong entry in the async callback below. Each
    // pop/push re-emits from the store, so the toolbar re-renders without an explicit force-update.
    const entry = pop();
    if (!entry) return;
    inFlightRef.current = true;
    const api = cohortApis[entry.cohort];
    const forward = api.snapshot(entry.scope); // the opposite-direction target, captured live before the reconcile
    void api
      .applyReconcile(entry.target, entry.scope)
      .then(({ ok }) => {
        if (!ok) {
          restore(entry); // executor rolled the client back + surfaced the error; return the entry to its stack
          return;
        }
        commit({ ...entry, target: forward }); // commit-on-success: move the exact popped entry to the opposite stack
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }

  const undo = () => {
    step(
      () => store.popUndo(),
      (entry) => {
        store.pushUndo(entry);
      },
      (redoEntry) => {
        store.pushRedo(redoEntry);
      },
    );
  };

  const redo = () => {
    step(
      () => store.popRedo(),
      (entry) => {
        store.pushRedo(entry);
      },
      (undoEntry) => {
        store.pushUndo(undoEntry);
      },
    );
  };

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    undoLabel: snapshot.undoLabel,
    redoLabel: snapshot.redoLabel,
  };
}
