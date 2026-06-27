// @vitest-environment jsdom
// `writePaletteCollapsed` writes `document.cookie`, so this file opts into jsdom (the node `unit`
// lane has no `document`); the pure-parse tests below run fine under jsdom too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_NAME,
  DEFAULT_PALETTE_COLLAPSED,
  parsePaletteCollapsed,
  writePaletteCollapsed,
} from "./palette-collapsed";

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

// The write side is the dev-safety half of the contract: it must never set `Secure` over plain
// http (or the cookie is silently dropped on localhost) and must carry the scoping attributes.
// jsdom's `document.cookie` getter strips attributes, so capture the raw assignment via an own
// accessor and inspect the string directly.
describe("writePaletteCollapsed", () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    Object.defineProperty(document, "cookie", {
      configurable: true,
      set: (value: string) => {
        written.push(value);
      },
      get: () => written.join("; "),
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "cookie"); // drop the own accessor → restore jsdom's impl
    vi.unstubAllGlobals();
  });

  it("over http (dev) omits Secure and sets the name/value, path, max-age and SameSite", () => {
    writePaletteCollapsed(true);
    const cookie = written.at(-1) ?? "";
    expect(cookie).toContain(`${COOKIE_NAME}=true`);
    expect(cookie).toContain("path=/plans");
    expect(cookie).toContain("max-age=31536000");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });

  it("encodes the collapsed boolean as the literal true/false value", () => {
    writePaletteCollapsed(false);
    expect(written.at(-1)).toContain(`${COOKIE_NAME}=false`);
  });

  it("over https (prod) appends Secure", () => {
    vi.stubGlobal("location", { protocol: "https:" });
    writePaletteCollapsed(true);
    expect(written.at(-1)).toContain("; Secure");
  });
});
