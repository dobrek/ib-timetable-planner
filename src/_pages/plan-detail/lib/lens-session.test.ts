import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LensCriterion } from "@/entities/timetable";
import { readLensSession, writeLensSession } from "./lens-session";

// Node-env suite (the `unit` project): `window` is absent by default — which pins the SSR guard —
// and a Map-backed stub stands in for sessionStorage everywhere else, swapped per test for the
// throwing variants (private mode / storage policy).

const criteria: LensCriterion[] = [
  { kind: "course", key: "c-math" },
  { kind: "teacher", key: "t-kk" },
];

const store = new Map<string, string>();

const workingStorage = {
  getItem: (key: string): string | null => store.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    store.set(key, value);
  },
  removeItem: (key: string): void => {
    store.delete(key);
  },
};

const throwingStorage = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: (): void => {
    throw new Error("blocked");
  },
  removeItem: (): void => {
    throw new Error("blocked");
  },
};

beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", { sessionStorage: workingStorage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lens-session", () => {
  it("round-trips criteria per plan key", () => {
    writeLensSession("plan-a", criteria);
    expect(readLensSession("plan-a")).toEqual(criteria);
    expect(readLensSession("plan-b")).toEqual([]);
  });

  it("removes the key when writing an empty list", () => {
    writeLensSession("plan-a", criteria);
    writeLensSession("plan-a", []);
    expect(store.has("planner-lens:plan-a")).toBe(false);
  });

  it("reads [] for a malformed JSON payload", () => {
    store.set("planner-lens:plan-a", "{not json");
    expect(readLensSession("plan-a")).toEqual([]);
  });

  it("reads [] for a well-formed payload of the wrong shape", () => {
    store.set("planner-lens:plan-a", JSON.stringify([{ kind: "ghost", key: 1 }]));
    expect(readLensSession("plan-a")).toEqual([]);
    store.set("planner-lens:plan-a", JSON.stringify({ kind: "course", key: "x" }));
    expect(readLensSession("plan-a")).toEqual([]);
  });

  it("dedupes hand-edited duplicate criteria on read", () => {
    store.set("planner-lens:plan-a", JSON.stringify([criteria[0], criteria[0], criteria[1]]));
    expect(readLensSession("plan-a")).toEqual(criteria);
  });

  it("caps an oversized restored list at 50 criteria", () => {
    const oversized = Array.from({ length: 200 }, (_, i) => ({ kind: "course", key: `c-${String(i)}` }));
    store.set("planner-lens:plan-a", JSON.stringify(oversized));
    expect(readLensSession("plan-a")).toHaveLength(50);
  });

  it("degrades to [] / a silent no-op when storage throws (private mode / policy)", () => {
    vi.stubGlobal("window", { sessionStorage: throwingStorage });
    expect(readLensSession("plan-a")).toEqual([]);
    expect(() => {
      writeLensSession("plan-a", criteria);
    }).not.toThrow();
  });

  it("is inert during SSR (no window)", () => {
    vi.unstubAllGlobals();
    expect(readLensSession("plan-a")).toEqual([]);
    expect(() => {
      writeLensSession("plan-a", criteria);
    }).not.toThrow();
  });
});
