import { describe, expect, it } from "vitest";
import { LADDER_TIER_COUNT, tierLabel } from "./tier-labels";

describe("tierLabel", () => {
  it("reads the engine's camelCase identifiers as prose", () => {
    expect(tierLabel("teacherHoles")).toBe("teacher holes");
    expect(tierLabel("goldenBandDistance")).toBe("golden band");
    expect(tierLabel("doublesDeficit")).toBe("doubles");
    expect(tierLabel("unplacedTotal")).toBe("unplaced");
  });

  it("leaves the already-readable names alone", () => {
    expect(tierLabel("completeness")).toBe("completeness");
    expect(tierLabel("holes")).toBe("holes");
  });

  it("falls back to the raw name so a new engine stage reads raw, never blank", () => {
    expect(tierLabel("someFutureTier")).toBe("someFutureTier");
    expect(tierLabel("")).toBe("");
  });
});

describe("LADDER_TIER_COUNT", () => {
  it("is solve_complete's stage count — the only mode the app dispatches", () => {
    expect(LADDER_TIER_COUNT).toBe(10);
  });
});
