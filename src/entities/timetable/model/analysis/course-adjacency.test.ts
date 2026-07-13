import { describe, expect, it } from "vitest";
import { block, row } from "./__fixtures__/builders";
import { deriveCourseAdjacency } from "./course-adjacency";

describe("deriveCourseAdjacency", () => {
  it("reads P3+P4 as an adjacent pair and P3+P5 as a same-day split", () => {
    const paired = deriveCourseAdjacency([row("dp1", "math", 1, 3), row("dp1", "math", 1, 4)]);
    const split = deriveCourseAdjacency([row("dp1", "math", 1, 3), row("dp1", "math", 1, 5)]);

    // A `both`-week double counts in both lanes — the report's counting convention.
    expect(paired).toMatchObject({ adjacentPairs: 2, sameDaySplits: 0, splitCourseIds: [] });
    expect(split).toMatchObject({ adjacentPairs: 0, sameDaySplits: 2, splitCourseIds: ["math"] });
  });

  it("counts a triple period as two pairs per lane", () => {
    expect(deriveCourseAdjacency(block("dp1", "chem", 2, 7, 3, "a")).adjacentPairs).toBe(2);
  });

  it("does not pair the same course across different days", () => {
    const rows = [row("dp1", "math", 1, 4, "a"), row("dp1", "math", 2, 5, "a")];

    expect(deriveCourseAdjacency(rows)).toMatchObject({ adjacentPairs: 0, sameDaySplits: 0 });
  });

  it("does not pair different courses sitting in adjacent periods", () => {
    const rows = [row("dp1", "math", 1, 4, "a"), row("dp1", "bio", 1, 5, "a")];

    expect(deriveCourseAdjacency(rows).adjacentPairs).toBe(0);
  });

  it("counts a biweekly course's split in its own lane only", () => {
    const rows = [row("dp1", "cas", 1, 2, "a"), row("dp1", "cas", 1, 6, "a"), row("dp1", "cas", 1, 3, "b")];

    expect(deriveCourseAdjacency(rows)).toMatchObject({ adjacentPairs: 0, sameDaySplits: 1, splitCourseIds: ["cas"] });
  });

  it("reports the expert's invariant on a doubles-only board: many pairs, zero splits", () => {
    const rows = [
      ...block("dp1", "chem", 1, 9, 2),
      ...block("dp1", "chem", 2, 1, 2),
      ...block("dp1", "chem", 4, 7, 2),
      ...block("dp1", "math", 1, 1, 2),
    ];

    expect(deriveCourseAdjacency(rows)).toMatchObject({ adjacentPairs: 8, sameDaySplits: 0, splitCourseIds: [] });
  });
});
