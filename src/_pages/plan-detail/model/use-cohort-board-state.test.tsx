import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeCourse } from "../api/placement-client";
import { cellKey } from "./collision/cell-key";
import { course, placement as buildPlacement } from "./__fixtures__/builders";
import { EMPTY_CROSS_COHORT_INDEX } from "./cross-cohort/cross-cohort-index";
import type { PlannerBoardProps, SharedBoardProps } from "./drag";
import { indexFromPlacements, useCohortBoardState, useCombinedBoardState } from "./use-cohort-board-state";
import type { GroupingCourse } from "./grouping/grouping";
import type { LocalPlacement } from "./placement/placement";

// `usePlacements` (driven through the assembler) calls the action clients on the write path; mock the
// network edge so the optimistic state lands synchronously and we can assert the cross-cohort cycle.
vi.mock("../api/placement-client", () => ({
  placeCourse: vi.fn(),
  moveBundleMembers: vi.fn(),
  removeBundleMembers: vi.fn(),
  updatePlacementWeek: vi.fn(),
}));
vi.mock("../api/shelf-client", () => ({
  shelveBundle: vi.fn(),
  unshelveBundle: vi.fn(),
  deleteShelfBundle: vi.fn(),
  shelveCourses: vi.fn(),
}));

// The live cross-index seam: each cohort's `occupiedByTeacher` is built from the OTHER column's
// current placements. These lock the property the combined shell relies on — editing one cohort's
// placements yields an index reflecting the change (so the sibling re-validates).
const teacherKeys = new Map([
  ["c1", ["shared"]],
  ["c2", ["other"]],
]);

const placement = (courseId: string, day: number, period: number): LocalPlacement => ({
  id: `${courseId}-${day}-${period}`,
  courseId,
  day,
  period,
  week: "both",
});

describe("indexFromPlacements (live cross-cohort index)", () => {
  it("marks the cell+week a shared teacher is occupied at in the source cohort", () => {
    const index = indexFromPlacements([placement("c1", 2, 3)], teacherKeys);
    expect(index.get("shared")?.get("2:3")).toEqual(new Set(["both"]));
  });

  it("recomputes to a different occupancy when the source cohort's placement moves", () => {
    const before = indexFromPlacements([placement("c1", 2, 3)], teacherKeys);
    const after = indexFromPlacements([placement("c1", 4, 5)], teacherKeys);

    expect(before.get("shared")?.has("2:3")).toBe(true);
    expect(after.get("shared")?.has("2:3")).toBe(false);
    expect(after.get("shared")?.has("4:5")).toBe(true);
    // A fresh Map identity each build — the memo that wraps this forces sibling re-validation.
    expect(after).not.toBe(before);
  });

  it("yields an empty index when the source cohort has no placements", () => {
    expect(indexFromPlacements([], teacherKeys).size).toBe(0);
  });
});

// End-to-end proof of the live cross-cohort cycle through the public `useCombinedBoardState`, not
// just the `indexFromPlacements` leaf: a placement driven into dp1 must re-validate dp2 in the SAME
// render pass (Phase 5/7 must not break this). Both cohorts share teacher "shared".
const shared: SharedBoardProps = {
  planId: "plan-1",
  days: 5,
  periods: 6,
  availability: [],
  teacherNames: {},
};

const props = (cohort: "dp1" | "dp2", placements: LocalPlacement[], courseId: string): PlannerBoardProps => ({
  cohort,
  groupings: [],
  stale: false,
  courseDisplay: { [courseId]: { name: courseId, color: null } },
  studentNames: {},
  placements,
  catalog: [course(courseId, "shared")],
  crossCohortOccupancy: [],
  parkedBundles: [],
});

describe("useCombinedBoardState (live cross-cohort re-validation)", () => {
  const placeMock = vi.mocked(placeCourse);

  beforeEach(() => {
    let n = 0;
    placeMock.mockImplementation((args) =>
      Promise.resolve({
        id: `srv-${++n}`,
        courseId: args.courseId,
        day: args.day,
        period: args.period,
        week: args.week,
        bundleId: `bundle-${args.day}-${args.period}`,
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("re-validates dp2 when a clashing placement lands in dp1 (same render pass)", async () => {
    // dp2 already holds c2 (teacher "shared") at (1,1); dp1 starts empty → no cross-cohort clash yet.
    const dp2Seed = [buildPlacement("p2", "c2", 1, 1)];
    const { result } = renderHook(() =>
      useCombinedBoardState(shared, props("dp1", [], "c1"), props("dp2", dp2Seed, "c2")),
    );

    expect(result.current.dp2.collisions.has(cellKey(1, 1))).toBe(false);

    // Drive c1 (teacher "shared") into dp1 at (1,1) → dp2's live index now sees the teacher occupied
    // in the sibling cohort at that cell → dp2 flags the cross-cohort-teacher clash immediately.
    // `addCourse` is fire-and-forget (optimistic); the trailing await flushes the settle microtask
    // so the async reconcile stays wrapped in `act`. The cross-cohort flag lands on the optimistic
    // placement, but flushing keeps React quiet about an update escaping `act`.
    await act(async () => {
      result.current.dp1.actions.addCourse("c1", { day: 1, period: 1 });
      await Promise.resolve();
    });

    expect(result.current.dp1.placements.some((p) => p.courseId === "c1")).toBe(true);
    expect(result.current.dp2.collisions.has(cellKey(1, 1))).toBe(true);
    expect(
      result.current.dp2.collisions.get(cellKey(1, 1))?.violations.some((v) => v.kind === "cross-cohort-teacher"),
    ).toBe(true);
  });
});

// The single board calls the assembler ONCE with its one static index as both seed and fresh; the
// result must reproduce its wiring — placements + derivations + the full action set.
const soloProps = (catalog: GroupingCourse[], placements: LocalPlacement[]): PlannerBoardProps => ({
  cohort: "dp1",
  groupings: [],
  stale: false,
  courseDisplay: {},
  studentNames: {},
  placements,
  catalog,
  crossCohortOccupancy: [],
  parkedBundles: [],
});

describe("useCohortBoardState (single cohort: seed === fresh)", () => {
  it("assembles placements, in-cohort collisions, and the full action set", () => {
    // Two same-teacher courses sharing a cell → an in-cohort teacher conflict (no sibling needed).
    const catalog = [course("c1", "t1"), course("c2", "t1")];
    const placements = [buildPlacement("p1", "c1", 1, 1), buildPlacement("p2", "c2", 1, 1)];
    const { result } = renderHook(() =>
      useCohortBoardState(shared, soloProps(catalog, placements), EMPTY_CROSS_COHORT_INDEX, EMPTY_CROSS_COHORT_INDEX),
    );

    expect(result.current.placements).toHaveLength(2);
    expect(result.current.collisions.has(cellKey(1, 1))).toBe(true);
    expect(result.current.weekModeByCourseId.get("c1")).toBe("agnostic");
    // The board dispatches drops through these — every action the single board wires must be present.
    expect(typeof result.current.actions.addCourse).toBe("function");
    expect(typeof result.current.actions.parkMembers).toBe("function");
    expect(typeof result.current.actions.placeBack).toBe("function");
  });
});
