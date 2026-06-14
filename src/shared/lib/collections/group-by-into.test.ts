import { describe, expect, it } from "vitest";
import { groupByInto } from "./group-by-into";

describe("groupByInto", () => {
  it("groups and projects each item to a value", () => {
    const rows = [
      { k: "a", v: 1 },
      { k: "a", v: 2 },
      { k: "b", v: 3 },
    ];
    const result = groupByInto(
      rows,
      (r) => r.k,
      (r) => r.v,
    );
    expect(result.get("a")).toEqual([1, 2]);
    expect(result.get("b")).toEqual([3]);
  });

  it("skips null keys when skipNullKeys is set", () => {
    const rows = [
      { k: "a" as string | null, v: 1 },
      { k: null, v: 2 },
      { k: "a", v: 3 },
    ];
    const result = groupByInto(
      rows,
      (r) => r.k,
      (r) => r.v,
      { skipNullKeys: true },
    );
    expect([...result.keys()]).toEqual(["a"]);
    expect(result.get("a")).toEqual([1, 3]);
  });

  it("keeps null keys by default", () => {
    const rows = [
      { k: "a" as string | null, v: 1 },
      { k: null, v: 2 },
    ];
    const result = groupByInto(
      rows,
      (r) => r.k,
      (r) => r.v,
    );
    expect(result.get(null)).toEqual([2]);
  });
});
