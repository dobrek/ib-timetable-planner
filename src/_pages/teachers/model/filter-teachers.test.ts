import { describe, expect, it } from "vitest";
import { filterTeachers } from "./filter-teachers";
import type { CourseAssignment, TeacherRow } from "./teacher";

const cohortIds = { y1: "cohort-y1", y2: "cohort-y2" };

const assignment = (id: string, cohortId: string, name: string): CourseAssignment => ({
  id,
  cohortId,
  name,
  level: "SL",
  groupIndex: 0,
  hours: 4,
});

const teacher = (
  id: string,
  code: string,
  fullName: string | null,
  assignments: CourseAssignment[] = [],
): TeacherRow => ({
  id,
  code,
  fullName,
  assignments,
});

const teachers: TeacherRow[] = [
  teacher("t1", "AP", null, [assignment("c1", cohortIds.y1, "Mathematics"), assignment("c2", cohortIds.y2, "Physics")]),
  teacher("t2", "JC", "Jane Cooper", [assignment("c3", cohortIds.y1, "English B")]),
  teacher("t3", "ZZ", null, []),
];

describe("filterTeachers", () => {
  it("returns all teachers when query is empty and year is all", () => {
    expect(filterTeachers(teachers, "", "all", cohortIds).map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("matches by code (case-insensitive)", () => {
    expect(filterTeachers(teachers, "ap", "all", cohortIds).map((t) => t.id)).toEqual(["t1"]);
  });

  it("matches by full name (case-insensitive)", () => {
    expect(filterTeachers(teachers, "jane", "all", cohortIds).map((t) => t.id)).toEqual(["t2"]);
  });

  it("matches by course name within assignments", () => {
    expect(filterTeachers(teachers, "physics", "all", cohortIds).map((t) => t.id)).toEqual(["t1"]);
  });

  it("filters to teachers with Y1 assignments when year is y1", () => {
    expect(filterTeachers(teachers, "", "y1", cohortIds).map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("filters to teachers with Y2 assignments when year is y2", () => {
    expect(filterTeachers(teachers, "", "y2", cohortIds).map((t) => t.id)).toEqual(["t1"]);
  });

  it("combines text search and year filter", () => {
    expect(filterTeachers(teachers, "english", "y1", cohortIds).map((t) => t.id)).toEqual(["t2"]);
    expect(filterTeachers(teachers, "english", "y2", cohortIds)).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const snapshot = JSON.stringify(teachers);
    filterTeachers(teachers, "ap", "y1", cohortIds);
    expect(JSON.stringify(teachers)).toBe(snapshot);
  });
});
