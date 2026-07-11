import { describe, expect, it } from "vitest";
import { course, type LocalPlacement } from "@/entities/timetable";
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
  it("assembles both cohorts, flattening parked members into a courseId multiset", () => {
    const shared = { days: 5, periods: 10, availability: [], finishesEarlyByCourseId: ["hist"] };
    const dp1 = {
      catalog: [course("math", "t1")],
      placements: [pending],
      parkedBundles: [
        {
          id: "shelf-1",
          members: [mathMember(), mathMember(), { courseId: "eng", week: "a" as const, isOptional: false }],
        },
      ],
    };
    const dp2 = { catalog: [course("chem", "t2")], placements: [], parkedBundles: [] };

    const snapshot = assembleGeneratorSnapshot(shared, { dp1, dp2 });

    expect(snapshot.days).toBe(5);
    expect(snapshot.periods).toBe(10);
    expect(snapshot.finishesEarlyByCourseId).toEqual(["hist"]);
    expect(snapshot.cohorts.dp1.courses).toEqual(dp1.catalog);
    expect(snapshot.cohorts.dp1.parkedCourseIds).toEqual(["math", "math", "eng"]);
    expect(snapshot.cohorts.dp2).toEqual({ courses: dp2.catalog, pins: [], parkedCourseIds: [] });
  });

  it("passes placements through as pins, stripping local-state markers", () => {
    const shared = { days: 5, periods: 10, availability: [], finishesEarlyByCourseId: [] };
    const cohorts = {
      dp1: { catalog: [course("math", "t1")], placements: [pending], parkedBundles: [] },
      dp2: { catalog: [], placements: [], parkedBundles: [] },
    };

    const { cohorts: assembled } = assembleGeneratorSnapshot(shared, cohorts);

    expect(assembled.dp1.pins).toEqual([
      { id: "tmp-1", courseId: "math", day: 1, period: 2, week: "both", isOptional: true },
    ]);
    expect(assembled.dp1.pins[0]).not.toHaveProperty("pending");
    expect(assembled.dp1.pins[0]).not.toHaveProperty("bundleId");
  });
});

const mathMember = () => ({ courseId: "math", week: "both" as const, isOptional: false });
