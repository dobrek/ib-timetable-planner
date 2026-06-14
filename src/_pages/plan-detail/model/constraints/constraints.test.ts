import { describe, expect, it } from "vitest";
import { duplicateCourse } from "./duplicate-course";
import { explainCell, violatesAny } from "./index";
import { studentConflict } from "./student-conflict";
import { teacherAvailability } from "./teacher-availability";
import { teacherConflict } from "./teacher-conflict";
import type { BoardContext } from "./types";
import type { GroupingCourse } from "../grouping";

const course = (id: string, teacherKey: string | null, studentKeys: string[]): GroupingCourse => ({
  id,
  teacherKey,
  studentKeys,
  hours: 4,
});

const ctx = (...courses: GroupingCourse[]): BoardContext => ({
  cell: { day: 1, period: 1 },
  catalogById: new Map(courses.map((c) => [c.id, c])),
});

describe("duplicateCourse", () => {
  it("explains one violation per duplicated id", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    expect(duplicateCourse.explain([a, a, b, b, course("C", "t3", ["s3"])], ctx(a, b))).toEqual([
      { kind: "duplicate-course", courseId: "A" },
      { kind: "duplicate-course", courseId: "B" },
    ]);
  });

  it("explains nothing when all ids are distinct", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    expect(duplicateCourse.explain([a, b], ctx(a, b))).toEqual([]);
  });

  it("tests true when the same id is among others", () => {
    const a = course("A", "t1", ["s1"]);
    expect(duplicateCourse.test?.(a, [a])).toBe(true);
    expect(duplicateCourse.test?.(a, [course("B", "t2", ["s2"])])).toBe(false);
  });
});

describe("teacherConflict", () => {
  it("explains one violation per teacher carrying all member course ids", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t1", ["s2"]);
    const c = course("C", "t1", ["s3"]);
    expect(teacherConflict.explain([a, b, c], ctx(a, b, c))).toEqual([
      { kind: "teacher", teacherKey: "t1", courseIds: ["A", "B", "C"] },
    ]);
  });

  it("never conflicts null teachers", () => {
    const a = course("A", null, ["s1"]);
    const b = course("B", null, ["s2"]);
    expect(teacherConflict.explain([a, b], ctx(a, b))).toEqual([]);
    expect(teacherConflict.test?.(a, [b])).toBe(false);
  });

  it("tests false when only one side has the teacher", () => {
    expect(teacherConflict.test?.(course("A", "t1", ["s1"]), [course("B", null, ["s2"])])).toBe(false);
  });

  it("tests true when a non-null teacher is shared", () => {
    expect(teacherConflict.test?.(course("A", "t1", ["s1"]), [course("B", "t1", ["s2"])])).toBe(true);
  });

  it("treats an empty-string teacherKey as a valid colliding key (strict null, not truthiness)", () => {
    const a = course("A", "", ["s1"]);
    const b = course("B", "", ["s2"]);
    expect(teacherConflict.explain([a, b], ctx(a, b))).toEqual([
      { kind: "teacher", teacherKey: "", courseIds: ["A", "B"] },
    ]);
    expect(teacherConflict.test?.(a, [b])).toBe(true);
  });
});

describe("studentConflict", () => {
  it("explains one violation per pair with the exact shared student list", () => {
    const a = course("A", null, ["s1", "s2", "s3"]);
    const b = course("B", null, ["s2", "s3", "s4"]);
    const c = course("C", null, ["s4"]);
    expect(studentConflict.explain([a, b, c], ctx(a, b, c))).toEqual([
      { kind: "student", studentKeys: ["s2", "s3"], courseIds: ["A", "B"] },
      { kind: "student", studentKeys: ["s4"], courseIds: ["B", "C"] },
    ]);
  });

  it("explains nothing when no students are shared", () => {
    const a = course("A", null, ["s1"]);
    const b = course("B", null, ["s2"]);
    expect(studentConflict.explain([a, b], ctx(a, b))).toEqual([]);
  });

  it("tests true when a student key is shared", () => {
    expect(studentConflict.test?.(course("A", null, ["s1", "s2"]), [course("B", null, ["s3", "s2"])])).toBe(true);
  });
});

