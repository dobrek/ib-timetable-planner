// @vitest-environment jsdom
// `writePaletteCohort` writes `document.cookie`, so this file opts into jsdom (the node `unit`
// lane has no `document`); the pure-parse tests below run fine under jsdom too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME, DEFAULT_PALETTE_COHORT, parsePaletteCohort, writePaletteCohort } from "./palette-cohort";

// `parsePaletteCohort` is the SSR↔client contract: the server (Astro page) and the client both
// derive the palette cohort from the same raw cookie value, so a first SSR paint matches the first
// client paint (no hydration flash). Pin its boundary so that contract can't silently drift.
describe("parsePaletteCohort", () => {
  it("treats the literal 'dp2' as dp2", () => {
    expect(parsePaletteCohort("dp2")).toBe("dp2");
  });

  it("treats 'dp1' as dp1", () => {
    expect(parsePaletteCohort("dp1")).toBe("dp1");
  });

  it("treats a missing cookie (undefined) as dp1 — the default", () => {
    expect(parsePaletteCohort(undefined)).toBe("dp1");
    expect(DEFAULT_PALETTE_COHORT).toBe("dp1");
  });

  it("treats any other value as dp1 (only exact 'dp2' selects dp2)", () => {
    expect(parsePaletteCohort("")).toBe("dp1");
    expect(parsePaletteCohort("DP2")).toBe("dp1");
    expect(parsePaletteCohort("combined")).toBe("dp1");
    expect(parsePaletteCohort("2")).toBe("dp1");
  });
});

// The write side is the dev-safety half of the contract: it must never set `Secure` over plain
// http (or the cookie is silently dropped on localhost) and must carry the scoping attributes.
// jsdom's `document.cookie` getter strips attributes, so capture the raw assignment via an own
// accessor and inspect the string directly.
describe("writePaletteCohort", () => {
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
    writePaletteCohort("dp2");
    const cookie = written.at(-1) ?? "";
    expect(cookie).toContain(`${COOKIE_NAME}=dp2`);
    expect(cookie).toContain("path=/plans");
    expect(cookie).toContain("max-age=31536000");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });

  it("encodes the selected cohort as the literal cohort value", () => {
    writePaletteCohort("dp1");
    expect(written.at(-1)).toContain(`${COOKIE_NAME}=dp1`);
  });

  it("over https (prod) appends Secure", () => {
    vi.stubGlobal("location", { protocol: "https:" });
    writePaletteCohort("dp2");
    expect(written.at(-1)).toContain("; Secure");
  });
});
