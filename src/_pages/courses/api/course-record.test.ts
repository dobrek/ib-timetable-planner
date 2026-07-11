import { describe, expect, it } from "vitest";
import { toCourseRecord } from "./course-record";
import type { CourseInput } from "../model/schemas";

const baseInput: CourseInput = {
  planId: "33333333-3333-4333-8333-333333333333",
  name: "Mathematics",
  level: "HL",
  groupIndex: 1,
  hoursPerWeek: 4,
  cohort: "dp1",
  weekMode: "agnostic",
  color: null,
  finishesEarly: false,
  teacherIds: ["22222222-2222-4222-8222-222222222222"],
};

describe("toCourseRecord", () => {
  it("maps camelCase input to the snake_case courses row, including color", () => {
    expect(toCourseRecord({ ...baseInput, color: "rose" })).toEqual({
      plan_id: baseInput.planId,
      cohort: "dp1",
      name: "Mathematics",
      level: "HL",
      group_index: 1,
      hours_per_week: 4,
      week_mode: "agnostic",
      color: "rose",
      finishes_early: false,
    });
  });

  it("emits color: null when no color is set", () => {
    expect(toCourseRecord(baseInput).color).toBeNull();
  });

  it("maps the finishes_early flag when set", () => {
    expect(toCourseRecord({ ...baseInput, finishesEarly: true }).finishes_early).toBe(true);
  });
});
