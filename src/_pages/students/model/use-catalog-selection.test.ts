import { describe, expect, it } from "vitest";
import { toggleAllSelection, toggleId } from "./use-catalog-selection";

describe("toggleId", () => {
  it("adds an id that is absent", () => {
    expect([...toggleId(new Set(["a"]), "b")].sort()).toEqual(["a", "b"]);
  });

  it("removes an id that is present", () => {
    expect([...toggleId(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });

  it("does not mutate the input set", () => {
    const current = new Set(["a"]);
    toggleId(current, "b");
    expect([...current]).toEqual(["a"]);
  });
});

describe("toggleAllSelection", () => {
  it("selects all visible rows when none are selected", () => {
    expect([...toggleAllSelection(new Set(), ["a", "b", "c"])].sort()).toEqual(["a", "b", "c"]);
  });

  it("promotes a partial selection to full (select-all, not clear)", () => {
    expect([...toggleAllSelection(new Set(["a"]), ["a", "b", "c"])].sort()).toEqual(["a", "b", "c"]);
  });

  it("clears when every visible row is already selected", () => {
    expect([...toggleAllSelection(new Set(["a", "b"]), ["a", "b"])]).toEqual([]);
  });

  it("returns empty for an empty visible set", () => {
    expect([...toggleAllSelection(new Set(["a"]), [])]).toEqual([]);
  });
});
