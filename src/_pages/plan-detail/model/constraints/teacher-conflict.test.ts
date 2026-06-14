import { describe, expect, it } from "vitest";
import type { GroupingCourse } from "../grouping";
import { teacherConflict } from "./teacher-conflict";

const course = (id: string, teacherKey: string | null): GroupingCourse => ({
  id,
  teacherKey,
  hours: 1,
  studentKeys: [],
});

describe("teacherConflict.explain", () => {
  it("produces no teacher violation for >=2 null-teacher occupants in one cell", () => {
    expect(teacherConflict.explain([course("a", null), course("b", null)])).toEqual([]);
  });

  it("flags one violation per teacher with >=2 courses, carrying member ids", () => {
    expect(
      teacherConflict.explain([course("a", "T1"), course("b", "T1"), course("c", "T2"), course("d", null)]),
    ).toEqual([{ kind: "teacher", teacherKey: "T1", courseIds: ["a", "b"] }]);
  });
});
