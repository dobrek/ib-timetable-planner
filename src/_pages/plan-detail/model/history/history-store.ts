import type { HistoryEntry } from "./history-entry";

/**
 * A two-stack undo/redo store behind an interface, so the session (in-memory) implementation can
 * later be swapped for a durable (table-backed) one without touching the engine. The orchestrator
 * drives the undo↔redo transfer identity-safely: it `pop`s the entry synchronously at dispatch,
 * runs the reconcile, and only on success pushes that exact entry to the opposite stack
 * (commit-on-success — history never drifts from the database); on failure it pushes the entry back
 * to its source stack. Popping at dispatch (rather than removing by position in a later callback)
 * means a concurrent fresh edit or a rapid double-trigger can never strip the wrong entry.
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
};

/**
 * The session (in-memory) `HistoryStore`. State is two immutable arrays held in closure; every
 * mutation reassigns rather than splices, so reads stay referentially stable between edits.
 * `maxDepth` bounds memory by dropping the oldest entries once the undo stack exceeds it.
 */
export function createInMemoryHistoryStore(maxDepth = 100): HistoryStore {
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];

  const capped = (stack: HistoryEntry[]): HistoryEntry[] =>
    stack.length > maxDepth ? stack.slice(stack.length - maxDepth) : stack;

  return {
    push(entry) {
      undoStack = capped([...undoStack, entry]);
      redoStack = [];
    },
    popUndo() {
      const top = undoStack.at(-1);
      undoStack = undoStack.slice(0, -1);
      return top;
    },
    popRedo() {
      const top = redoStack.at(-1);
      redoStack = redoStack.slice(0, -1);
      return top;
    },
    peekUndo: () => undoStack.at(-1),
    peekRedo: () => redoStack.at(-1),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    pushUndo(entry) {
      undoStack = capped([...undoStack, entry]);
    },
    pushRedo(entry) {
      redoStack = capped([...redoStack, entry]);
    },
  };
}
