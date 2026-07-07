import { describe, expect, it } from "vitest";
import { buildCoursesLeftSummary } from "./courses-left-summary";
import type { CourseDisplay, CourseHours } from "@/entities/timetable";
import type { Cohort, SubjectColor } from "@/shared/config";

const hours = (courseId: string, placed: number, required: number): CourseHours => ({ courseId, placed, required });

const display = (name: string, color: SubjectColor | null = null): CourseDisplay => ({ name, color });

// One cohort input with sane defaults; totals default to the plain sums so a test that only cares
// about row order still passes coherent headline numbers.
const cohortInput = (opts: {
  cohort?: Cohort;
  courseDisplay?: Record<string, CourseDisplay>;
  unplaced?: CourseHours[];
  overplaced?: CourseHours[];
  hoursLeft?: number;
  hoursOver?: number;
  optionalByCourse?: { courseId: string; count: number }[];
}) => ({
  cohort: opts.cohort ?? "dp1",
  courseDisplay: opts.courseDisplay ?? {},
  unplaced: opts.unplaced ?? [],
  overplaced: opts.overplaced ?? [],
  hoursLeft: opts.hoursLeft ?? (opts.unplaced ?? []).reduce((s, c) => s + (c.required - c.placed), 0),
  hoursOver: opts.hoursOver ?? (opts.overplaced ?? []).reduce((s, c) => s + (c.placed - c.required), 0),
  optionalByCourse: opts.optionalByCourse ?? [],
  optionalCount: (opts.optionalByCourse ?? []).reduce((s, c) => s + c.count, 0),
});

const optionalCount = (courseId: string, count: number) => ({ courseId, count });

const idsOf = (rows: { courseId: string }[]) => rows.map((row) => row.courseId);

describe("buildCoursesLeftSummary", () => {
  it("sorts missing rows largest-gap-first, ties broken alphabetically by resolved name", () => {
    const summary = buildCoursesLeftSummary([
      cohortInput({
        courseDisplay: { A: display("Alpha"), B: display("Beta"), C: display("Gamma") },
        // A gap 3 (Alpha), B gap 1 (Beta), C gap 3 (Gamma) → 3s first, then Alpha < Gamma; B last.
        unplaced: [hours("B", 1, 2), hours("A", 0, 3), hours("C", 0, 3)],
      }),
    ]);
    expect(idsOf(summary.cohorts[0].missing)).toEqual(["A", "C", "B"]);
  });

  it("sorts over-placed rows largest-over-first, ties broken alphabetically by resolved name", () => {
    const summary = buildCoursesLeftSummary([
      cohortInput({
        courseDisplay: { X: display("Xenon"), Y: display("Yttrium"), Z: display("Argon") },
        // X over 3 (Xenon), Y over 1 (Yttrium), Z over 3 (Argon) → 3s first, Argon < Xenon; Y last.
        overplaced: [hours("X", 5, 2), hours("Y", 3, 2), hours("Z", 5, 2)],
      }),
    ]);
    expect(idsOf(summary.cohorts[0].over)).toEqual(["Z", "X", "Y"]);
  });

  it("falls back to the bare id and no color for a course missing from courseDisplay", () => {
    const summary = buildCoursesLeftSummary([cohortInput({ courseDisplay: {}, unplaced: [hours("UNKNOWN", 0, 2)] })]);
    expect(summary.cohorts[0].missing[0]).toMatchObject({ courseId: "UNKNOWN", name: "UNKNOWN", color: null });
  });

  it("sums each headline total across cohorts, preserving cohort order", () => {
    const summary = buildCoursesLeftSummary([
      cohortInput({ cohort: "dp1", hoursLeft: 3, hoursOver: 1 }),
      cohortInput({ cohort: "dp2", hoursLeft: 2, hoursOver: 0 }),
    ]);
    expect(summary.hoursLeft).toBe(5);
    expect(summary.hoursOver).toBe(1);
    expect(summary.cohorts.map((c) => c.cohort)).toEqual(["dp1", "dp2"]);
  });

  it("resolves the model's optional counts to display rows", () => {
    const summary = buildCoursesLeftSummary([
      cohortInput({
        courseDisplay: { A: display("Alpha"), B: display("Beta") },
        optionalByCourse: [optionalCount("A", 2), optionalCount("B", 1)],
      }),
    ]);
    expect(summary.optionalCount).toBe(3);
    expect(summary.cohorts[0].optional).toEqual([
      { courseId: "A", name: "Alpha", color: null, count: 2 },
      { courseId: "B", name: "Beta", color: null, count: 1 },
    ]);
  });

  it("sorts optional rows most-pending-first, ties broken alphabetically by resolved name", () => {
    const summary = buildCoursesLeftSummary([
      cohortInput({
        courseDisplay: { A: display("Zulu"), B: display("Alpha"), C: display("Mike") },
        // A count 1 (Zulu), B count 1 (Alpha), C count 2 (Mike) → C first, then Alpha < Zulu.
        optionalByCourse: [optionalCount("A", 1), optionalCount("B", 1), optionalCount("C", 2)],
      }),
    ]);
    expect(idsOf(summary.cohorts[0].optional)).toEqual(["C", "B", "A"]);
  });

  it("zero-state: no optional counts → optionalCount 0 and empty per-cohort optional rows", () => {
    const summary = buildCoursesLeftSummary([cohortInput({}), cohortInput({ cohort: "dp2" })]);
    expect(summary.optionalCount).toBe(0);
    expect(summary.cohorts.every((cohort) => cohort.optional.length === 0)).toBe(true);
  });

  it("sums optionalCount across cohorts while rows stay per-cohort", () => {
    const summary = buildCoursesLeftSummary([
      cohortInput({ cohort: "dp1", optionalByCourse: [optionalCount("A", 1)] }),
      cohortInput({ cohort: "dp2", optionalByCourse: [optionalCount("B", 2)] }),
    ]);
    expect(summary.optionalCount).toBe(3);
    expect(idsOf(summary.cohorts[0].optional)).toEqual(["A"]);
    expect(idsOf(summary.cohorts[1].optional)).toEqual(["B"]);
  });

  it("never nets over-placement against under-placement through assembly (Math+English)", () => {
    // English 0/2 missing, Math 4/2 over → must read 2 left · 2 over, not cancel to 0.
    const summary = buildCoursesLeftSummary([
      cohortInput({
        courseDisplay: { MATH: display("Math"), ENG: display("English") },
        unplaced: [hours("ENG", 0, 2)],
        overplaced: [hours("MATH", 4, 2)],
        hoursLeft: 2,
        hoursOver: 2,
      }),
    ]);
    expect(summary.hoursLeft).toBe(2);
    expect(summary.hoursOver).toBe(2);
  });
});
