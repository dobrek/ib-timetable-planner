import { describe, expect, it } from "vitest";
import { course, placement } from "@/entities/timetable";
import type { SharedSnapshotInput } from "@/entities/timetable";
import { toPlanSnapshot, type CohortBoardSlice } from "./plan-snapshot";

const shared: SharedSnapshotInput = { days: 5, periods: 10, availability: [], finishesEarlyByCourseId: [] };

const slice = (over: Partial<CohortBoardSlice> = {}): CohortBoardSlice => ({
  catalog: [],
  placements: [],
  parkedBundles: [],
  ...over,
});

describe("toPlanSnapshot", () => {
  it("carries the board's placements through as pins", () => {
    const { snapshot } = toPlanSnapshot(shared, {
      dp1: slice({ catalog: [course("math", "t1", ["s1"])], placements: [placement("row-1", "math", 2, 3)] }),
      dp2: slice(),
    });

    expect(snapshot.cohorts.dp1.pins).toHaveLength(1);
    expect(snapshot.cohorts.dp1.pins[0]).toMatchObject({ courseId: "math", day: 2, period: 3 });
  });

  it("flattens parked bundles into the course-id MULTISET — one entry per off-board hour", () => {
    // Never deduped: the duplicate count is semantic, and collapsing it would understate the parked
    // hours and hand the solver a deficit it does not have.
    const { snapshot } = toPlanSnapshot(shared, {
      dp1: slice({
        catalog: [course("math", "t1", ["s1"])],
        parkedBundles: [
          { id: "b1", members: [{ courseId: "math", week: "both", isOptional: false }] },
          { id: "b2", members: [{ courseId: "math", week: "both", isOptional: false }] },
        ],
      }),
      dp2: slice(),
    });

    expect(snapshot.cohorts.dp1.parkedCourseIds).toEqual(["math", "math"]);
  });

  it("auto-parks a zero-student course's uncovered hours and reports them", () => {
    // The phantom-course transform bench has always run before a solve, now on the production path:
    // a course nobody attends cannot be scheduled or judged complete, and left alone it corrupts the
    // completeness tier. `course()` defaults to 4 hours.
    const { snapshot, autoParked } = toPlanSnapshot(shared, {
      dp1: slice({ catalog: [course("phantom", "t1", [])] }),
      dp2: slice(),
    });

    expect(autoParked).toEqual([{ cohort: "dp1", courseId: "phantom", hoursParked: 4 }]);
    expect(snapshot.cohorts.dp1.parkedCourseIds).toEqual(["phantom", "phantom", "phantom", "phantom"]);
  });

  it("leaves a catalog with real rosters untouched and reports nothing parked", () => {
    const { snapshot, autoParked } = toPlanSnapshot(shared, {
      dp1: slice({ catalog: [course("math", "t1", ["s1"])] }),
      dp2: slice({ catalog: [course("chem", "t2", ["s2"])] }),
    });

    expect(autoParked).toEqual([]);
    expect(snapshot.cohorts.dp1.parkedCourseIds).toEqual([]);
    expect(snapshot.cohorts.dp2.parkedCourseIds).toEqual([]);
  });

  it("passes the grid and the plan-scoped side-sets straight through", () => {
    const { snapshot } = toPlanSnapshot(
      { days: 4, periods: 8, availability: [], finishesEarlyByCourseId: ["hist"] },
      { dp1: slice(), dp2: slice() },
    );

    expect(snapshot).toMatchObject({ days: 4, periods: 8, finishesEarlyByCourseId: ["hist"] });
  });
});
