import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, parseZoom } from "./board-zoom";

// `parseZoom` is the persistence↔SSR contract: `readZoom` and the `useSyncExternalStore` server
// snapshot both flow through it, so a corrupt/absent localStorage value must never crash the board and
// an out-of-range level must never escape `[MIN, MAX]`. Pin those boundaries here.
describe("parseZoom", () => {
  it("returns DEFAULT_ZOOM for a missing value (null)", () => {
    expect(parseZoom(null)).toBe(DEFAULT_ZOOM);
  });

  it("returns DEFAULT_ZOOM for an empty / whitespace value", () => {
    expect(parseZoom("")).toBe(DEFAULT_ZOOM);
    expect(parseZoom("   ")).toBe(DEFAULT_ZOOM);
  });

  it("returns DEFAULT_ZOOM for a non-numeric value", () => {
    expect(parseZoom("abc")).toBe(DEFAULT_ZOOM);
    expect(parseZoom("NaN")).toBe(DEFAULT_ZOOM);
  });

  it("clamps an out-of-range level into [MIN_ZOOM, MAX_ZOOM]", () => {
    expect(parseZoom("0.1")).toBe(MIN_ZOOM);
    expect(parseZoom("5")).toBe(MAX_ZOOM);
  });

  it("round-trips a valid in-range level", () => {
    expect(parseZoom("0.9")).toBe(0.9);
    expect(parseZoom(String(MIN_ZOOM))).toBe(MIN_ZOOM);
    expect(parseZoom(String(MAX_ZOOM))).toBe(MAX_ZOOM);
  });
});
