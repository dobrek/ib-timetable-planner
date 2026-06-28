import { useCallback, useState } from "react";
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
 * tags the cohort, pushes the entry (which clears the redo branch — a fresh edit invalidates redo),
 * and bumps a counter so the controls' `canUndo`/`canRedo` re-derive. Built first, at the top of the
 * orchestrator.
 */
export function useHistoryRecorder(): {
  store: HistoryStore;
  record: (cohort: Cohort, entry: Omit<HistoryEntry, "cohort">) => void;
} {
  const [store] = useState(createInMemoryHistoryStore);
  const [, setVersion] = useState(0);

  const record = useCallback(
    (cohort: Cohort, entry: Omit<HistoryEntry, "cohort">) => {
      store.push({ ...entry, cohort });
      setVersion((n) => n + 1);
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
  const [, setVersion] = useState(0);
  const rerender = () => {
    setVersion((n) => n + 1);
  };

  const busy = cohortApis.dp1.busy || cohortApis.dp2.busy;
  const canUndo = store.canUndo() && !busy;
  const canRedo = store.canRedo() && !busy;

  function step(peek: () => HistoryEntry | undefined, commit: (entry: HistoryEntry) => void) {
    if (busy) return;
    const entry = peek();
    if (!entry) return;
    const api = cohortApis[entry.cohort];
    const forward = api.snapshot(entry.scope); // the opposite-direction target, captured live
    void api.applyReconcile(entry.target, entry.scope).then(({ ok }) => {
      if (!ok) return; // executor rolled back + surfaced the error; leave both stacks untouched
      commit({ ...entry, target: forward });
      rerender();
    });
  }

  const undo = () => {
    step(
      () => store.peekUndo(),
      (redoEntry) => {
        store.commitUndo(redoEntry);
      },
    );
  };

  const redo = () => {
    step(
      () => store.peekRedo(),
      (undoEntry) => {
        store.commitRedo(undoEntry);
      },
    );
  };

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    undoLabel: store.peekUndo()?.label ?? null,
    redoLabel: store.peekRedo()?.label ?? null,
  };
}
