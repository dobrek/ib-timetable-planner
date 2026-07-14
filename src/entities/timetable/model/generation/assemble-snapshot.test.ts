import { describe, expect, it } from "vitest";
import { course } from "../__fixtures__/builders";
import type { LocalPlacement } from "../placement";
import { assembleGeneratorSnapshot } from "./assemble-snapshot";

const pending: LocalPlacement = {
  id: "tmp-1",
  courseId: "math",
  day: 1,
  period: 2,
  week: "both",
  isOptional: true,
  bundleId: "b-1",
  pending: true,
};

describe("assembleGeneratorSnapshot", () => {
  it("assembles both cohorts from the entity-level inputs", () => {
    const shared = { days: 5, periods: 10, availability: [], finishesEarlyByCourseId: ["hist"] };
    const dp1 = {
      courses: [course("math", "t1")],
      placements: [pending],
      parkedCourseIds: ["math", "math", "eng"],
    };
    const dp2 = { courses: [course("chem", "t2")], placements: [], parkedCourseIds: [] };

    const snapshot = assembleGeneratorSnapshot(shared, { dp1, dp2 });

    expect(snapshot.days).toBe(5);
    expect(snapshot.periods).toBe(10);
    expect(snapshot.finishesEarlyByCourseId).toEqual(["hist"]);
    expect(snapshot.cohorts.dp1.courses).toEqual(dp1.courses);
    expect(snapshot.cohorts.dp1.parkedCourseIds).toEqual(["math", "math", "eng"]);
    expect(snapshot.cohorts.dp2).toEqual({ courses: dp2.courses, pins: [], parkedCourseIds: [] });
  });

  it("passes placements through as pins, stripping caller-local state markers", () => {
    const shared = { days: 5, periods: 10, availability: [], finishesEarlyByCourseId: [] };
    const cohorts = {
      dp1: { courses: [course("math", "t1")], placements: [pending], parkedCourseIds: [] },
      dp2: { courses: [], placements: [], parkedCourseIds: [] },
    };

    const { cohorts: assembled } = assembleGeneratorSnapshot(shared, cohorts);

    expect(assembled.dp1.pins).toEqual([
      { id: "tmp-1", courseId: "math", day: 1, period: 2, week: "both", isOptional: true },
    ]);
    expect(assembled.dp1.pins[0]).not.toHaveProperty("pending");
    expect(assembled.dp1.pins[0]).not.toHaveProperty("bundleId");
  });
});
