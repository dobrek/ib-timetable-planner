import { describe, expect, it } from "vitest";
import { resolvePaletteView } from "./palette-view";

describe("resolvePaletteView", () => {
  it("no groupings → empty (the compute prompt)", () => {
    expect(resolvePaletteView({ groupingsCount: 0, stale: false, canEdit: true })).toBe("empty");
  });

  it("no groupings wins over stale (a null stored hash always reads stale, but empty is the right surface)", () => {
    expect(resolvePaletteView({ groupingsCount: 0, stale: true, canEdit: true })).toBe("empty");
  });

  it("groupings present + stale → stale (the recompute panel)", () => {
    expect(resolvePaletteView({ groupingsCount: 3, stale: true, canEdit: true })).toBe("stale");
  });

  it("groupings present + fresh → ready (the normal palette)", () => {
    expect(resolvePaletteView({ groupingsCount: 3, stale: false, canEdit: true })).toBe("ready");
  });
});

describe("resolvePaletteView — a caller who may not edit (S-405)", () => {
  // Hidden wins over every other outcome: over empty is what keeps a viewer's focus mode on the
  // timetable (the board's compute-prompt early return fires only on "empty").
  it.each([
    { input: "empty", groupingsCount: 0, stale: false },
    { input: "empty and stale", groupingsCount: 0, stale: true },
    { input: "stale", groupingsCount: 3, stale: true },
    { input: "ready", groupingsCount: 3, stale: false },
  ])("$input input → hidden", ({ groupingsCount, stale }) => {
    expect(resolvePaletteView({ groupingsCount, stale, canEdit: false })).toBe("hidden");
  });
});
