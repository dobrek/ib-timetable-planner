import { describe, expect, it } from "vitest";
import type { Cohort } from "@/shared/config";
import type { AffectedSlice, HistoryEntry } from "./history-entry";
import { createInMemoryHistoryStore } from "./history-store";

const emptySlice: AffectedSlice = { placements: [], cards: [] };

const entry = (label: string, cohort: Cohort = "dp1"): HistoryEntry => ({
  cohort,
  scope: { cells: [], cardSets: [] },
  target: emptySlice,
  label,
});

describe("createInMemoryHistoryStore", () => {
  it("starts empty (can neither undo nor redo)", () => {
    const store = createInMemoryHistoryStore();
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(store.peekUndo()).toBeUndefined();
  });

  it("push records on the undo stack and peeks the top (LIFO)", () => {
    const store = createInMemoryHistoryStore();
    store.push(entry("first"));
    store.push(entry("second"));
    expect(store.canUndo()).toBe(true);
    expect(store.peekUndo()?.label).toBe("second");
  });

  it("a fresh push clears the redo stack (a new edit invalidates the redo branch)", () => {
    const store = createInMemoryHistoryStore();
    store.push(entry("edit"));
    store.popUndo(); // simulate an undo dispatch...
    store.pushRedo(entry("edit-redo")); // ...committed to redo on success
    expect(store.canRedo()).toBe(true);

    store.push(entry("fresh edit"));
    expect(store.canRedo()).toBe(false);
  });

  it("undo transfer: pop the top undo entry, push the forward target to redo", () => {
    const store = createInMemoryHistoryStore();
    store.push(entry("a"));
    store.push(entry("b"));

    expect(store.popUndo()?.label).toBe("b");
    store.pushRedo(entry("b-forward"));
    expect(store.peekUndo()?.label).toBe("a");
    expect(store.peekRedo()?.label).toBe("b-forward");
    expect(store.canRedo()).toBe(true);
  });

  it("redo transfer: pop the top redo entry, push the back target to undo", () => {
    const store = createInMemoryHistoryStore();
    store.push(entry("a"));
    store.popUndo();
    store.pushRedo(entry("a-forward")); // a is now on the redo stack

    expect(store.popRedo()?.label).toBe("a-forward");
    store.pushUndo(entry("a-back"));
    expect(store.canRedo()).toBe(false);
    expect(store.peekUndo()?.label).toBe("a-back");
  });

  it("pushUndo (the transfer/restore push) does NOT clear redo, unlike a fresh push", () => {
    const store = createInMemoryHistoryStore();
    store.push(entry("a"));
    store.popUndo();
    store.pushRedo(entry("a-forward")); // redo now holds an entry
    expect(store.canRedo()).toBe(true);

    store.pushUndo(entry("restored")); // a failed-undo restore must preserve the redo branch
    expect(store.canRedo()).toBe(true);
    expect(store.peekUndo()?.label).toBe("restored");
  });

  it("popUndo / popRedo remove and return the top entry", () => {
    const store = createInMemoryHistoryStore();
    store.push(entry("a"));
    store.push(entry("b"));
    expect(store.popUndo()?.label).toBe("b");
    expect(store.peekUndo()?.label).toBe("a");
    expect(store.popRedo()).toBeUndefined();
  });

  it("a full undo→redo→undo walk converges (stacks stay consistent)", () => {
    const store = createInMemoryHistoryStore();
    store.push(entry("edit"));

    store.popUndo(); // undo dispatch
    store.pushRedo(entry("edit-fwd")); // ...committed
    expect(store.canUndo()).toBe(false);

    store.popRedo(); // redo dispatch
    store.pushUndo(entry("edit-back")); // ...committed
    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);
  });

  it("caps the undo stack at maxDepth, dropping the oldest entries", () => {
    const store = createInMemoryHistoryStore(2);
    store.push(entry("1"));
    store.push(entry("2"));
    store.push(entry("3"));
    expect(store.peekUndo()?.label).toBe("3");
    expect(store.popUndo()?.label).toBe("3");
    expect(store.popUndo()?.label).toBe("2");
    expect(store.popUndo()).toBeUndefined(); // "1" was dropped by the cap
  });
});
