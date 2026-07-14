import { describe, expect, it } from "vitest";
import { canCompare, compareHref, EMPTY_SELECTION, toggleAllSelection, toggleId } from "./plan-selection";

const PLANS = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("toggleId", () => {
  it("adds an absent id and removes a present one", () => {
    expect([...toggleId(EMPTY_SELECTION, "a")]).toEqual(["a"]);
    expect([...toggleId(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });

  it("never mutates the set it is given", () => {
    const current = new Set(["a"]);
    toggleId(current, "b");
    expect([...current]).toEqual(["a"]);
  });
});

describe("toggleAllSelection", () => {
  it("takes every row when the selection is partial", () => {
    expect([...toggleAllSelection(new Set(["a"]), ["a", "b", "c"])]).toEqual(["a", "b", "c"]);
  });

  it("clears when every row is already ticked", () => {
    expect([...toggleAllSelection(new Set(["a", "b", "c"]), ["a", "b", "c"])]).toEqual([]);
  });

  it("stays empty when there are no rows", () => {
    expect([...toggleAllSelection(EMPTY_SELECTION, [])]).toEqual([]);
  });
});

describe("compareHref", () => {
  it("lists the selected plans in the hub's row order — and names no baseline", () => {
    expect(compareHref(PLANS, new Set(["c", "a"]))).toBe("/plans/compare?plans=a,c");
  });
});

describe("canCompare", () => {
  it("needs at least two plans — one plan's vector is just that plan's vector", () => {
    expect(canCompare(EMPTY_SELECTION)).toBe(false);
    expect(canCompare(new Set(["a"]))).toBe(false);
    expect(canCompare(new Set(["a", "b"]))).toBe(true);
  });
});
