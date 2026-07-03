/**
 * True when the event originates from an editable control (`input`, `textarea`, contenteditable),
 * so global board shortcuts never hijack typing. Shared by the undo/redo and lens keymaps —
 * promoted from `model/history/use-undo-keymap.ts` when the lens keymap became its second consumer.
 */
export function isFromTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  // `isContentEditable` covers inherited editability in real browsers; the attribute selector is a
  // deterministic fallback (and handles nested editables) so the guard never depends on the DOM impl.
  return target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}
