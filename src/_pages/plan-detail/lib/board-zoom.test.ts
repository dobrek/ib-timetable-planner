// @vitest-environment jsdom
// `readZoom` reads `window.localStorage`, so this file opts into jsdom (the node `unit` lane has no
// `window`); the pure-parse tests below run fine under jsdom too.
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, parseZoom, readZoom } from "./board-zoom";

const STORAGE_KEY = "planner-board-zoom"; // module-private in board-zoom.ts; mirrored for the read tests.

// `parseZoom` is the persistence↔SSR contract: `readZoom` and the `useSyncExternalStore` server
// snapshot both flow through it, so a corrupt/absent/hostile localStorage value must never crash the
// board and an out-of-range level must never escape `[MIN, MAX]`. Pin those boundaries here.
describe("parseZoom", () => {
  it("returns DEFAULT_ZOOM for a missing value (null)", () => {
    expect(parseZoom(null)).toEqual(DEFAULT_ZOOM);
  });

  it("returns DEFAULT_ZOOM for invalid JSON", () => {
    expect(parseZoom("{not json")).toEqual(DEFAULT_ZOOM);
  });

  it("returns DEFAULT_ZOOM for a wrong shape (unknown mode / not an object)", () => {
    expect(parseZoom(JSON.stringify({ mode: "auto" }))).toEqual(DEFAULT_ZOOM);
    expect(parseZoom(JSON.stringify({ level: 0.8 }))).toEqual(DEFAULT_ZOOM);
    expect(parseZoom(JSON.stringify(0.8))).toEqual(DEFAULT_ZOOM);
    expect(parseZoom(JSON.stringify(null))).toEqual(DEFAULT_ZOOM);
  });

  it("returns DEFAULT_ZOOM for a manual state with a non-finite level", () => {
    expect(parseZoom(JSON.stringify({ mode: "manual", level: "0.8" }))).toEqual(DEFAULT_ZOOM);
    // NaN/Infinity do not survive JSON.stringify, so feed the raw string a JSON.parse accepts.
    expect(parseZoom('{"mode":"manual","level":null}')).toEqual(DEFAULT_ZOOM);
  });

  it("clamps an out-of-range level into [MIN_ZOOM, MAX_ZOOM]", () => {
    expect(parseZoom(JSON.stringify({ mode: "manual", level: 0.1 }))).toEqual({ mode: "manual", level: MIN_ZOOM });
    expect(parseZoom(JSON.stringify({ mode: "manual", level: 5 }))).toEqual({ mode: "manual", level: MAX_ZOOM });
  });

  it("round-trips a fit state", () => {
    expect(parseZoom(JSON.stringify({ mode: "fit" }))).toEqual({ mode: "fit" });
  });

  it("round-trips a valid in-range manual state", () => {
    expect(parseZoom(JSON.stringify({ mode: "manual", level: 0.9 }))).toEqual({ mode: "manual", level: 0.9 });
  });
});

// `useZoom` feeds `readZoom` to `useSyncExternalStore`, which loops forever (React error #185) if
// `getSnapshot` returns a fresh object while the store is unchanged. Pin the referential-stability
// contract so a future refactor that drops the snapshot cache fails here, not in a minified prod build.
describe("readZoom snapshot stability", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns a referentially stable object across calls when the store is unchanged", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: "manual", level: 0.75 }));
    const first = readZoom();
    const second = readZoom();
    expect(second).toBe(first);
    expect(first).toEqual({ mode: "manual", level: 0.75 });
  });

  it("returns a fresh snapshot only after the stored value changes", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: "manual", level: 0.5 }));
    const before = readZoom();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: "fit" }));
    const after = readZoom();
    expect(after).not.toBe(before);
    expect(after).toEqual({ mode: "fit" });
  });
});
