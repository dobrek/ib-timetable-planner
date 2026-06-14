import { describe, expect, it } from "vitest";
import { groupBy } from "./group-by";

describe("groupBy", () => {
  it("groups items by key, preserving insertion order", () => {
    const result = groupBy([1, 2, 3, 4], (n) => n % 2);
    expect(result.get(1)).toEqual([1, 3]);
    expect(result.get(0)).toEqual([2, 4]);
  });

  it("returns an empty map for an empty list", () => {
    expect(groupBy<number, number>([], (n) => n).size).toBe(0);
  });
});
