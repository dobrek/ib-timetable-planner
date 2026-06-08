import { describe, expect, it } from "vitest";
import { readFilterParams, toFilterSearch } from "./filterParams";
import type { CohortTab, TeacherOption } from "./types";

const cohorts: CohortTab[] = [
  { id: "cohort-1", label: "Year 1" },
  { id: "cohort-2", label: "Year 2" },
];
const teachers: TeacherOption[] = [
  { id: "teacher-1", label: "A" },
  { id: "teacher-2", label: "B" },
];

describe("readFilterParams", () => {
  it("defaults to the first cohort, no teachers, merged shown when the query is empty", () => {
    expect(readFilterParams("", cohorts, teachers)).toEqual({
      cohortId: "cohort-1",
      teacherIds: [],
      hideMerged: false,
    });
  });

  it("reads a full filter set from the query", () => {
    expect(readFilterParams("?cohort=cohort-2&teachers=teacher-1,teacher-2&merged=hidden", cohorts, teachers)).toEqual({
      cohortId: "cohort-2",
      teacherIds: ["teacher-1", "teacher-2"],
      hideMerged: true,
    });
  });

  it("falls back to the first cohort when the cohort id is unknown", () => {
    expect(readFilterParams("?cohort=ghost", cohorts, teachers).cohortId).toBe("cohort-1");
  });

  it("drops unknown teacher ids", () => {
    expect(readFilterParams("?teachers=teacher-1,ghost", cohorts, teachers).teacherIds).toEqual(["teacher-1"]);
  });

  it("treats any merged value other than 'hidden' as shown", () => {
    expect(readFilterParams("?merged=yes", cohorts, teachers).hideMerged).toBe(false);
  });
});

describe("toFilterSearch", () => {
  it("omits defaults entirely", () => {
    expect(toFilterSearch({ cohortId: "", teacherIds: [], hideMerged: false })).toBe("");
  });

  it("serializes a full filter set", () => {
    expect(toFilterSearch({ cohortId: "cohort-2", teacherIds: ["teacher-1", "teacher-2"], hideMerged: true })).toBe(
      "cohort=cohort-2&teachers=teacher-1%2Cteacher-2&merged=hidden",
    );
  });

  it("round-trips through readFilterParams", () => {
    const filters = { cohortId: "cohort-2", teacherIds: ["teacher-2"], hideMerged: true };
    expect(readFilterParams(`?${toFilterSearch(filters)}`, cohorts, teachers)).toEqual(filters);
  });
});
