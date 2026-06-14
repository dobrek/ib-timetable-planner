import { describe, expect, it } from "vitest";
import { DEFAULT_GRID, GRID_BOUNDS, parseGridPreset } from "./grid";

describe("parseGridPreset", () => {
  it("parses a well-formed <days>x<periods> preset", () => {
    expect(parseGridPreset("5x8")).toEqual({ days: 5, periods: 8 });
  });

  it("trims surrounding whitespace", () => {
    expect(parseGridPreset("  5x8  ")).toEqual({ days: 5, periods: 8 });
  });

  it("falls back to DEFAULT_GRID for null/undefined/empty", () => {
    expect(parseGridPreset(null)).toEqual(DEFAULT_GRID);
    expect(parseGridPreset(undefined)).toEqual(DEFAULT_GRID);
    expect(parseGridPreset("")).toEqual(DEFAULT_GRID);
  });

  it("falls back for unparseable input", () => {
    expect(parseGridPreset("abc")).toEqual(DEFAULT_GRID);
    expect(parseGridPreset("5x")).toEqual(DEFAULT_GRID);
  });

  it("falls back for non-positive dimensions", () => {
    expect(parseGridPreset("0x10")).toEqual(DEFAULT_GRID);
  });

  it("falls back when beyond GRID_BOUNDS", () => {
    expect(parseGridPreset(`${GRID_BOUNDS.maxDays + 1}x10`)).toEqual(DEFAULT_GRID);
    expect(parseGridPreset(`5x${GRID_BOUNDS.maxPeriods + 1}`)).toEqual(DEFAULT_GRID);
  });

  it("accepts the GRID_BOUNDS ceiling", () => {
    expect(parseGridPreset(`${GRID_BOUNDS.maxDays}x${GRID_BOUNDS.maxPeriods}`)).toEqual({
      days: GRID_BOUNDS.maxDays,
      periods: GRID_BOUNDS.maxPeriods,
    });
  });
});
