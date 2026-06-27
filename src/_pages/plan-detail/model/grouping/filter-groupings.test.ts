import { describe, expect, it } from "vitest";
import { filterGroupings } from "./filter-groupings";
import type { PlannerGrouping } from "./grouping";

const grouping = (id: string, memberIds: string[]): PlannerGrouping => ({
  id,
  memberIds,
  coverageCount: 0,
  score: 0,
  oppositeWeek: false,
});

describe("filterGroupings", () => {
  const g1 = grouping("g1", ["c-a", "c-b"]);
  const g2 = grouping("g2", ["c-a", "c-c"]);
  const g3 = grouping("g3", ["c-b", "c-c"]);
  const all = [g1, g2, g3];

  it("returns the groupings in their original order when both ids are null", () => {
    expect(filterGroupings(all, null, null).map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
  });

  it("keeps only groupings containing the leading course", () => {
    expect(filterGroupings(all, "c-a", null).map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("keeps only groupings containing the companion course", () => {
    expect(filterGroupings(all, null, "c-c").map((g) => g.id)).toEqual(["g2", "g3"]);
  });

  it("intersects both predicates — only groupings containing both courses", () => {
    expect(filterGroupings(all, "c-a", "c-c").map((g) => g.id)).toEqual(["g2"]);
  });

  it("companion narrows a leading-filtered result", () => {
    expect(filterGroupings(all, "c-a", "c-b").map((g) => g.id)).toEqual(["g1"]);
  });

  it("does not mutate the input array", () => {
    const input = [g1, g2, g3];
    const original = input.map((g) => g.id);
    filterGroupings(input, "c-a", "c-c");
    expect(input.map((g) => g.id)).toEqual(original);
  });
});
