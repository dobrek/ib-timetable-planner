import { describe, expect, it } from "vitest";
import { filterCourses } from "./useCourseFilters";
import type { CourseRow } from "@/entities/course";

const row = (id: string, cohortId: string, teacherId: string | null): CourseRow => ({
  id,
  cohortId,
  name: `Course ${id}`,
  level: "SL",
  groupIndex: 0,
  hours: 4,
  teacherId,
  teacherLabel: teacherId,
  isMerged: false,
  mergeChildIds: [],
  overlaps: [],
});

const courses: CourseRow[] = [row("a", "c1", "t1"), row("b", "c1", "t2"), row("c", "c2", "t1"), row("d", "c1", null)];

describe("filterCourses", () => {
  it("returns only the active cohort's rows when no teacher is selected", () => {
    expect(filterCourses(courses, "c1", []).map((r) => r.id)).toEqual(["a", "b", "d"]);
  });

  it("narrows to rows taught by any selected teacher", () => {
    expect(filterCourses(courses, "c1", ["t1"]).map((r) => r.id)).toEqual(["a"]);
  });

  it("treats multiple selected teachers as a union", () => {
    expect(filterCourses(courses, "c1", ["t1", "t2"]).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("excludes teacherless rows when a teacher filter is active", () => {
    expect(filterCourses(courses, "c1", ["t1"]).some((r) => r.id === "d")).toBe(false);
  });

  it("drops merged courses when hideMerged is set", () => {
    const withMerged: CourseRow[] = [...courses, { ...row("e", "c1", "t1"), isMerged: true }];
    expect(filterCourses(withMerged, "c1", [], true).map((r) => r.id)).toEqual(["a", "b", "d"]);
    expect(filterCourses(withMerged, "c1", [], false).map((r) => r.id)).toEqual(["a", "b", "d", "e"]);
  });

  it("does not mutate its inputs", () => {
    const snapshot = JSON.stringify(courses);
    filterCourses(courses, "c1", ["t1"], true);
    expect(JSON.stringify(courses)).toBe(snapshot);
  });
});
