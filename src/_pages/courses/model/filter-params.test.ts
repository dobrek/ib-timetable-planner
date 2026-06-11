import { describe, expect, it } from "vitest";
import { readFilterParams, toFilterSearch } from "./filter-params";
import type { TeacherOption } from "./course";

const teachers: TeacherOption[] = [
  { id: "teacher-1", label: "A" },
  { id: "teacher-2", label: "B" },
];

describe("readFilterParams", () => {
  it("defaults to the first cohort, no teachers, merged shown when the query is empty", () => {
    expect(readFilterParams("", teachers)).toEqual({
      cohort: "dp1",
      teacherIds: [],
      hideMerged: false,
    });
  });

  it("reads a full filter set from the query", () => {
    expect(readFilterParams("?cohort=dp2&teachers=teacher-1,teacher-2&merged=hidden", teachers)).toEqual({
      cohort: "dp2",
      teacherIds: ["teacher-1", "teacher-2"],
      hideMerged: true,
    });
  });

  it("falls back to the first cohort when the cohort value is unknown", () => {
    expect(readFilterParams("?cohort=ghost", teachers).cohort).toBe("dp1");
  });

  it("drops unknown teacher ids", () => {
    expect(readFilterParams("?teachers=teacher-1,ghost", teachers).teacherIds).toEqual(["teacher-1"]);
  });

  it("treats any merged value other than 'hidden' as shown", () => {
    expect(readFilterParams("?merged=yes", teachers).hideMerged).toBe(false);
  });
});

describe("toFilterSearch", () => {
  it("serializes the cohort alone for otherwise-default filters", () => {
    expect(toFilterSearch({ cohort: "dp1", teacherIds: [], hideMerged: false })).toBe("cohort=dp1");
  });

  it("serializes a full filter set", () => {
    expect(toFilterSearch({ cohort: "dp2", teacherIds: ["teacher-1", "teacher-2"], hideMerged: true })).toBe(
      "cohort=dp2&teachers=teacher-1%2Cteacher-2&merged=hidden",
    );
  });

  it("round-trips through readFilterParams", () => {
    const filters = { cohort: "dp2" as const, teacherIds: ["teacher-2"], hideMerged: true };
    expect(readFilterParams(`?${toFilterSearch(filters)}`, teachers)).toEqual(filters);
  });
});
