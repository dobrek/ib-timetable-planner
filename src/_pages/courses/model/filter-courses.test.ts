import { describe, expect, it } from "vitest";
import type { Cohort } from "@/shared/config";
import { filterCourses } from "./filter-courses";
import type { CourseRow } from "./course";

const row = (id: string, cohort: Cohort, teacherIds: string[]): CourseRow => ({
  id,
  cohort,
  name: `Course ${id}`,
  level: "SL",
  groupIndex: 0,
  hours: 4,
  weekMode: "agnostic",
  color: null,
  finishesEarly: false,
  teacherIds,
  teacherLabels: teacherIds,
  isMerged: false,
  mergeChildIds: [],
  overlaps: [],
});

const courses: CourseRow[] = [
  row("a", "dp1", ["t1"]),
  row("b", "dp1", ["t2"]),
  row("c", "dp2", ["t1"]),
  row("d", "dp1", []),
];

describe("filterCourses", () => {
  it("returns only the active cohort's rows when no teacher is selected", () => {
    expect(filterCourses(courses, "dp1", []).map((r) => r.id)).toEqual(["a", "b", "d"]);
  });

  it("narrows to rows taught by any selected teacher", () => {
    expect(filterCourses(courses, "dp1", ["t1"]).map((r) => r.id)).toEqual(["a"]);
  });

  it("treats multiple selected teachers as a union", () => {
    expect(filterCourses(courses, "dp1", ["t1", "t2"]).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("excludes teacherless rows when a teacher filter is active", () => {
    expect(filterCourses(courses, "dp1", ["t1"]).some((r) => r.id === "d")).toBe(false);
  });

  it("keeps a co-taught row when any of its teachers is selected", () => {
    const coTaught: CourseRow[] = [row("x", "dp1", ["t2", "t3"])];
    expect(filterCourses(coTaught, "dp1", ["t3"]).map((r) => r.id)).toEqual(["x"]);
    expect(filterCourses(coTaught, "dp1", ["t9"]).map((r) => r.id)).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const snapshot = JSON.stringify(courses);
    filterCourses(courses, "dp1", ["t1"]);
    expect(JSON.stringify(courses)).toBe(snapshot);
  });
});
