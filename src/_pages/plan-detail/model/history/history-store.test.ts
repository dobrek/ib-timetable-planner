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
    store.commitUndo(entry("edit-redo")); // simulate an undo → redo gains an entry
    expect(store.canRedo()).toBe(true);

    store.push(entry("fresh edit"));
    expect(store.canRedo()).toBe(false);
  });

  it("commitUndo moves the top undo entry to the redo stack", () => {
    const store = createInMemoryHistoryStore();
    store.push(entry("a"));
    store.push(entry("b"));

    store.commitUndo(entry("b-forward"));
    expect(store.peekUndo()?.label).toBe("a");
    expect(store.peekRedo()?.label).toBe("b-forward");
    expect(store.canRedo()).toBe(true);
  });

  it("commitRedo moves the top redo entry back to the undo stack", () => {
    const store = createInMemoryHistoryStore();
    store.push(entry("a"));
    store.commitUndo(entry("a-forward"));

    store.commitRedo(entry("a-back"));
    expect(store.canRedo()).toBe(false);
    expect(store.peekUndo()?.label).toBe("a-back");
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
    store.commitUndo(entry("edit-fwd")); // undo
    expect(store.canUndo()).toBe(false);
    store.commitRedo(entry("edit-back")); // redo
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
