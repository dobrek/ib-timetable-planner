import { describe, expect, it } from "vitest";
import type { Cohort } from "@/shared/config";
import { filterTeachers } from "./filter-teachers";
import type { CourseAssignment, TeacherRow } from "./teacher";

const assignment = (id: string, cohort: Cohort, name: string): CourseAssignment => ({
  id,
  cohort,
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
  availability: [],
});

const teachers: TeacherRow[] = [
  teacher("t1", "AP", null, [assignment("c1", "dp1", "Mathematics"), assignment("c2", "dp2", "Physics")]),
  teacher("t2", "JC", "Jane Cooper", [assignment("c3", "dp1", "English B")]),
  teacher("t3", "ZZ", null, []),
];

describe("filterTeachers", () => {
  it("returns all teachers when query is empty and cohort is all", () => {
    expect(filterTeachers(teachers, "", "all").map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("matches by code (case-insensitive)", () => {
    expect(filterTeachers(teachers, "ap", "all").map((t) => t.id)).toEqual(["t1"]);
  });

  it("matches by full name (case-insensitive)", () => {
    expect(filterTeachers(teachers, "jane", "all").map((t) => t.id)).toEqual(["t2"]);
  });

  it("matches by course name within assignments", () => {
    expect(filterTeachers(teachers, "physics", "all").map((t) => t.id)).toEqual(["t1"]);
  });

  it("filters to teachers with DP1 assignments when cohort is dp1", () => {
    expect(filterTeachers(teachers, "", "dp1").map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("filters to teachers with DP2 assignments when cohort is dp2", () => {
    expect(filterTeachers(teachers, "", "dp2").map((t) => t.id)).toEqual(["t1"]);
  });

  it("combines text search and cohort filter", () => {
    expect(filterTeachers(teachers, "english", "dp1").map((t) => t.id)).toEqual(["t2"]);
    expect(filterTeachers(teachers, "english", "dp2")).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const snapshot = JSON.stringify(teachers);
    filterTeachers(teachers, "ap", "dp1");
    expect(JSON.stringify(teachers)).toBe(snapshot);
  });
});
