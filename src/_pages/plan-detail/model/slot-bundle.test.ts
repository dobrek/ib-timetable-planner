import { describe, expect, it } from "vitest";
import {
  addOverrideOptimistic,
  addOverrideReconcile,
  addOverrideRollback,
  hasOverride,
  isBundled,
  removeOverrideOptimistic,
  removeOverrideRollback,
  type LocalSlotOverride,
} from "./slot-bundle";

describe("isBundled", () => {
  it("is false for a single occupant (never a bundle)", () => {
    expect(isBundled(1, false)).toBe(false);
  });

  it("is true at the >=2 boundary with no override", () => {
    expect(isBundled(2, false)).toBe(true);
  });

  it("is false for an empty cell", () => {
    expect(isBundled(0, false)).toBe(false);
  });

  it("flips to false when the cell is overridden, even with >=2 occupants", () => {
    expect(isBundled(2, true)).toBe(false);
    expect(isBundled(5, true)).toBe(false);
  });
});

describe("hasOverride", () => {
  it("is true when an override exists at the coordinate", () => {
    expect(hasOverride([{ day: 1, period: 2 }], 1, 2)).toBe(true);
  });

  it("is false for a different coordinate", () => {
    expect(hasOverride([{ day: 1, period: 2 }], 2, 1)).toBe(false);
  });

  it("ignores the pending flag (an in-flight ungroup still reads as overridden)", () => {
    expect(hasOverride([{ day: 3, period: 4, pending: true } as LocalSlotOverride], 3, 4)).toBe(true);
  });

  it("is false for an empty override set", () => {
    expect(hasOverride([], 1, 1)).toBe(false);
  });
});

describe("override transitions", () => {
  it("addOverrideOptimistic appends a pending override", () => {
    expect(addOverrideOptimistic([], 1, 1)).toEqual([{ day: 1, period: 1, pending: true }]);
  });

  it("addOverrideOptimistic does not mutate the input array", () => {
    const prev: LocalSlotOverride[] = [{ day: 2, period: 2 }];
    const snapshot = [...prev];
    addOverrideOptimistic(prev, 1, 1);
    expect(prev).toEqual(snapshot);
  });

  it("addOverrideReconcile clears the pending flag for the cell", () => {
    const prev: LocalSlotOverride[] = [
      { day: 1, period: 1, pending: true },
      { day: 2, period: 2 },
    ];
    expect(addOverrideReconcile(prev, 1, 1)).toEqual([
      { day: 1, period: 1 },
      { day: 2, period: 2 },
    ]);
  });

  it("addOverrideRollback removes the optimistic override", () => {
    const prev: LocalSlotOverride[] = [
      { day: 1, period: 1, pending: true },
      { day: 2, period: 2 },
    ];
    expect(addOverrideRollback(prev, 1, 1)).toEqual([{ day: 2, period: 2 }]);
  });

  it("removeOverrideOptimistic filters out the cell's override", () => {
    const prev: LocalSlotOverride[] = [
      { day: 1, period: 1 },
      { day: 2, period: 2 },
    ];
    expect(removeOverrideOptimistic(prev, 1, 1)).toEqual([{ day: 2, period: 2 }]);
  });

  it("removeOverrideRollback restores the removed override", () => {
    expect(removeOverrideRollback([{ day: 2, period: 2 }], 1, 1)).toEqual([
      { day: 2, period: 2 },
      { day: 1, period: 1 },
    ]);
  });
});

// Locks the verb↔presence mapping against an inverted wiring: ungrouping a bundled cell
// ADDS an override (→ unbundled); regrouping an unbundled cell REMOVES it (→ bundled).
describe("toggle direction guard", () => {
  it("a currently-bundled cell ungroups by adding an override, flipping isBundled to false", () => {
    const occupants = 2;
    expect(isBundled(occupants, hasOverride([], 1, 1))).toBe(true); // bundled to start
    const next = addOverrideOptimistic([], 1, 1);
    expect(isBundled(occupants, hasOverride(next, 1, 1))).toBe(false); // now unbundled
  });

  it("a currently-unbundled cell regroups by removing its override, flipping isBundled to true", () => {
    const occupants = 2;
    const start: LocalSlotOverride[] = [{ day: 1, period: 1 }];
    expect(isBundled(occupants, hasOverride(start, 1, 1))).toBe(false); // unbundled to start
    const next = removeOverrideOptimistic(start, 1, 1);
    expect(isBundled(occupants, hasOverride(next, 1, 1))).toBe(true); // now bundled
  });
});