describe("explainCell", () => {
  it("aggregates violations across constraints", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t1", ["s1"]);
    expect(explainCell([a, b], ctx(a, b))).toEqual([
      { kind: "teacher", teacherKey: "t1", courseIds: ["A", "B"] },
      { kind: "student", studentKeys: ["s1"], courseIds: ["A", "B"] },
    ]);
  });
});

describe("violatesAny", () => {
  it("matches the registry's test fast paths", () => {
    const a = course("A", "t1", ["s1"]);
    expect(violatesAny(a, [a])).toBe(true);
    expect(violatesAny(a, [course("B", "t1", ["s2"])])).toBe(true);
    expect(violatesAny(a, [course("B", "t2", ["s1"])])).toBe(true);
    expect(violatesAny(a, [course("B", "t2", ["s2"])])).toBe(false);
  });
});

describe("teacherAvailability", () => {
  const unavailCtx = (cell: { day: number; period: number }, strong: Map<string, Set<string>>): BoardContext => ({
    cell,
    catalogById: new Map(),
    strongUnavailableByTeacher: strong,
  });

  it("flags one block violation per occupant whose teacher is strong-unavailable at the cell", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    const strong = new Map([["t1", new Set(["1:1"])]]);
    expect(teacherAvailability.explain([a, b], unavailCtx({ day: 1, period: 1 }, strong))).toEqual([
      { kind: "teacher-unavailable", teacherKey: "t1", courseIds: ["A"], severity: "block" },
    ]);
  });

  it("does not flag when the teacher is unavailable at a different cell", () => {
    const a = course("A", "t1", ["s1"]);
    const strong = new Map([["t1", new Set(["2:2"])]]);
    expect(teacherAvailability.explain([a], unavailCtx({ day: 1, period: 1 }, strong))).toEqual([]);
  });

  it("maps a soft-unavailable occupant to a warn violation (soft → warn)", () => {
    const a = course("A", "t1", ["s1"]);
    const ctxSoft: BoardContext = {
      cell: { day: 1, period: 1 },
      catalogById: new Map(),
      softUnavailableByTeacher: new Map([["t1", new Set(["1:1"])]]),
    };
    expect(teacherAvailability.explain([a], ctxSoft)).toEqual([
      { kind: "teacher-unavailable", teacherKey: "t1", courseIds: ["A"], severity: "warn" },
    ]);
  });

  it("strong wins over soft at the same cell", () => {
    const a = course("A", "t1", ["s1"]);
    const ctxBoth: BoardContext = {
      cell: { day: 1, period: 1 },
      catalogById: new Map(),
      strongUnavailableByTeacher: new Map([["t1", new Set(["1:1"])]]),
      softUnavailableByTeacher: new Map([["t1", new Set(["1:1"])]]),
    };
    expect(teacherAvailability.explain([a], ctxBoth)).toEqual([
      { kind: "teacher-unavailable", teacherKey: "t1", courseIds: ["A"], severity: "block" },
    ]);
  });

  it("ignores null-teacher occupants", () => {
    const a = course("A", null, ["s1"]);
    const strong = new Map([["t1", new Set(["1:1"])]]);
    expect(teacherAvailability.explain([a], unavailCtx({ day: 1, period: 1 }, strong))).toEqual([]);
  });

  it("returns nothing when no availability context is supplied (board-only, ctx optional)", () => {
    const a = course("A", "t1", ["s1"]);
    expect(teacherAvailability.explain([a], ctx(a))).toEqual([]);
  });

  it("is board-only: no `test`, so it never enters grouping enumeration", () => {
    expect(teacherAvailability).not.toHaveProperty("test");
  });
});
