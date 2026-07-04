import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUndoKeymap } from "./use-undo-keymap";

const keydown = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

const mount = (overrides: Partial<Parameters<typeof useUndoKeymap>[0]> = {}) => {
  const undo = vi.fn();
  const redo = vi.fn();
  const utils = renderHook(
    (props: Parameters<typeof useUndoKeymap>[0]) => {
      useUndoKeymap(props);
    },
    {
      initialProps: { undo, redo, canUndo: true, canRedo: true, ...overrides },
    },
  );
  return { undo, redo, ...utils };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useUndoKeymap — chords", () => {
  it("⌘Z and Ctrl+Z dispatch undo", () => {
    const { undo } = mount();
    document.body.dispatchEvent(keydown({ key: "z", metaKey: true }));
    document.body.dispatchEvent(keydown({ key: "z", ctrlKey: true }));
    expect(undo).toHaveBeenCalledTimes(2);
  });

  it("⌘⇧Z, Ctrl+Shift+Z and Ctrl+Y dispatch redo", () => {
    const { redo } = mount();
    document.body.dispatchEvent(keydown({ key: "z", metaKey: true, shiftKey: true }));
    document.body.dispatchEvent(keydown({ key: "z", ctrlKey: true, shiftKey: true }));
    document.body.dispatchEvent(keydown({ key: "y", ctrlKey: true }));
    expect(redo).toHaveBeenCalledTimes(3);
  });

  it("a bare Z (no modifier) does nothing", () => {
    const { undo, redo } = mount();
    document.body.dispatchEvent(keydown({ key: "z" }));
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it("preventDefault fires only when a stack action is dispatched", () => {
    mount();
    const dispatched = keydown({ key: "z", metaKey: true });
    document.body.dispatchEvent(dispatched);
    expect(dispatched.defaultPrevented).toBe(true);
  });
});

describe("useUndoKeymap — focus guard", () => {
  it.each(["input", "textarea"])("ignores keydown originating from a %s", (tag) => {
    const { undo } = mount();
    const field = document.createElement(tag);
    document.body.appendChild(field);
    field.dispatchEvent(keydown({ key: "z", metaKey: true }));
    expect(undo).not.toHaveBeenCalled();
  });

  it("ignores keydown from a contenteditable element", () => {
    const { undo } = mount();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    editable.dispatchEvent(keydown({ key: "z", metaKey: true }));
    expect(undo).not.toHaveBeenCalled();
  });
});

describe("useUndoKeymap — disabled stacks", () => {
  it("does not dispatch undo when canUndo is false (and leaves the default intact)", () => {
    const { undo } = mount({ canUndo: false });
    const event = keydown({ key: "z", metaKey: true });
    document.body.dispatchEvent(event);
    expect(undo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not dispatch redo when canRedo is false", () => {
    const { redo } = mount({ canRedo: false });
    document.body.dispatchEvent(keydown({ key: "y", ctrlKey: true }));
    expect(redo).not.toHaveBeenCalled();
  });
});

describe("useUndoKeymap — cleanup", () => {
  it("removes the listener on unmount", () => {
    const { undo, unmount } = mount();
    unmount();
    document.body.dispatchEvent(keydown({ key: "z", metaKey: true }));
    expect(undo).not.toHaveBeenCalled();
  });
});
