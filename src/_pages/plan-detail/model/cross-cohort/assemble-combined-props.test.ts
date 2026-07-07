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
  courseDisplay: {},
  studentNames: {},
  stale: false,
  parkedBundles: [],
  ...overrides,
});

describe("assembleCombinedProps", () => {
  it("returns both cohorts fully-editable, each carrying its own placements + catalog", () => {
    const dp1 = cohortInputs({
      cohort: "dp1",
      placements: [{ id: "p1", courseId: "c1", day: 1, period: 1, week: "both", isOptional: false }],
      catalog: [course("c1", ["t1"])],
    });
    const dp2 = cohortInputs({
      cohort: "dp2",
      placements: [{ id: "p2", courseId: "c2", day: 2, period: 2, week: "both", isOptional: false }],
      catalog: [course("c2", ["t2"])],
    });

    const { dp1: out1, dp2: out2 } = assembleCombinedProps({ dp1, dp2 });

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
      placements: [{ id: "p1", courseId: "c1", day: 1, period: 1, week: "a", isOptional: false }],
      catalog: [course("c1", ["shared"])],
    });
    const dp2 = cohortInputs({
      cohort: "dp2",
      placements: [{ id: "p2", courseId: "c2", day: 3, period: 4, week: "b", isOptional: false }],
      catalog: [course("c2", ["shared"])],
    });

    const { dp1: out1, dp2: out2 } = assembleCombinedProps({ dp1, dp2 });

    // dp1's cross-index reflects dp2's placement (day 3, period 4, week b) — not its own.
    expect(out1.crossCohortOccupancy).toEqual([{ teacherKey: "shared", day: 3, period: 4, week: "b" }]);
    // dp2's cross-index reflects dp1's placement (day 1, period 1, week a).
    expect(out2.crossCohortOccupancy).toEqual([{ teacherKey: "shared", day: 1, period: 1, week: "a" }]);
  });

  it("keeps stale, own-cohort courseDisplay, and student names per column", () => {
    const { dp1: out1, dp2: out2 } = assembleCombinedProps({
      dp1: cohortInputs({
        cohort: "dp1",
        stale: true,
        courseDisplay: { c1: { name: "Course 1", color: null } },
        studentNames: { s1: "Sam" },
      }),
      dp2: cohortInputs({
        cohort: "dp2",
        stale: false,
        courseDisplay: { c2: { name: "Course 2", color: null } },
        studentNames: { s2: "Alex" },
      }),
    });

    expect(out1.stale).toBe(true);
    expect(out2.stale).toBe(false);
    expect(out1.courseDisplay).toEqual({ c1: { name: "Course 1", color: null } });
    expect(out2.courseDisplay).toEqual({ c2: { name: "Course 2", color: null } });
    expect(out1.studentNames).toEqual({ s1: "Sam" });
    expect(out2.studentNames).toEqual({ s2: "Alex" });
  });
});
