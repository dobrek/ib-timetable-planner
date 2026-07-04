import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLensKeymap } from "./use-lens-keymap";

const keydown = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

const mount = (overrides: Partial<Parameters<typeof useLensKeymap>[0]> = {}) => {
  const setOpen = vi.fn();
  const clearAll = vi.fn();
  const utils = renderHook(
    (props: Parameters<typeof useLensKeymap>[0]) => {
      useLensKeymap(props);
    },
    {
      initialProps: { open: false, setOpen, hasCriteria: true, clearAll, inspectionOpen: false, ...overrides },
    },
  );
  return { setOpen, clearAll, ...utils };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useLensKeymap — open chord", () => {
  it("⌘K and Ctrl+K open the picker and prevent the browser default", () => {
    const { setOpen } = mount();
    const cmd = keydown({ key: "k", metaKey: true });
    const ctrl = keydown({ key: "K", ctrlKey: true });
    document.body.dispatchEvent(cmd);
    document.body.dispatchEvent(ctrl);
    expect(setOpen).toHaveBeenCalledTimes(2);
    expect(setOpen).toHaveBeenCalledWith(true);
    expect(cmd.defaultPrevented).toBe(true);
    expect(ctrl.defaultPrevented).toBe(true);
  });

  it("a bare K (no modifier) and a shifted chord do nothing", () => {
    const { setOpen } = mount();
    document.body.dispatchEvent(keydown({ key: "k" }));
    document.body.dispatchEvent(keydown({ key: "k", metaKey: true, shiftKey: true }));
    expect(setOpen).not.toHaveBeenCalled();
  });

  it("ignores the chord from an editable target", () => {
    const { setOpen } = mount();
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.dispatchEvent(keydown({ key: "k", metaKey: true }));
    expect(setOpen).not.toHaveBeenCalled();
  });

  it("ignores the chord while the inspection dialog is open", () => {
    const { setOpen } = mount({ inspectionOpen: true });
    document.body.dispatchEvent(keydown({ key: "k", metaKey: true }));
    expect(setOpen).not.toHaveBeenCalled();
  });

  it("ignores the chord while a Radix layer is open in the DOM", () => {
    const { setOpen } = mount();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    document.body.dispatchEvent(keydown({ key: "k", metaKey: true }));
    expect(setOpen).not.toHaveBeenCalled();
  });
});

describe("useLensKeymap — Esc clear gating", () => {
  it("Esc with the picker closed and criteria active clears the lens", () => {
    const { clearAll } = mount();
    document.body.dispatchEvent(keydown({ key: "Escape" }));
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it("does nothing without criteria", () => {
    const { clearAll } = mount({ hasCriteria: false });
    document.body.dispatchEvent(keydown({ key: "Escape" }));
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("skips when the picker is open (Radix owns that Esc)", () => {
    const { clearAll } = mount({ open: true });
    document.body.dispatchEvent(keydown({ key: "Escape" }));
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("skips when the event was already handled (defaultPrevented)", () => {
    const { clearAll } = mount();
    const handled = keydown({ key: "Escape" });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("skips while the collision-inspection dialog is open", () => {
    const { clearAll } = mount({ inspectionOpen: true });
    document.body.dispatchEvent(keydown({ key: "Escape" }));
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("skips when the target sits inside a Radix layer (focus ancestry)", () => {
    const { clearAll } = mount();
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    const inner = document.createElement("button");
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    inner.dispatchEvent(keydown({ key: "Escape" }));
    expect(clearAll).not.toHaveBeenCalled();
  });

  it("skips when any Radix layer is open in the DOM even if focus sits outside it", () => {
    const { clearAll } = mount();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    document.body.dispatchEvent(keydown({ key: "Escape" }));
    expect(clearAll).not.toHaveBeenCalled();
  });
});

describe("useLensKeymap — cleanup", () => {
  it("removes the listener on unmount", () => {
    const { setOpen, unmount } = mount();
    unmount();
    document.body.dispatchEvent(keydown({ key: "k", metaKey: true }));
    expect(setOpen).not.toHaveBeenCalled();
  });
});
