import type { WeekMode } from "@/shared/config";
import { describe, expect, it, vi } from "vitest";
import { applyDropAction, type DropDispatchState } from "./drop-dispatch";
import type { CellData } from "../drag";
import type { PlannerGrouping } from "../grouping/grouping";
import type { CohortActions } from "../use-cohort-board-state";

const cell: CellData = { day: 2, period: 3 };

// c1 is week-agnostic (parks as "both"); c5 is biweekly (parks as "a").
const weekModeByCourseId = new Map<string, WeekMode>([
  ["c1", "agnostic"],
  ["c5", "biweekly"],
]);

const grouping: PlannerGrouping = {
  id: "g1",
  memberIds: ["c1", "c5"],
  coverageCount: 2,
  score: 1,
  oppositeWeek: false,
};

function makeActions() {
  const mocks = {
    addCourse: vi.fn(),
    addGroup: vi.fn(),
    movePlacement: vi.fn(),
    removePlacement: vi.fn(),
    setWeek: vi.fn(),
    moveBundle: vi.fn(),
    removeBundle: vi.fn(),
    duplicateBundle: vi.fn(),
    shelveBundle: vi.fn(),
    placeBack: vi.fn(),
    parkMembers: vi.fn(),
    removeParked: vi.fn(),
  };
  return { mocks, actions: mocks as unknown as CohortActions };
}

function makeState(actions: CohortActions): DropDispatchState {
  return { actions, groupings: [grouping], weekModeByCourseId };
}

