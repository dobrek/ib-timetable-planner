import { describe, expect, it } from "vitest";
import { course } from "../__fixtures__/builders";
import { analyzed, block } from "./__fixtures__/builders";
import { analyzePlan } from "./analyze-plan";
import type { PlanAnalysisInput } from "./types";

const input = (): PlanAnalysisInput => ({
  days: 2,
  periods: 4,
  courses: {
    dp1: [analyzed(course("dp1-math", "t1", ["s1", "s2"]), { name: "Math", hours: 2 })],
    dp2: [analyzed(course("dp2-bio", "t1", ["u1"]), { name: "Biology", hours: 4 })],
  },
  rows: [...block("dp1", "dp1-math", 1, 1, 2), ...block("dp2", "dp2-bio", 2, 3, 2)],
  availability: [],
  parkedCourseIds: { dp1: [], dp2: [] },
});

describe("analyzePlan", () => {
  it("measures each cohort against its own catalog and rows", () => {
    const features = analyzePlan(input());

    expect(features).toMatchObject({ days: 2, periods: 4 });
    expect(features.cohorts.dp1.completeness.unplacedHours).toBe(0);
    expect(features.cohorts.dp1.board).toMatchObject({ occupiedSlots: 2, placementRows: 2 });
    expect(features.cohorts.dp1.adjacency).toMatchObject({ adjacentPairs: 2, sameDaySplits: 0 });

    // dp2 placed 2 of its 4 hours — the incomplete board that a bare slot count would flatter.
    expect(features.cohorts.dp2.completeness).toMatchObject({ unplacedHours: 2 });
    expect(features.cohorts.dp2.board.occupiedSlots).toBe(2);
    expect(features.cohorts.dp2.slotCensus.cohortStudents).toBe(1);
  });

  it("never lets one cohort's rows leak into the other's features", () => {
    const features = analyzePlan({ ...input(), rows: block("dp1", "dp1-math", 1, 1, 2) });

    expect(features.cohorts.dp2.board.placementRows).toBe(0);
    expect(features.cohorts.dp2.completeness.unplacedHours).toBe(4);
  });
});
