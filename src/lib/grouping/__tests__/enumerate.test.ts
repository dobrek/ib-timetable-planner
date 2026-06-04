import { describe, expect, it } from "vitest";
import { enumerateVariants } from "../enumerate";
import type { GroupingCourse } from "../types";

const course = (id: string, teacherKey: string | null, studentKeys: string[]): GroupingCourse => ({
  id,
  teacherKey,
  studentKeys,
  hours: 4,
});

// A conflicts with B (shared teacher t1); A and C are compatible; B and C are compatible
const A = course("A", "t1", ["s1"]);
const B = course("B", "t1", ["s2"]);
const C = course("C", "t2", ["s3"]);

describe("enumerateVariants", () => {
  it("returns all maximal independent sets containing seed", () => {
    const keys = enumerateVariants(A, [A, B, C], 100).map((set) =>
      set
        .map((c) => c.id)
        .toSorted()
        .join(","),
    );
    expect(keys).toContain("A,C");
    expect(keys).not.toContain("A,B");
  });

  it("is deterministic across two runs", () => {
    const toKeys = (sets: GroupingCourse[][]) =>
      sets.map((set) =>
        set
          .map((c) => c.id)
          .toSorted()
          .join(","),
      );
    expect(toKeys(enumerateVariants(A, [A, B, C], 100))).toEqual(toKeys(enumerateVariants(A, [A, B, C], 100)));
  });

  it("throws when cap is exceeded", () => {
    const courses = [course("X", null, ["s1"]), course("Y", null, ["s2"]), course("Z", null, ["s3"])];
    expect(() => enumerateVariants(courses[0], courses, 0)).toThrow(/cap/i);
  });

  it("returns a set with only the seed when all others conflict", () => {
    const seed = course("S", "t1", ["s1"]);
    const results = enumerateVariants(seed, [seed, course("X", "t1", ["s2"]), course("Y", null, ["s1"])], 100);
    expect(results).toHaveLength(1);
    expect(results[0].map((c) => c.id)).toEqual(["S"]);
  });
});
