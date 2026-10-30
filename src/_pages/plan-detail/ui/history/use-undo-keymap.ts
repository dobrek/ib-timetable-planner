import { useEffect } from "react";
import { isFromTextField } from "../../lib/editable-target";

type UndoKeymap = {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

/**
 * Bind the global undo/redo shortcuts while the board island is mounted, without hijacking text
 * editing. ⌘Z / Ctrl+Z → undo; ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y → redo (both meta and ctrl, so it
 * works on macOS and Windows/Linux). Ignores events from an `input`, `textarea`, or
 * `contenteditable` so typing in a field never steps the board. `preventDefault` fires only when a
 * stack action is actually dispatched (the stack is non-empty), leaving the browser default intact
 * otherwise. `enabled: false` (a caller who may not edit, S-405) binds nothing at all, so the chords
 * keep their browser default.
 */
export function useUndoKeymap({ undo, redo, canUndo, canRedo }: UndoKeymap, { enabled }: { enabled: boolean }): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isFromTextField(event.target)) return;
      const action = resolveShortcut(event);
      if (!action) return;
      if (action === "undo" && canUndo) {
        event.preventDefault();
        undo();
      } else if (action === "redo" && canRedo) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, undo, redo, canUndo, canRedo]);
}

/** Resolve a keyboard event to an undo/redo intent (cross-platform), or null for any other chord. */
function resolveShortcut(event: KeyboardEvent): "undo" | "redo" | null {
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.metaKey) return "redo";
  return null;
}
