import { describe, expect, it } from "vitest";
import { assembleCombinedProps, type CombinedCohortInputs } from "./assemble-combined-props";
import type { GroupingCourse } from "../grouping/grouping";

const course = (id: string, teacherKeys: string[]): GroupingCourse => ({
  id,
  teacherKeys,
  studentKeys: [],
  hours: 1,
  weekMode: "agnostic",
});

const cohortInputs = (
  overrides: Partial<CombinedCohortInputs> & Pick<CombinedCohortInputs, "cohort">,
): CombinedCohortInputs => ({
  groupings: [],
  placements: [],
  catalog: [],
  names: {},
  stale: false,
  parkedBundles: [],
  ...overrides,
});

describe("assembleCombinedProps", () => {
  it("returns both cohorts fully-editable, each carrying its own placements + catalog", () => {
    const dp1 = cohortInputs({
      cohort: "dp1",
      placements: [{ id: "p1", courseId: "c1", day: 1, period: 1, week: "both" }],
      catalog: [course("c1", ["t1"])],
    });
    const dp2 = cohortInputs({
      cohort: "dp2",
      placements: [{ id: "p2", courseId: "c2", day: 2, period: 2, week: "both" }],
      catalog: [course("c2", ["t2"])],
    });

    const { dp1: out1, dp2: out2 } = assembleCombinedProps({
      planId: "plan-1",
      days: 5,
      periods: 6,
      availability: [],
      teacherNames: {},
      studentNames: {},
      dp1,
      dp2,
    });

    expect(out1.cohort).toBe("dp1");
    expect(out1.placements).toEqual(dp1.placements);
    expect(out1.catalog).toEqual(dp1.catalog);
    expect(out2.cohort).toBe("dp2");
    expect(out2.placements).toEqual(dp2.placements);
    expect(out2.catalog).toEqual(dp2.catalog);
  });

  it("derives each cohort's crossCohortOccupancy from the *other* cohort's placements", () => {
    const dp1 = cohortInputs({
      cohort: "dp1",
      placements: [{ id: "p1", courseId: "c1", day: 1, period: 1, week: "a" }],
      catalog: [course("c1", ["shared"])],
    });
    const dp2 = cohortInputs({
      cohort: "dp2",
      placements: [{ id: "p2", courseId: "c2", day: 3, period: 4, week: "b" }],
      catalog: [course("c2", ["shared"])],
    });

    const { dp1: out1, dp2: out2 } = assembleCombinedProps({
      planId: "plan-1",
      days: 5,
      periods: 6,
      availability: [],
      teacherNames: {},
      studentNames: {},
      dp1,
      dp2,
    });

    // dp1's cross-index reflects dp2's placement (day 3, period 4, week b) — not its own.
    expect(out1.crossCohortOccupancy).toEqual([{ teacherKey: "shared", day: 3, period: 4, week: "b" }]);
    // dp2's cross-index reflects dp1's placement (day 1, period 1, week a).
    expect(out2.crossCohortOccupancy).toEqual([{ teacherKey: "shared", day: 1, period: 1, week: "a" }]);
  });

  it("shares the union teacher/student names and availability across both columns; keeps stale per cohort", () => {
    const teacherNames = { t1: "Alice", t2: "Bob" };
    const studentNames = { s1: "Sam" };
    const availability = [{ teacherKey: "t1", day: 1, period: 1, severity: "strong" as const }];

    const { dp1: out1, dp2: out2 } = assembleCombinedProps({
      planId: "plan-1",
      days: 5,
      periods: 6,
      availability,
      teacherNames,
      studentNames,
      dp1: cohortInputs({ cohort: "dp1", stale: true, names: { c1: "Course 1" } }),
      dp2: cohortInputs({ cohort: "dp2", stale: false, names: { c2: "Course 2" } }),
    });

    expect(out1.teacherNames).toBe(teacherNames);
    expect(out2.teacherNames).toBe(teacherNames);
    expect(out1.studentNames).toBe(studentNames);
    expect(out1.availability).toBe(availability);
    expect(out2.availability).toBe(availability);
    expect(out1.stale).toBe(true);
    expect(out2.stale).toBe(false);
    expect(out1.names).toEqual({ c1: "Course 1" });
    expect(out2.names).toEqual({ c2: "Course 2" });
  });
});
