import { describe, expect, it } from "vitest";
import { courseInput, overlapInput, updateCourseInput } from "./schemas";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";

const validCourse = {
  planId: PLAN_ID,
  name: "Mathematics",
  level: "HL" as const,
  groupIndex: 1 as const,
  hoursPerWeek: 4,
  cohort: "dp1" as const,
  weekMode: "agnostic" as const,
  teacherIds: [UUID_B],
};

describe("courseInput", () => {
  it("accepts a valid atomic course", () => {
    expect(courseInput.parse(validCourse)).toEqual(validCourse);
  });

  it("defaults weekMode to agnostic when omitted", () => {
    const { weekMode: _omitted, ...withoutWeekMode } = validCourse;
    expect(courseInput.parse(withoutWeekMode).weekMode).toBe("agnostic");
  });

  it("accepts a bi-weekly course", () => {
    expect(courseInput.parse({ ...validCourse, weekMode: "biweekly" }).weekMode).toBe("biweekly");
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

  it("accepts multiple co-teachers", () => {
    expect(courseInput.parse({ ...validCourse, teacherIds: [UUID_A, UUID_B] }).teacherIds).toEqual([UUID_A, UUID_B]);
  });

  it("rejects a missing teacherIds", () => {
    const { teacherIds: _omit, ...withoutTeachers } = validCourse;
    expect(courseInput.safeParse(withoutTeachers).success).toBe(false);
  });

  it("rejects an empty teacherIds set (.min(1))", () => {
    expect(courseInput.safeParse({ ...validCourse, teacherIds: [] }).success).toBe(false);
  });

  it("rejects a non-uuid teacher id", () => {
    expect(courseInput.safeParse({ ...validCourse, teacherIds: ["not-a-uuid"] }).success).toBe(false);
  });

  it("rejects an unknown cohort value", () => {
    expect(courseInput.safeParse({ ...validCourse, cohort: "dp3" }).success).toBe(false);
  });

  it("rejects a missing planId", () => {
    const { planId: _omit, ...withoutPlan } = validCourse;
    expect(courseInput.safeParse(withoutPlan).success).toBe(false);
  });

  it("rejects a non-uuid planId", () => {
    expect(courseInput.safeParse({ ...validCourse, planId: "not-a-uuid" }).success).toBe(false);
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
    expect(overlapInput.safeParse({ planId: PLAN_ID, baseCourseId: UUID_A, dependentCourseId: UUID_B }).success).toBe(
      true,
    );
  });

  it("rejects equal base and dependent (self-link)", () => {
    expect(overlapInput.safeParse({ planId: PLAN_ID, baseCourseId: UUID_A, dependentCourseId: UUID_A }).success).toBe(
      false,
    );
  });

  it("rejects a non-uuid course id", () => {
    expect(overlapInput.safeParse({ planId: PLAN_ID, baseCourseId: "x", dependentCourseId: UUID_B }).success).toBe(
      false,
    );
  });

  it("rejects a missing planId", () => {
    expect(overlapInput.safeParse({ baseCourseId: UUID_A, dependentCourseId: UUID_B }).success).toBe(false);
  });
});
