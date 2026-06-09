import { describe, expect, it } from "vitest";
import { courseInput, overlapInput, updateCourseInput } from "./schemas";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const validCourse = {
  name: "Mathematics",
  level: "HL" as const,
  groupIndex: 1 as const,
  hoursPerWeek: 4,
  cohortId: UUID_A,
  teacherId: UUID_B,
};

describe("courseInput", () => {
  it("accepts a valid atomic course", () => {
    expect(courseInput.parse(validCourse)).toEqual(validCourse);
  });

  it("trims the name", () => {
    expect(courseInput.parse({ ...validCourse, name: "  Biology  " }).name).toBe("Biology");
  });

  it("rejects an empty name", () => {
    expect(courseInput.safeParse({ ...validCourse, name: "   " }).success).toBe(false);
  });

  it("accepts a composite (merge-parent) level as free text", () => {
    expect(courseInput.safeParse({ ...validCourse, level: "AB+SL" }).success).toBe(true);
  });

  it('normalizes an empty/blank level to "none"', () => {
    expect(courseInput.parse({ ...validCourse, level: "  " }).level).toBe("none");
  });

  it("rejects an out-of-range group index", () => {
    expect(courseInput.safeParse({ ...validCourse, groupIndex: 4 }).success).toBe(false);
  });

  it("accepts group index 3", () => {
    expect(courseInput.safeParse({ ...validCourse, groupIndex: 3 }).success).toBe(true);
  });

  it("accepts the 0 group-index sentinel (none)", () => {
    expect(courseInput.safeParse({ ...validCourse, groupIndex: 0 }).success).toBe(true);
  });

  it("accepts hoursPerWeek = 0 (merge-child sentinel, DB-aligned)", () => {
    expect(courseInput.safeParse({ ...validCourse, hoursPerWeek: 0 }).success).toBe(true);
  });

  it("rejects negative hoursPerWeek", () => {
    expect(courseInput.safeParse({ ...validCourse, hoursPerWeek: -2 }).success).toBe(false);
  });

  it("rejects non-integer hoursPerWeek", () => {
    expect(courseInput.safeParse({ ...validCourse, hoursPerWeek: 3.5 }).success).toBe(false);
  });

  it("rejects a missing teacherId", () => {
    const { teacherId: _omit, ...withoutTeacher } = validCourse;
    expect(courseInput.safeParse(withoutTeacher).success).toBe(false);
  });

  it("rejects an empty teacherId", () => {
    expect(courseInput.safeParse({ ...validCourse, teacherId: "" }).success).toBe(false);
  });

  it("rejects a non-uuid cohortId", () => {
    expect(courseInput.safeParse({ ...validCourse, cohortId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("updateCourseInput", () => {
  it("accepts a valid course with an id", () => {
    expect(updateCourseInput.safeParse({ ...validCourse, id: UUID_A }).success).toBe(true);
  });

  it("rejects a missing id", () => {
    expect(updateCourseInput.safeParse(validCourse).success).toBe(false);
  });
});

describe("overlapInput", () => {
  it("accepts a valid directed pair", () => {
    expect(overlapInput.safeParse({ baseCourseId: UUID_A, dependentCourseId: UUID_B }).success).toBe(true);
  });

  it("rejects equal base and dependent (self-link)", () => {
    expect(overlapInput.safeParse({ baseCourseId: UUID_A, dependentCourseId: UUID_A }).success).toBe(false);
  });

  it("rejects a non-uuid course id", () => {
    expect(overlapInput.safeParse({ baseCourseId: "x", dependentCourseId: UUID_B }).success).toBe(false);
  });
});
