import { describe, expect, it } from "vitest";
import { DEFAULT_PALETTE_COLLAPSED, parsePaletteCollapsed } from "./palette-collapsed";

// `parsePaletteCollapsed` is the SSR↔client contract: the server (Astro page) and the client both
// derive the collapse flag from the same raw cookie value, so a first SSR paint matches the first
// client paint (no hydration flash). Pin its truthiness boundary so that contract can't silently drift.
describe("parsePaletteCollapsed", () => {
  it("treats the literal 'true' as collapsed", () => {
    expect(parsePaletteCollapsed("true")).toBe(true);
  });

  it("treats 'false' as expanded", () => {
    expect(parsePaletteCollapsed("false")).toBe(false);
  });

  it("treats a missing cookie (undefined) as expanded — the default", () => {
    expect(parsePaletteCollapsed(undefined)).toBe(false);
    expect(DEFAULT_PALETTE_COLLAPSED).toBe(false);
  });

  it("treats any other value as expanded (only exact 'true' collapses)", () => {
    expect(parsePaletteCollapsed("")).toBe(false);
    expect(parsePaletteCollapsed("TRUE")).toBe(false);
    expect(parsePaletteCollapsed("1")).toBe(false);
    expect(parsePaletteCollapsed("yes")).toBe(false);
  });
});
