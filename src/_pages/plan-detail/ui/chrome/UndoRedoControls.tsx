import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@/shared/ui";

export type UndoRedoControlsProps = {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** The next-step label, e.g. "Remove bundle at Mon · P3"; null when the stack is empty. */
  undoLabel: string | null;
  redoLabel: string | null;
};

/**
 * Toolbar Undo / Redo affordance reflecting stack state. Token-based shadcn icon buttons; the
 * next-step label rides the native `title` (and `aria-label` for a11y) — there is no Tooltip
 * primitive in `@/shared/ui` and the criterion doesn't warrant adding one. Disabled when its stack
 * is empty.
 */
export default function UndoRedoControls({
  undo,
  redo,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
}: UndoRedoControlsProps) {
  const undoTitle = canUndo && undoLabel ? `Undo: ${undoLabel}` : "Undo";
  const redoTitle = canRedo && redoLabel ? `Redo: ${redoLabel}` : "Redo";
  return (
    <div data-slot="undo-redo-controls" className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        disabled={!canUndo}
        title={undoTitle}
        aria-label={undoTitle}
        onClick={undo}
      >
        <Undo2 />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        disabled={!canRedo}
        title={redoTitle}
        aria-label={redoTitle}
        onClick={redo}
      >
        <Redo2 />
      </Button>
    </div>
  );
}
