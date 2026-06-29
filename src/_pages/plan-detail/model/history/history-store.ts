import type { HistoryEntry } from "./history-entry";

/**
 * The render-facing projection of the store — the four facts the toolbar/keymap read every render.
 * Cached and only rebuilt on mutation so `getSnapshot` returns a referentially stable value between
 * edits (the `useSyncExternalStore` contract: an unchanged snapshot must keep its identity, or React
 * loops). It exists because the stacks live in closure (mutable, outside React's data flow); reading
 * them directly in render is impure and the React Compiler memoizes such reads to their first value.
 * Subscribing to this snapshot instead is the supported way to read external mutable state in render.
 */
export type HistorySnapshot = {
  canUndo: boolean;
  canRedo: boolean;
  /** The next undo step's label, e.g. "Place group at Mon · P1"; null when the stack is empty. */
  undoLabel: string | null;
  redoLabel: string | null;
};

/**
 * A two-stack undo/redo store behind an interface, so the session (in-memory) implementation can
 * later be swapped for a durable (table-backed) one without touching the engine. The orchestrator
 * drives the undo↔redo transfer identity-safely: it `pop`s the entry synchronously at dispatch,
 * runs the reconcile, and only on success pushes that exact entry to the opposite stack
 * (commit-on-success — history never drifts from the database); on failure it pushes the entry back
 * to its source stack. Popping at dispatch (rather than removing by position in a later callback)
 * means a concurrent fresh edit or a rapid double-trigger can never strip the wrong entry.
 *
 * Every mutation re-emits to subscribers; `subscribe`/`getSnapshot` back the controls' render reads
 * via `useSyncExternalStore`, so a stack change re-renders the toolbar without the engine forcing it.
 */
export type HistoryStore = {
  /** Record a fresh user edit on the undo stack; a fresh edit invalidates the redo branch. */
  push(entry: HistoryEntry): void;
  popUndo(): HistoryEntry | undefined;
  popRedo(): HistoryEntry | undefined;
  peekUndo(): HistoryEntry | undefined;
  peekRedo(): HistoryEntry | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Push an entry onto the undo stack WITHOUT clearing redo — the transfer push, not a fresh edit. */
  pushUndo(entry: HistoryEntry): void;
  /** Push an entry onto the redo stack (the captured-forward target on a successful undo). */
  pushRedo(entry: HistoryEntry): void;
  /**
   * Subscribe to mutations; returns an unsubscribe. The `useSyncExternalStore` subscribe arg — typed
   * as an arrow property (not a method) so it's safe to pass unbound and keeps a stable identity.
   */
  subscribe: (listener: () => void) => () => void;
  /** The cached render-facing snapshot; stable identity until the next mutation. */
  getSnapshot: () => HistorySnapshot;
};

/**
 * The session (in-memory) `HistoryStore`. State is two immutable arrays held in closure; every
 * mutation reassigns rather than splices, so reads stay referentially stable between edits.
 * `maxDepth` bounds memory by dropping the oldest entries once the undo stack exceeds it.
 */
export function createInMemoryHistoryStore(maxDepth = 100): HistoryStore {
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];
  const listeners = new Set<() => void>();

  const capped = (stack: HistoryEntry[]): HistoryEntry[] =>
    stack.length > maxDepth ? stack.slice(stack.length - maxDepth) : stack;

  const buildSnapshot = (): HistorySnapshot => ({
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoLabel: undoStack.at(-1)?.label ?? null,
    redoLabel: redoStack.at(-1)?.label ?? null,
  });

  // Rebuilt only here, so `getSnapshot` hands out a stable reference between mutations.
  let snapshot = buildSnapshot();
  const emit = () => {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  };

  return {
    push(entry) {
      undoStack = capped([...undoStack, entry]);
      redoStack = [];
      emit();
    },
    popUndo() {
      const top = undoStack.at(-1);
      undoStack = undoStack.slice(0, -1);
      emit();
      return top;
    },
    popRedo() {
      const top = redoStack.at(-1);
      redoStack = redoStack.slice(0, -1);
      emit();
      return top;
    },
    peekUndo: () => undoStack.at(-1),
    peekRedo: () => redoStack.at(-1),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    pushUndo(entry) {
      undoStack = capped([...undoStack, entry]);
      emit();
    },
    pushRedo(entry) {
      redoStack = capped([...redoStack, entry]);
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  };
}
