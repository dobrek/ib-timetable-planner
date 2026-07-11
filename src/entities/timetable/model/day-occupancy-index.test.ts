import { describe, expect, it } from "vitest";
import { course, placement } from "./__fixtures__/builders";
import { buildDayOccupancyIndex, EMPTY_DAY_OCCUPANCY_INDEX } from "./day-occupancy-index";
import { catalog } from "./__fixtures__/builders";

describe("buildDayOccupancyIndex", () => {
  it("indexes each course's placements per day, carrying period + week", () => {
    const c = course("C", "T");
    const index = buildDayOccupancyIndex(
      [placement("p1", "C", 1, 2, "a"), placement("p2", "C", 1, 4, "both"), placement("p3", "C", 2, 1)],
      catalog(c),
    );
    expect(index.byCourseDay.get("C")?.get(1)).toEqual([
      { period: 2, week: "a" },
      { period: 4, week: "both" },
    ]);
    expect(index.byCourseDay.get("C")?.get(2)).toEqual([{ period: 1, week: "both" }]);
  });

  it("indexes each student's occupied periods per day, tagged with the source course", () => {
    const a = course("A", "T", ["s1", "s2"]);
    const b = course("B", "T", ["s1"]);
    const index = buildDayOccupancyIndex([placement("p1", "A", 1, 1), placement("p2", "B", 1, 3, "a")], catalog(a, b));
    expect(index.byStudentDay.get("s1")?.get(1)).toEqual([
      { period: 1, week: "both", courseId: "A" },
      { period: 3, week: "a", courseId: "B" },
    ]);
    // s2 only attends A.
    expect(index.byStudentDay.get("s2")?.get(1)).toEqual([{ period: 1, week: "both", courseId: "A" }]);
  });

  it("skips placements whose course is absent from the catalog", () => {
    const index = buildDayOccupancyIndex([placement("p1", "GHOST", 1, 1)], catalog(course("C", "T")));
    expect(index.byCourseDay.size).toBe(0);
    expect(index.byStudentDay.size).toBe(0);
  });

  it("exposes an empty constant with both views present", () => {
    expect(EMPTY_DAY_OCCUPANCY_INDEX.byStudentDay.size).toBe(0);
    expect(EMPTY_DAY_OCCUPANCY_INDEX.byCourseDay.size).toBe(0);
  });
});
