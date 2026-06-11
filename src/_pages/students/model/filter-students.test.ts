import { describe, expect, it } from "vitest";
import type { Cohort } from "@/shared/config";
import { filterStudents } from "./filter-students";
import type { StudentRow } from "./student";

const student = (id: string, cohort: Cohort, fullName: string, choiceCourseIds: string[] = []): StudentRow => ({
  id,
  cohort,
  fullName,
  choiceCourseIds,
});

const students: StudentRow[] = [
  student("s1", "dp1", "Alice Parker", ["c1", "c2"]),
  student("s2", "dp1", "Bob Stone"),
  student("s3", "dp2", "Alicia Keys", ["c3"]),
];

describe("filterStudents", () => {
  it("returns all students in the cohort when query is empty", () => {
    expect(filterStudents(students, "dp1", "").map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("partitions by cohort", () => {
    expect(filterStudents(students, "dp2", "").map((s) => s.id)).toEqual(["s3"]);
  });

  it("matches full name (case-insensitive substring)", () => {
    expect(filterStudents(students, "dp1", "ali").map((s) => s.id)).toEqual(["s1"]);
  });

  it("ignores leading/trailing whitespace in the query", () => {
    expect(filterStudents(students, "dp1", "  bob  ").map((s) => s.id)).toEqual(["s2"]);
  });

  it("returns nothing when no name matches in the cohort", () => {
    expect(filterStudents(students, "dp1", "zoe")).toEqual([]);
  });

  it("keeps all cohort students when the course selection is empty", () => {
    expect(filterStudents(students, "dp1", "", []).map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("keeps students whose choices intersect the selection", () => {
    expect(filterStudents(students, "dp1", "", ["c2"]).map((s) => s.id)).toEqual(["s1"]);
  });

  it("treats the selection as a union (any chosen course matches)", () => {
    expect(filterStudents(students, "dp1", "", ["c1", "c9"]).map((s) => s.id)).toEqual(["s1"]);
  });

  it("excludes students with no intersecting choice", () => {
    expect(filterStudents(students, "dp1", "", ["c3"])).toEqual([]);
  });

  it("composes the query and course-selection clauses", () => {
    expect(filterStudents(students, "dp1", "bob", ["c2"])).toEqual([]);
    expect(filterStudents(students, "dp1", "alice", ["c2"]).map((s) => s.id)).toEqual(["s1"]);
  });

  it("does not mutate its inputs", () => {
    const snapshot = JSON.stringify(students);
    filterStudents(students, "dp1", "ali", ["c1"]);
    expect(JSON.stringify(students)).toBe(snapshot);
  });
});
