import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

/**
 * Pair an interactive child's click with the drag-inert affordance: pointer-down stops the
 * cell/chip drag from starting, and the click runs the business handler after stopping
 * propagation. Centralizes the formerly repeated stopPropagation pair so a new control can't
 * silently re-enable drag-on-click. (dnd-kit already auto-excludes `<button>`s from activation;
 * the pointer-down stop is the documented belt-and-braces.)
 */
export const stopDrag = (onClick: () => void) => ({
  onPointerDown: (event: ReactPointerEvent) => {
    event.stopPropagation();
  },
  onClick: (event: ReactMouseEvent) => {
    event.stopPropagation();
    onClick();
  },
});
