import { describe, expect, it } from "vitest";
import { hasIntersection } from "./collision";
import type { GroupingCourse } from "./grouping";

const course = (id: string, teacher: string | null, studentKeys: string[]): GroupingCourse => ({
  id,
  teacherKeys: teacher === null ? [] : [teacher],
  studentKeys,
  hours: 4,
});

describe("hasIntersection", () => {
  it("returns true when same id is in list", () => {
    const c = course("A", "t1", ["s1"]);
    expect(hasIntersection(c, [c])).toBe(true);
  });

  it("returns true when teacher key matches (both non-null)", () => {
    expect(hasIntersection(course("A", "t1", ["s1"]), [course("B", "t1", ["s2"])])).toBe(true);
  });

  it("returns false when both teacherKeys are null", () => {
    expect(hasIntersection(course("A", null, ["s1"]), [course("B", null, ["s2"])])).toBe(false);
  });

  it("returns false when one teacherKey is null", () => {
    expect(hasIntersection(course("A", "t1", ["s1"]), [course("B", null, ["s2"])])).toBe(false);
  });

  it("returns true when a student key is shared", () => {
    expect(hasIntersection(course("A", null, ["s1", "s2"]), [course("B", null, ["s3", "s2"])])).toBe(true);
  });

  it("returns false when no overlap at all", () => {
    expect(hasIntersection(course("A", "t1", ["s1"]), [course("B", "t2", ["s2"])])).toBe(false);
  });
});
