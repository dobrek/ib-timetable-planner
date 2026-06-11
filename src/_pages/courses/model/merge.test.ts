import { describe, expect, it } from "vitest";
import { deriveMergeParent, mergeReasonMessage, type MergeChildInput } from "./merge";

const TEACHER = "teacher-1";

const child = (overrides: Partial<MergeChildInput>): MergeChildInput => ({
  id: "course-1",
  name: "German B",
  level: "SL",
  cohort: "dp1",
  teacherId: TEACHER,
  ...overrides,
});

describe("deriveMergeParent", () => {
  it("derives a composite parent from two valid children", () => {
    const result = deriveMergeParent([child({ id: "a", level: "AB" }), child({ id: "b", level: "SL" })]);
    expect(result).toEqual({
      ok: true,
      parent: { name: "German B", level: "AB+SL", teacherId: TEACHER, cohort: "dp1" },
    });
  });

  it("produces AB+SL regardless of selection order", () => {
    const forward = deriveMergeParent([child({ id: "a", level: "AB" }), child({ id: "b", level: "SL" })]);
    const reverse = deriveMergeParent([child({ id: "b", level: "SL" }), child({ id: "a", level: "AB" })]);
    expect(forward.ok && forward.parent.level).toBe("AB+SL");
    expect(reverse.ok && reverse.parent.level).toBe("AB+SL");
  });

  it("derives a 3-way AB+SL+HL composite in IB order", () => {
    const result = deriveMergeParent([
      child({ id: "a", level: "HL" }),
      child({ id: "b", level: "AB" }),
      child({ id: "c", level: "SL" }),
    ]);
    expect(result.ok && result.parent.level).toBe("AB+SL+HL");
  });

  it("appends non-IB levels in input order after IB levels", () => {
    const result = deriveMergeParent([
      child({ id: "a", level: "X" }),
      child({ id: "b", level: "SL" }),
      child({ id: "c", level: "Y" }),
    ]);
    expect(result.ok && result.parent.level).toBe("SL+X+Y");
  });

  it("rejects fewer than 2 children", () => {
    const result = deriveMergeParent([child({ id: "a" })]);
    expect(result).toEqual({ ok: false, reason: "too-few-children" });
  });

  it("rejects mixed cohorts", () => {
    const result = deriveMergeParent([child({ id: "a", level: "AB" }), child({ id: "b", level: "SL", cohort: "dp2" })]);
    expect(result).toEqual({ ok: false, reason: "mixed-cohorts" });
  });

  it("rejects mismatched names", () => {
    const result = deriveMergeParent([
      child({ id: "a", level: "AB", name: "German B" }),
      child({ id: "b", level: "SL", name: "French B" }),
    ]);
    expect(result).toEqual({ ok: false, reason: "mismatched-name" });
  });

  it("rejects a missing teacher", () => {
    const result = deriveMergeParent([
      child({ id: "a", level: "AB", teacherId: null }),
      child({ id: "b", level: "SL" }),
    ]);
    expect(result).toEqual({ ok: false, reason: "missing-teacher" });
  });

  it("rejects mismatched teachers", () => {
    const result = deriveMergeParent([
      child({ id: "a", level: "AB", teacherId: "teacher-1" }),
      child({ id: "b", level: "SL", teacherId: "teacher-2" }),
    ]);
    expect(result).toEqual({ ok: false, reason: "mismatched-teacher" });
  });

  it("rejects duplicate levels", () => {
    const result = deriveMergeParent([child({ id: "a", level: "SL" }), child({ id: "b", level: "SL" })]);
    expect(result).toEqual({ ok: false, reason: "duplicate-levels" });
  });
});

describe("mergeReasonMessage", () => {
  it("renders a human-readable message for every reason", () => {
    expect(mergeReasonMessage("too-few-children")).toMatch(/at least 2/i);
    expect(mergeReasonMessage("mismatched-teacher")).toMatch(/teacher/i);
    expect(mergeReasonMessage("duplicate-levels")).toMatch(/distinct/i);
  });
});
