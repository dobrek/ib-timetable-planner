import { describe, expect, it } from "vitest";
import { companionCourseOptions } from "./companion-course-options";
import type { PlannerGrouping } from "./grouping";

const grouping = (id: string, memberIds: string[]): PlannerGrouping => ({
  id,
  memberIds,
  coverageCount: 0,
  score: 0,
  oppositeWeek: false,
});

const names = { "c-a": "Alpha", "c-b": "Beta", "c-c": "Gamma" };

describe("companionCourseOptions", () => {
  it("returns an empty array when no leading course is set", () => {
    expect(companionCourseOptions([grouping("g1", ["c-a", "c-b"])], names, null)).toEqual([]);
  });

  it("lists only courses co-occurring with the leading course, excluding the leading course itself", () => {
    const options = companionCourseOptions(
      [grouping("g1", ["c-a", "c-b"]), grouping("g2", ["c-a", "c-c"]), grouping("g3", ["c-b", "c-c"])],
      names,
      "c-a",
    );
    expect(options.map((o) => o.id).toSorted()).toEqual(["c-b", "c-c"]);
    expect(options.some((o) => o.id === "c-a")).toBe(false);
  });

  it("counts the groupings containing BOTH the leading course and the companion", () => {
    const options = companionCourseOptions(
      [
        grouping("g1", ["c-a", "c-b"]),
        grouping("g2", ["c-a", "c-b"]),
        grouping("g3", ["c-a", "c-c"]),
        grouping("g4", ["c-b", "c-c"]), // no leading course → excluded from the subset
      ],
      names,
      "c-a",
    );
    const byId = new Map(options.map((o) => [o.id, o.groupCount]));
    expect(byId.get("c-b")).toBe(2);
    expect(byId.get("c-c")).toBe(1);
  });

  it("returns an empty array when the leading course matches no groupings", () => {
    expect(companionCourseOptions([grouping("g1", ["c-b", "c-c"])], names, "c-a")).toEqual([]);
  });

  it("falls back to the id when a name is missing", () => {
    const options = companionCourseOptions([grouping("g1", ["c-a", "c-x"])], names, "c-a");
    const byId = new Map(options.map((o) => [o.id, o.name]));
    expect(byId.get("c-x")).toBe("c-x");
  });
});
