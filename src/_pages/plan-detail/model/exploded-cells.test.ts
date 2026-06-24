import { describe, expect, it } from "vitest";
import { isBundled, isCellExploded, setCellExploded, type ExplodedCells } from "./exploded-cells";

describe("isBundled", () => {
  it("is false for a single occupant (never a bundle)", () => {
    expect(isBundled(1, false)).toBe(false);
  });

  it("is true at the >=2 boundary when not exploded", () => {
    expect(isBundled(2, false)).toBe(true);
  });

  it("is false for an empty cell", () => {
    expect(isBundled(0, false)).toBe(false);
  });

  it("flips to false when the cell is exploded, even with >=2 occupants", () => {
    expect(isBundled(2, true)).toBe(false);
    expect(isBundled(5, true)).toBe(false);
  });
});

describe("isCellExploded", () => {
  it("is true when the cell is in the exploded set", () => {
    expect(isCellExploded(setCellExploded(new Set(), 1, 2, true), 1, 2)).toBe(true);
  });

  it("is false for a different coordinate", () => {
    expect(isCellExploded(setCellExploded(new Set(), 1, 2, true), 2, 1)).toBe(false);
  });

  it("is false for an empty set (the all-grouped default)", () => {
    expect(isCellExploded(new Set(), 1, 1)).toBe(false);
  });
});

describe("setCellExploded", () => {
  it("adds the cell when exploding", () => {
    expect(isCellExploded(setCellExploded(new Set(), 3, 4, true), 3, 4)).toBe(true);
  });

  it("removes the cell when collapsing", () => {
    const exploded = setCellExploded(new Set(), 3, 4, true);
    expect(isCellExploded(setCellExploded(exploded, 3, 4, false), 3, 4)).toBe(false);
  });

  it("leaves other cells untouched", () => {
    const start = setCellExploded(new Set(), 2, 2, true);
    const next = setCellExploded(start, 1, 1, true);
    expect(isCellExploded(next, 2, 2)).toBe(true);
    expect(isCellExploded(next, 1, 1)).toBe(true);
  });

  it("does not mutate the input set (returns a fresh set)", () => {
    const prev: ExplodedCells = new Set();
    const next = setCellExploded(prev, 1, 1, true);
    expect(prev.size).toBe(0);
    expect(next).not.toBe(prev);
  });

  it("collapsing an already-grouped cell is a no-op", () => {
    expect(isCellExploded(setCellExploded(new Set(), 1, 1, false), 1, 1)).toBe(false);
  });
});

// Locks the verb↔presence mapping against an inverted wiring: ungrouping a bundled cell ADDS it
// to the exploded set (→ unbundled render); regrouping an exploded cell REMOVES it (→ bundled).
describe("toggle direction guard", () => {
  it("a currently-bundled cell ungroups by entering the exploded set, flipping isBundled to false", () => {
    const occupants = 2;
    expect(isBundled(occupants, isCellExploded(new Set(), 1, 1))).toBe(true); // bundled to start
    const next = setCellExploded(new Set(), 1, 1, true);
    expect(isBundled(occupants, isCellExploded(next, 1, 1))).toBe(false); // now unbundled
  });

  it("a currently-exploded cell regroups by leaving the exploded set, flipping isBundled to true", () => {
    const occupants = 2;
    const start = setCellExploded(new Set(), 1, 1, true);
    expect(isBundled(occupants, isCellExploded(start, 1, 1))).toBe(false); // unbundled to start
    const next = setCellExploded(start, 1, 1, false);
    expect(isBundled(occupants, isCellExploded(next, 1, 1))).toBe(true); // now bundled
  });
});
