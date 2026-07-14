import { describe, expect, it } from "vitest";
import { diffCatalogs, isCleanDiff } from "./catalog-diff";
import { buildLoadedPlan, SAMPLE, type CourseSpec, type PlanSpec } from "./__fixtures__/loaded-plan";

const diff = (reference: PlanSpec, other: PlanSpec) => diffCatalogs(buildLoadedPlan(reference), buildLoadedPlan(other));

const NONE = { added: 0, removed: 0, changed: 0 };

/** SAMPLE's courses with one of them rewritten — the "same natural key, different value" shape. */
const withCourse = (name: string, patch: Partial<CourseSpec>): PlanSpec => ({
  ...SAMPLE,
  courses: (SAMPLE.courses ?? []).map((course) => (course.name === name ? { ...course, ...patch } : course)),
});

describe("diffCatalogs", () => {
  it("reports nothing moved for a plan against its own clone (every UUID re-minted)", () => {
    const result = diff({ ...SAMPLE, idPrefix: "src" }, { ...SAMPLE, idPrefix: "cln" });

    expect(result.courses).toEqual(NONE);
    expect(result.teachers).toEqual(NONE);
    expect(result.students).toEqual(NONE);
    expect(result.choices).toEqual(NONE);
    expect(result.availability).toEqual(NONE);
    expect(result.grid.equal).toBe(true);
    expect(isCleanDiff(result)).toBe(true);
  });

  it("counts an added course", () => {
    const result = diff(SAMPLE, {
      ...SAMPLE,
      courses: [...(SAMPLE.courses ?? []), { name: "Biology", level: "SL", hours: 2 }],
    });

    expect(result.courses).toEqual({ added: 1, removed: 0, changed: 0 });
    expect(isCleanDiff(result)).toBe(false);
  });

  it("counts a removed course", () => {
    const result = diff(SAMPLE, { ...SAMPLE, courses: (SAMPLE.courses ?? []).slice(1) });

    expect(result.courses).toEqual({ added: 0, removed: 1, changed: 0 });
  });

  it("counts a course whose hours changed under a stable natural key as CHANGED, not added+removed", () => {
    const result = diff(SAMPLE, withCourse("Maths", { hours: 6 }));

    // The course still exists — saying "1 removed, 1 added" would read as a catalog reshuffle.
    expect(result.courses).toEqual({ added: 0, removed: 0, changed: 1 });
  });

  it("counts a removed teacher", () => {
    const result = diff(SAMPLE, { ...SAMPLE, teachers: [{ code: "AB" }] });

    expect(result.teachers).toEqual({ added: 0, removed: 1, changed: 0 });
  });

  it("counts an added student", () => {
    const result = diff(SAMPLE, { ...SAMPLE, students: [...(SAMPLE.students ?? []), { name: "Edsger Dijkstra" }] });

    expect(result.students).toEqual({ added: 1, removed: 0, changed: 0 });
  });

  it("counts a re-pointed student choice as one added and one removed", () => {
    const result = diff(SAMPLE, withCourse("Maths", { students: ["Grace Hopper"] }));

    expect(result.choices).toEqual({ added: 1, removed: 1, changed: 0 });
  });

  it("counts an availability cell that hardened soft → strong as CHANGED", () => {
    const result = diff(SAMPLE, {
      ...SAMPLE,
      availability: [{ teacher: "AB", day: 1, period: 2, severity: "strong" }],
    });

    expect(result.availability).toEqual({ added: 0, removed: 0, changed: 1 });
  });

  it("counts an availability cell moved to another slot as one added and one removed", () => {
    const result = diff(SAMPLE, { ...SAMPLE, availability: [{ teacher: "AB", day: 3, period: 2 }] });

    expect(result.availability).toEqual({ added: 1, removed: 1, changed: 0 });
  });

  it("reports the grid shape on both sides when it differs", () => {
    const result = diff(SAMPLE, { ...SAMPLE, periods: 8 });

    expect(result.grid).toEqual({
      equal: false,
      reference: { days: 5, periods: 10 },
      other: { days: 5, periods: 8 },
    });
  });

  // students.full_name has no unique constraint, so two same-named students are two students.
  // Set semantics would collapse them and under-report a real difference.
  it("treats same-named students as a multiset, not a set", () => {
    const twins: PlanSpec = { ...SAMPLE, students: [{ name: "Alan Turing" }, { name: "Alan Turing" }] };
    const single: PlanSpec = { ...SAMPLE, students: [{ name: "Alan Turing" }] };

    expect(diff(single, twins).students).toEqual({ added: 1, removed: 0, changed: 0 });
  });
});
