import { describe, expect, it } from "vitest";
import { course, placement, type GeneratorSnapshot, type PlannerPlacement } from "@/entities/timetable";
import { autoParkPhantomCourses } from "./auto-park";

/**
 * `course(id, teacher, studentKeys)` defaults `hours: 4`, so a zero-student course (empty
 * `studentKeys`) with no pins and no prior parking has 4 uncovered hours — the Chemistry SL shape.
 */
const snapshotOf = (
  dp1: { courses: GeneratorSnapshot["cohorts"]["dp1"]["courses"]; pins?: PlannerPlacement[]; parked?: string[] },
  dp2: { courses: GeneratorSnapshot["cohorts"]["dp2"]["courses"]; pins?: PlannerPlacement[]; parked?: string[] } = {
    courses: [],
  },
): GeneratorSnapshot => ({
  days: 5,
  periods: 10,
  availability: [],
  finishesEarlyByCourseId: [],
  cohorts: {
    dp1: { courses: dp1.courses, pins: dp1.pins ?? [], parkedCourseIds: dp1.parked ?? [] },
    dp2: { courses: dp2.courses, pins: dp2.pins ?? [], parkedCourseIds: dp2.parked ?? [] },
  },
});

describe("autoParkPhantomCourses", () => {
  it("parks a zero-student course's full required hours", () => {
    const snapshot = snapshotOf({ courses: [course("chem", "T1", []), course("bio", "T2", ["s1"])] });

    const { snapshot: parked, autoParked } = autoParkPhantomCourses(snapshot);

    expect(autoParked).toEqual([{ cohort: "dp1", courseId: "chem", hoursParked: 4 }]);
    expect(parked.cohorts.dp1.parkedCourseIds).toEqual(["chem", "chem", "chem", "chem"]);
  });

  it("leaves enrolled courses untouched", () => {
    const snapshot = snapshotOf({ courses: [course("bio", "T2", ["s1"]), course("math", "T3", ["s1", "s2"])] });

    const { snapshot: parked, autoParked } = autoParkPhantomCourses(snapshot);

    expect(autoParked).toEqual([]);
    expect(parked.cohorts.dp1.parkedCourseIds).toEqual([]);
  });

  it("parks only the UNCOVERED hours — pins and prior parking count against the deficit", () => {
    const snapshot = snapshotOf({
      courses: [course("chem", "T1", [])],
      pins: [placement("p1", "chem", 1, 1), placement("p2", "chem", 1, 2)],
      parked: ["chem"],
    });

    const { autoParked } = autoParkPhantomCourses(snapshot);

    // required 4 − 2 pinned − 1 already parked = 1 uncovered hour.
    expect(autoParked).toEqual([{ cohort: "dp1", courseId: "chem", hoursParked: 1 }]);
  });

  it("does not park a fully-covered zero-student course", () => {
    const snapshot = snapshotOf({ courses: [course("chem", "T1", [])], parked: ["chem", "chem", "chem", "chem"] });

    const { snapshot: parked, autoParked } = autoParkPhantomCourses(snapshot);

    expect(autoParked).toEqual([]);
    expect(parked.cohorts.dp1.parkedCourseIds).toEqual(["chem", "chem", "chem", "chem"]);
  });

  it("handles zero-student courses in both cohorts independently", () => {
    const snapshot = snapshotOf(
      { courses: [course("chem", "T1", [])] },
      { courses: [course("phys", "T4", []), course("hist", "T5", ["s9"])] },
    );

    const { autoParked } = autoParkPhantomCourses(snapshot);

    expect(autoParked).toEqual([
      { cohort: "dp1", courseId: "chem", hoursParked: 4 },
      { cohort: "dp2", courseId: "phys", hoursParked: 4 },
    ]);
  });

  it("is a no-op when no course has an empty roster (the seed-fixture case)", () => {
    const snapshot = snapshotOf(
      { courses: [course("bio", "T2", ["s1"])] },
      { courses: [course("hist", "T5", ["s9"])] },
    );

    const { snapshot: result, autoParked } = autoParkPhantomCourses(snapshot);

    expect(autoParked).toEqual([]);
    expect(result.cohorts.dp1.parkedCourseIds).toEqual([]);
    expect(result.cohorts.dp2.parkedCourseIds).toEqual([]);
  });
});
