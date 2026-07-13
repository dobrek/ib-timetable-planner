import { describe, expect, it } from "vitest";
import { row } from "./__fixtures__/builders";
import { expandLanes, laneStats, lanesOf } from "./lanes";

const byCourse = (candidate: { courseId: string }): string[] => [candidate.courseId];

describe("expandLanes", () => {
  it("fans a `both`-week row into both concrete lanes", () => {
    const lanes = expandLanes([row("dp1", "math", 1, 3)], byCourse);

    expect(lanes).toHaveLength(2);
    expect(lanes.map((lane) => lane.weekLane).sort()).toEqual(["a", "b"]);
    expect(lanes.every((lane) => lane.entityKey === "math" && lane.day === 1)).toBe(true);
  });

  it("keeps a biweekly row in its own lane only", () => {
    const lanes = expandLanes([row("dp1", "cas", 3, 8, "a")], byCourse);

    expect(lanes).toEqual([{ entityKey: "cas", day: 3, weekLane: "a", periods: [8] }]);
  });

  it("fans one row out to every key the keyFn returns, and drops keyless rows", () => {
    const rows = [row("dp1", "art", 2, 1), row("dp1", "unlisted", 2, 2)];
    const teachersOf = new Map([["art", ["t1", "t2"]]]);

    const lanes = expandLanes(rows, (candidate) => teachersOf.get(candidate.courseId) ?? []);

    expect(lanes.map((lane) => `${lane.entityKey}/${lane.weekLane}`).sort()).toEqual(["t1/a", "t1/b", "t2/a", "t2/b"]);
  });

  it("collapses two courses sharing a period into one occupied hour of the lane", () => {
    const rows = [row("dp1", "math", 1, 2, "a"), row("dp1", "art", 1, 2, "a")];

    const lanes = expandLanes(rows, () => ["student-1"]);

    expect(lanes).toEqual([{ entityKey: "student-1", day: 1, weekLane: "a", periods: [2] }]);
  });

  it("sorts each lane's periods ascending regardless of row order", () => {
    const rows = [row("dp1", "math", 1, 7, "b"), row("dp1", "math", 1, 2, "b"), row("dp1", "math", 1, 5, "b")];

    expect(expandLanes(rows, byCourse)[0].periods).toEqual([2, 5, 7]);
  });

  it("returns no lanes for no rows", () => {
    expect(expandLanes([], byCourse)).toEqual([]);
  });
});

describe("laneStats", () => {
  it("reports a single period as a span of 1 with no holes", () => {
    expect(laneStats([4])).toEqual({ count: 1, first: 4, last: 4, span: 1, holes: 0, maxStreak: 1 });
  });

  it("counts holes as span minus occupancy and finds the longest streak", () => {
    // P1,P2 | gap P3 | P4,P5,P6 | gap P7 | P8 → span 8, 6 occupied, 2 holes, longest run 3.
    expect(laneStats([1, 2, 4, 5, 6, 8])).toEqual({ count: 6, first: 1, last: 8, span: 8, holes: 2, maxStreak: 3 });
  });

  it("treats a fully packed lane as hole-free with one streak", () => {
    expect(laneStats([5, 6, 7])).toEqual({ count: 3, first: 5, last: 7, span: 3, holes: 0, maxStreak: 3 });
  });

  it("folds an empty period set to all-zeros", () => {
    expect(laneStats([])).toEqual({ count: 0, first: 0, last: 0, span: 0, holes: 0, maxStreak: 0 });
  });
});

describe("lanesOf", () => {
  it("maps the week modes to their concrete lanes", () => {
    expect(lanesOf("both")).toEqual(["a", "b"]);
    expect(lanesOf("a")).toEqual(["a"]);
    expect(lanesOf("b")).toEqual(["b"]);
  });
});
