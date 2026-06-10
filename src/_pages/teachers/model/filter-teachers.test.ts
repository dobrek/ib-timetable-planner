import { describe, expect, it } from "vitest";
import { filterTeachers } from "./filter-teachers";
import type { CourseAssignment, TeacherRow } from "./teacher";

const cohorts = [
  { id: "cohort-y1", label: "Year 1" },
  { id: "cohort-y2", label: "Year 2" },
];

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
  teacher("t1", "AP", null, [
    assignment("c1", cohorts[0].id, "Mathematics"),
    assignment("c2", cohorts[1].id, "Physics"),
  ]),
  teacher("t2", "JC", "Jane Cooper", [assignment("c3", cohorts[0].id, "English B")]),
  teacher("t3", "ZZ", null, []),
];

describe("filterTeachers", () => {
  it("returns all teachers when query is empty and year is all", () => {
    expect(filterTeachers(teachers, "", "all", cohorts).map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("matches by code (case-insensitive)", () => {
    expect(filterTeachers(teachers, "ap", "all", cohorts).map((t) => t.id)).toEqual(["t1"]);
  });

  it("matches by full name (case-insensitive)", () => {
    expect(filterTeachers(teachers, "jane", "all", cohorts).map((t) => t.id)).toEqual(["t2"]);
  });

  it("matches by course name within assignments", () => {
    expect(filterTeachers(teachers, "physics", "all", cohorts).map((t) => t.id)).toEqual(["t1"]);
  });

  it("filters to teachers with Y1 assignments when year is y1", () => {
    expect(filterTeachers(teachers, "", "y1", cohorts).map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("filters to teachers with Y2 assignments when year is y2", () => {
    expect(filterTeachers(teachers, "", "y2", cohorts).map((t) => t.id)).toEqual(["t1"]);
  });

  it("matches nothing for a year position with no cohort", () => {
    expect(filterTeachers(teachers, "", "y2", cohorts.slice(0, 1))).toEqual([]);
  });

  it("combines text search and year filter", () => {
    expect(filterTeachers(teachers, "english", "y1", cohorts).map((t) => t.id)).toEqual(["t2"]);
    expect(filterTeachers(teachers, "english", "y2", cohorts)).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const snapshot = JSON.stringify(teachers);
    filterTeachers(teachers, "ap", "y1", cohorts);
    expect(JSON.stringify(teachers)).toBe(snapshot);
  });
});
