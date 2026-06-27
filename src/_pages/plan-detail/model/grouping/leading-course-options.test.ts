import { describe, expect, it } from "vitest";
import { leadingCourseOptions, sortByGroupCount, sortByName } from "./leading-course-options";
import type { LeadingCourseOption } from "./leading-course-options";
import type { PlannerGrouping } from "./grouping";

const grouping = (id: string, memberIds: string[]): PlannerGrouping => ({
  id,
  memberIds,
  coverageCount: 0,
  score: 0,
  oppositeWeek: false,
});

const option = (id: string, name: string, groupCount: number): LeadingCourseOption => ({ id, name, groupCount });

describe("leadingCourseOptions", () => {
  it("produces one entry per distinct member course with its group count", () => {
    const options = leadingCourseOptions(
      [grouping("g1", ["c-a", "c-b"]), grouping("g2", ["c-a", "c-c"]), grouping("g3", ["c-a"])],
      { "c-a": "Alpha", "c-b": "Beta", "c-c": "Gamma" },
    );
    const byId = new Map(options.map((o) => [o.id, o]));
    expect(byId.size).toBe(3);
    expect(byId.get("c-a")?.groupCount).toBe(3);
    expect(byId.get("c-b")?.groupCount).toBe(1);
    expect(byId.get("c-c")?.groupCount).toBe(1);
  });

  it("resolves the name from `names`, falling back to the id when missing", () => {
    const options = leadingCourseOptions([grouping("g1", ["c-a", "c-b"])], { "c-a": "Alpha" });
    const byId = new Map(options.map((o) => [o.id, o.name]));
    expect(byId.get("c-a")).toBe("Alpha");
    expect(byId.get("c-b")).toBe("c-b");
  });

  it("returns an empty array when there are no groupings", () => {
    expect(leadingCourseOptions([], {})).toEqual([]);
  });
});

describe("sortByGroupCount", () => {
  it("orders ascending by group count (fewest groupings first)", () => {
    const sorted = sortByGroupCount([option("a", "Alpha", 3), option("b", "Beta", 1), option("c", "Gamma", 2)]);
    expect(sorted.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks equal counts by name then id", () => {
    const sorted = sortByGroupCount([option("z", "Same", 2), option("a", "Same", 2), option("m", "Earlier", 2)]);
    expect(sorted.map((o) => o.id)).toEqual(["m", "a", "z"]);
  });

  it("does not mutate the input array", () => {
    const input = [option("a", "Alpha", 3), option("b", "Beta", 1)];
    const original = input.map((o) => o.id);
    sortByGroupCount(input);
    expect(input.map((o) => o.id)).toEqual(original);
  });

  it("returns an empty array unchanged", () => {
    expect(sortByGroupCount([])).toEqual([]);
  });
});

describe("sortByName", () => {
  it("orders alphabetically with id as the tiebreaker", () => {
    const sorted = sortByName([option("z", "Same", 1), option("a", "Same", 1), option("b", "Alpha", 9)]);
    expect(sorted.map((o) => o.id)).toEqual(["b", "a", "z"]);
  });

  it("does not mutate the input array", () => {
    const input = [option("b", "Beta", 1), option("a", "Alpha", 1)];
    const original = input.map((o) => o.id);
    sortByName(input);
    expect(input.map((o) => o.id)).toEqual(original);
  });

  it("returns an empty array unchanged", () => {
    expect(sortByName([])).toEqual([]);
  });
});
