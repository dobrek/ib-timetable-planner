import { useEffect } from "react";
import { isFromTextField } from "../../lib/editable-target";

type LensKeymap = {
  open: boolean;
  setOpen: (open: boolean) => void;
  hasCriteria: boolean;
  clearAll: () => void;
  /** The shell-known collision-inspection dialog — Esc there must never clear the lens. */
  inspectionOpen: boolean;
};

/**
 * Bind the lens's global shortcuts while the board island is mounted, modeled on
 * `model/history/use-undo-keymap.ts` (window keydown, editable-target guard). ⌘K / Ctrl+K opens
 * the picker; Esc with the picker CLOSED clears the criteria. The picker's own first-Esc close is
 * Radix's built-in — this hook only owns the second Esc.
 *
 * Esc-clear is heavily guarded so an Esc aimed at any overlay never eats the lens: it is skipped
 * when the event was already handled (`defaultPrevented` — Radix layers prevent on close), when
 * the shell-known picker/inspection dialog is open, when the target sits inside a Radix layer
 * (focus-ancestry check), and — the backstop for overlays whose open state the shell can't see
 * (hours popover, settings menu, courses-left popover) — when any open Radix layer is present in
 * the DOM (popper wrapper / open dialog query veto), since focus ancestry alone fails whenever
 * focus sits outside the layer when Esc lands.
 */
export function useLensKeymap({ open, setOpen, hasCriteria, clearAll, inspectionOpen }: LensKeymap): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isFromTextField(event.target)) return;
      if (isOpenChord(event)) {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key !== "Escape" || !hasCriteria) return;
      if (event.defaultPrevented || open || inspectionOpen) return;
      if (isInsideRadixLayer(event.target) || hasOpenRadixLayer()) return;
      clearAll();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen, hasCriteria, clearAll, inspectionOpen]);
}

/** ⌘K (macOS) / Ctrl+K (Windows/Linux), no other modifiers riding along. */
function isOpenChord(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k";
}

/** Focus-ancestry veto: the Esc originated inside a portalled Radix layer (popover/dialog). */
function isInsideRadixLayer(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(OPEN_LAYER_SELECTOR) !== null;
}

/** DOM veto: some Radix layer is open somewhere — its Esc must close it, never clear the lens. */
function hasOpenRadixLayer(): boolean {
  return document.querySelector(OPEN_LAYER_SELECTOR) !== null;
}

// Popper-positioned layers (Popover/DropdownMenu content) mount inside the popper wrapper and
// unmount on close; dialogs stay addressable via role + open state.
const OPEN_LAYER_SELECTOR = '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]';
