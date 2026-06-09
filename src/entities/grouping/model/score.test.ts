import { describe, expect, it } from "vitest";
import { scoreVariant } from "./score";
import type { GroupingCourse } from "./types";

const course = (id: string, hours: number, studentKeys: string[]): GroupingCourse => ({
  id,
  teacherKey: null,
  studentKeys,
  hours,
});

describe("scoreVariant", () => {
  it("computes score (similar) correctly", () => {
    // maxHours=4; A→100, B→50; avg=75; round(75)/100 = 0.75
    expect(scoreVariant([course("A", 4, ["s1"]), course("B", 2, ["s2"])], course("A", 4, ["s1"])).score).toBe(0.75);
  });

  it("computes coverageCount as sum not union", () => {
    // s1 appears in both — counted twice
    const result = scoreVariant(
      [course("A", 4, ["s1", "s2"]), course("B", 4, ["s1", "s3"])],
      course("A", 4, ["s1", "s2"]),
    );
    expect(result.coverageCount).toBe(4);
  });

  it("computes rank as sum of hours * studentCount", () => {
    const result = scoreVariant([course("A", 4, ["s1", "s2"]), course("B", 2, ["s3"])], course("A", 4, ["s1", "s2"]));
    expect(result.rank).toBe(10);
  });

  it("places seed first in memberIds", () => {
    const result = scoreVariant(
      [course("A", 4, ["s1"]), course("B", 4, ["s2"]), course("C", 4, ["s3"])],
      course("A", 4, ["s1"]),
    );
    expect(result.memberIds[0]).toBe("A");
  });

  it("sorts non-seed memberIds by id", () => {
    const result = scoreVariant(
      [course("A", 4, ["s1"]), course("C", 4, ["s2"]), course("B", 4, ["s3"])],
      course("A", 4, ["s1"]),
    );
    expect(result.memberIds).toEqual(["A", "B", "C"]);
  });

  it("sets size to number of courses in the set", () => {
    expect(scoreVariant([course("A", 4, ["s1"]), course("B", 4, ["s2"])], course("A", 4, ["s1"])).size).toBe(2);
  });
});
