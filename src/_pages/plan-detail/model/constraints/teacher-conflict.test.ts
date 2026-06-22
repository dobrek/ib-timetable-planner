import { describe, expect, it } from "vitest";
import { teacherConflict } from "./teacher-conflict";
import { coTaught, course, weekCtx } from "../__fixtures__/builders";

describe("teacherConflict.explain", () => {
  it("produces no teacher violation for >=2 empty-teacher-set occupants in one cell", () => {
    expect(teacherConflict.explain([course("a", null), course("b", null)], weekCtx())).toEqual([]);
  });

  it("flags one violation per teacher with >=2 courses, carrying member ids", () => {
    expect(
      teacherConflict.explain([course("a", "T1"), course("b", "T1"), course("c", "T2"), course("d", null)], weekCtx()),
    ).toEqual([{ kind: "teacher", teacherKey: "T1", courseIds: ["a", "b"] }]);
  });

  it("flags the single teacher two co-taught courses share, naming just that teacher", () => {
    expect(teacherConflict.explain([coTaught("a", ["t1", "t2"]), coTaught("b", ["t2", "t3"])], weekCtx())).toEqual([
      { kind: "teacher", teacherKey: "t2", courseIds: ["a", "b"] },
    ]);
  });

  it("does not conflict co-taught courses with disjoint teacher sets", () => {
    const a = coTaught("a", ["t1", "t2"]);
    const b = coTaught("b", ["t3", "t4"]);
    expect(teacherConflict.explain([a, b], weekCtx())).toEqual([]);
    expect(teacherConflict.test?.(a, [b])).toBe(false);
  });

  it("tests true when co-taught teacher sets intersect on any teacher (week-blind fast path)", () => {
    expect(teacherConflict.test?.(coTaught("a", ["t1", "t2"]), [coTaught("b", ["t2"])])).toBe(true);
  });
});

describe("teacherConflict.explain — week relaxation", () => {
  it("does not conflict an opposite-week (A/B) pair sharing a teacher", () => {
    expect(teacherConflict.explain([course("a", "T1"), course("b", "T1")], weekCtx({ a: "a", b: "b" }))).toEqual([]);
  });

  it("conflicts two same-week courses sharing a teacher", () => {
    expect(teacherConflict.explain([course("a", "T1"), course("b", "T1")], weekCtx({ a: "a", b: "a" }))).toEqual([
      { kind: "teacher", teacherKey: "T1", courseIds: ["a", "b"] },
    ]);
  });

  it("conflicts when one course is agnostic (both) and the other is single-week", () => {
    expect(teacherConflict.explain([course("a", "T1"), course("b", "T1")], weekCtx({ a: "both", b: "a" }))).toEqual([
      { kind: "teacher", teacherKey: "T1", courseIds: ["a", "b"] },
    ]);
  });

  it("conflicts a {both, a, b} teacher, citing the both course (overlaps both single weeks)", () => {
    expect(
      teacherConflict.explain(
        [course("x", "T1"), course("y", "T1"), course("z", "T1")],
        weekCtx({ x: "both", y: "a", z: "b" }),
      ),
    ).toEqual([{ kind: "teacher", teacherKey: "T1", courseIds: ["x", "y", "z"] }]);
  });
});
