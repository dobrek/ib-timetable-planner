import { describe, expect, it } from "vitest";
import type { GroupingCourse } from "../grouping";
import { teacherConflict } from "./teacher-conflict";

const course = (id: string, teacher: string | null): GroupingCourse => ({
  id,
  teacherKeys: teacher === null ? [] : [teacher],
  hours: 1,
  studentKeys: [],
});

const coTaught = (id: string, teacherKeys: string[]): GroupingCourse => ({
  id,
  teacherKeys,
  hours: 1,
  studentKeys: [],
});

describe("teacherConflict.explain", () => {
  it("produces no teacher violation for >=2 empty-teacher-set occupants in one cell", () => {
    expect(teacherConflict.explain([course("a", null), course("b", null)])).toEqual([]);
  });

  it("flags one violation per teacher with >=2 courses, carrying member ids", () => {
    expect(
      teacherConflict.explain([course("a", "T1"), course("b", "T1"), course("c", "T2"), course("d", null)]),
    ).toEqual([{ kind: "teacher", teacherKey: "T1", courseIds: ["a", "b"] }]);
  });

  it("flags the single teacher two co-taught courses share, naming just that teacher", () => {
    expect(teacherConflict.explain([coTaught("a", ["t1", "t2"]), coTaught("b", ["t2", "t3"])])).toEqual([
      { kind: "teacher", teacherKey: "t2", courseIds: ["a", "b"] },
    ]);
  });

  it("does not conflict co-taught courses with disjoint teacher sets", () => {
    const a = coTaught("a", ["t1", "t2"]);
    const b = coTaught("b", ["t3", "t4"]);
    expect(teacherConflict.explain([a, b])).toEqual([]);
    expect(teacherConflict.test?.(a, [b])).toBe(false);
  });

  it("tests true when co-taught teacher sets intersect on any teacher", () => {
    expect(teacherConflict.test?.(coTaught("a", ["t1", "t2"]), [coTaught("b", ["t2"])])).toBe(true);
  });
});
