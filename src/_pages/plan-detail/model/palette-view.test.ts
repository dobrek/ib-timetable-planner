import { describe, expect, it } from "vitest";
import { resolvePaletteView } from "./palette-view";

describe("resolvePaletteView", () => {
  it("no groupings → empty (the compute prompt)", () => {
    expect(resolvePaletteView({ groupingsCount: 0, stale: false })).toBe("empty");
  });

  it("no groupings wins over stale (a null stored hash always reads stale, but empty is the right surface)", () => {
    expect(resolvePaletteView({ groupingsCount: 0, stale: true })).toBe("empty");
  });

  it("groupings present + stale → stale (the recompute panel)", () => {
    expect(resolvePaletteView({ groupingsCount: 3, stale: true })).toBe("stale");
  });

  it("groupings present + fresh → ready (the normal palette)", () => {
    expect(resolvePaletteView({ groupingsCount: 3, stale: false })).toBe("ready");
  });
});