describe("applyDropAction — action → actions.* mapping", () => {
  it("addCourse dispatches addCourse and does not collapse the shelf", () => {
    const { mocks, actions } = makeActions();
    const collapseUnlessPinned = vi.fn();
    applyDropAction({ kind: "addCourse", cohort: "dp1", courseId: "c1", cell }, () => makeState(actions), {
      collapseUnlessPinned,
    });
    expect(mocks.addCourse).toHaveBeenCalledWith("c1", cell);
    expect(collapseUnlessPinned).not.toHaveBeenCalled();
  });

  it("dropGroup resolves a known grouping's members and oppositeWeek flag", () => {
    const { mocks, actions } = makeActions();
    const collapseUnlessPinned = vi.fn();
    applyDropAction({ kind: "dropGroup", cohort: "dp1", groupingId: "g1", cell }, () => makeState(actions), {
      collapseUnlessPinned,
    });
    expect(mocks.addGroup).toHaveBeenCalledWith(["c1", "c5"], cell, { oppositeWeek: false });
    expect(collapseUnlessPinned).not.toHaveBeenCalled();
  });

  it("dropGroup with an unknown grouping id fans an empty member list (no-op add)", () => {
    const { mocks, actions } = makeActions();
    applyDropAction({ kind: "dropGroup", cohort: "dp1", groupingId: "missing", cell }, () => makeState(actions), {
      collapseUnlessPinned: vi.fn(),
    });
    expect(mocks.addGroup).toHaveBeenCalledWith([], cell, { oppositeWeek: false });
  });

  it("movePlacement dispatches movePlacement and does not collapse the shelf", () => {
    const { mocks, actions } = makeActions();
    const collapseUnlessPinned = vi.fn();
    applyDropAction({ kind: "movePlacement", cohort: "dp1", placementId: "p1", cell }, () => makeState(actions), {
      collapseUnlessPinned,
    });
    expect(mocks.movePlacement).toHaveBeenCalledWith("p1", cell);
    expect(collapseUnlessPinned).not.toHaveBeenCalled();
  });

  it("moveBundle dispatches moveBundle and does not collapse the shelf", () => {
    const { mocks, actions } = makeActions();
    const collapseUnlessPinned = vi.fn();
    applyDropAction({ kind: "moveBundle", cohort: "dp1", day: 1, period: 4, cell }, () => makeState(actions), {
      collapseUnlessPinned,
    });
    expect(mocks.moveBundle).toHaveBeenCalledWith(1, 4, cell);
    expect(collapseUnlessPinned).not.toHaveBeenCalled();
  });

  it("liftBundle shelves the bundle and collapses the shelf", () => {
    const { mocks, actions } = makeActions();
    const collapseUnlessPinned = vi.fn();
    applyDropAction({ kind: "liftBundle", cohort: "dp1", day: 1, period: 1 }, () => makeState(actions), {
      collapseUnlessPinned,
    });
    expect(mocks.shelveBundle).toHaveBeenCalledWith(1, 1);
    expect(collapseUnlessPinned).toHaveBeenCalledTimes(1);
  });

  it("placeBack places the bundle back and collapses the shelf", () => {
    const { mocks, actions } = makeActions();
    const collapseUnlessPinned = vi.fn();
    applyDropAction({ kind: "placeBack", cohort: "dp1", shelfBundleId: "s1", cell }, () => makeState(actions), {
      collapseUnlessPinned,
    });
    expect(mocks.placeBack).toHaveBeenCalledWith("s1", cell);
    expect(collapseUnlessPinned).toHaveBeenCalledTimes(1);
  });

  it("parkCourse parks the single course at its default week and collapses the shelf", () => {
    const { mocks, actions } = makeActions();
    const collapseUnlessPinned = vi.fn();
    applyDropAction({ kind: "parkCourse", cohort: "dp1", courseId: "c5" }, () => makeState(actions), {
      collapseUnlessPinned,
    });
    expect(mocks.parkMembers).toHaveBeenCalledWith([{ courseId: "c5", week: "a" }]);
    expect(collapseUnlessPinned).toHaveBeenCalledTimes(1);
  });

  it("parkGroup parks the grouping's resolved members and collapses the shelf", () => {
    const { mocks, actions } = makeActions();
    const collapseUnlessPinned = vi.fn();
    applyDropAction({ kind: "parkGroup", cohort: "dp1", groupingId: "g1" }, () => makeState(actions), {
      collapseUnlessPinned,
    });
    expect(mocks.parkMembers).toHaveBeenCalledWith([
      { courseId: "c1", week: "both" },
      { courseId: "c5", week: "a" },
    ]);
    expect(collapseUnlessPinned).toHaveBeenCalledTimes(1);
  });

  it("parkGroup with an unknown grouping id is a no-op (no park, no collapse)", () => {
    const { mocks, actions } = makeActions();
    const collapseUnlessPinned = vi.fn();
    applyDropAction({ kind: "parkGroup", cohort: "dp1", groupingId: "missing" }, () => makeState(actions), {
      collapseUnlessPinned,
    });
    expect(mocks.parkMembers).not.toHaveBeenCalled();
    expect(collapseUnlessPinned).not.toHaveBeenCalled();
  });
});

describe("applyDropAction — resolveState routing (single == degenerate combined)", () => {
  it("the combined resolver routes each action to its own cohort's actions", () => {
    const dp1 = makeActions();
    const dp2 = makeActions();
    const byCohort = { dp1: makeState(dp1.actions), dp2: makeState(dp2.actions) };
    const effects = { collapseUnlessPinned: vi.fn() };

    applyDropAction({ kind: "addCourse", cohort: "dp2", courseId: "c1", cell }, (c) => byCohort[c], effects);

    expect(dp2.mocks.addCourse).toHaveBeenCalledWith("c1", cell);
    expect(dp1.mocks.addCourse).not.toHaveBeenCalled();
  });

  it("a constant single-board resolver ignores the action cohort and hits its one state", () => {
    const only = makeActions();
    const effects = { collapseUnlessPinned: vi.fn() };

    // Same action tagged dp2, but the single board's resolver always returns its one cohort's state —
    // identical dispatch to the combined resolver when there is only one cohort.
    applyDropAction({ kind: "addCourse", cohort: "dp2", courseId: "c1", cell }, () => makeState(only.actions), effects);

    expect(only.mocks.addCourse).toHaveBeenCalledWith("c1", cell);
  });
});
