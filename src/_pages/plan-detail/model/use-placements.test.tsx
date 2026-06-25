import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cohort, PlacementWeek, WeekMode } from "@/shared/config";
import { moveBundleMembers, placeCourse, removeBundleMembers, updatePlacementWeek } from "../api/placement-client";
import { EMPTY_AVAILABILITY_INDEX } from "./availability-index";
import { biweekly, catalog, course, placement } from "./__fixtures__/builders";
import { cellKey, deriveCellViolations } from "./collisions";
import { EMPTY_CROSS_COHORT_INDEX } from "./cross-cohort-index";
import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";
import { usePlacements } from "./use-placements";

// The async boundary under test is the orchestration glue, so the network edge is mocked.
// The pure transitions it composes (`addReconcile`, `moveManyRollback`, …) are already
// unit-covered in `placement-transitions.test.ts`; here we drive the public hook API and
// assert the optimistic→settled lifecycle over the member-set RPCs, then re-derive the
// verdict off the settled state.
vi.mock("../api/placement-client", () => ({
  placeCourse: vi.fn(),
  moveBundleMembers: vi.fn(),
  removeBundleMembers: vi.fn(),
  updatePlacementWeek: vi.fn(),
}));

const placeMock = vi.mocked(placeCourse);
const moveMock = vi.mocked(moveBundleMembers);
const removeMock = vi.mocked(removeBundleMembers);
const updateWeekMock = vi.mocked(updatePlacementWeek);

const PLAN_ID = "plan-1";
const COHORT: Cohort = "dp1";

/** A controllable promise so the optimistic-pending intermediate state can be observed before settle. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Server-faithful defaults: echo args back as rows with stable ids + bundle ids, like the real RPCs. */
function serverEcho(prefix = "srv"): void {
  let n = 0;
  placeMock.mockImplementation((placeArgs) =>
    Promise.resolve({
      id: `${prefix}-${++n}`,
      courseId: placeArgs.courseId,
      day: placeArgs.day,
      period: placeArgs.period,
      week: placeArgs.week,
      bundleId: `bundle-${placeArgs.day}-${placeArgs.period}`,
    }),
  );
  // The real RPC relocates rows (id preserved); the mock echoes one settled row per moved course,
  // which the hook reconciles by course — the exact id is irrelevant to the lifecycle assertions.
  moveMock.mockImplementation((moveArgs) =>
    Promise.resolve(
      moveArgs.courseIds.map((courseId) => ({
        id: `moved-${courseId}`,
        courseId,
        day: moveArgs.targetDay,
        period: moveArgs.targetPeriod,
        week: "both" as const,
        bundleId: `bundle-${moveArgs.targetDay}-${moveArgs.targetPeriod}`,
      })),
    ),
  );
  removeMock.mockResolvedValue(undefined);
  updateWeekMock.mockImplementation((id, week) => Promise.resolve({ id, courseId: "echo", day: 1, period: 1, week }));
}

const args = (
  weekModeByCourseId: Map<string, WeekMode> = new Map(),
  opts: { catalog?: GroupingCourse[]; days?: number; periods?: number } = {},
) => ({
  planId: PLAN_ID,
  cohort: COHORT,
  weekModeByCourseId,
  // Oracle inputs the duplicate search reuses. Defaults keep the existing add/move/remove tests
  // (which never duplicate) working with an empty catalog + full-size grid.
  catalogById: new Map((opts.catalog ?? []).map((c) => [c.id, c] as const)),
  availabilityIndex: EMPTY_AVAILABILITY_INDEX,
  crossCohortIndex: EMPTY_CROSS_COHORT_INDEX,
  days: opts.days ?? 5,
  periods: opts.periods ?? 10,
});

beforeEach(() => {
  serverEcho();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePlacements — add", () => {
  it("shows an optimistic pending row immediately, then reconciles to the server row", async () => {
    const place = deferred<PlannerPlacement>();
    placeMock.mockReturnValueOnce(place.promise);

    const { result } = renderHook(() => usePlacements([], args()));

    act(() => {
      result.current.addCourse("c1", { day: 1, period: 1 });
    });

    // Optimistic: a pending row with a temp id appears before the await resolves.
    expect(result.current.placements).toHaveLength(1);
    expect(result.current.placements[0]).toMatchObject({ courseId: "c1", day: 1, period: 1, pending: true });
    const tempId = result.current.placements[0].id;

    await act(async () => {
      place.resolve({ id: "srv-1", courseId: "c1", day: 1, period: 1, week: "both", bundleId: "bundle-1-1" });
      await place.promise;
    });

    await waitFor(() => {
      expect(result.current.placements[0].id).toBe("srv-1");
    });
    expect(result.current.placements[0].id).not.toBe(tempId);
    expect(result.current.placements[0].pending).toBeUndefined();
    expect(result.current.placements[0].bundleId).toBe("bundle-1-1");
    expect(result.current.error).toBeNull();
  });

  it("rolls back the optimistic row and sets an error when the place rejects", async () => {
    placeMock.mockRejectedValueOnce(new Error("place boom"));

    const { result } = renderHook(() => usePlacements([], args()));

    act(() => {
      result.current.addCourse("c1", { day: 1, period: 1 });
    });

    await waitFor(() => {
      expect(result.current.placements).toHaveLength(0);
    });
    expect(result.current.error).toEqual({ kind: "message", message: "place boom" });
  });
});

describe("usePlacements — move", () => {
  const seeded: PlannerPlacement[] = [placement("p1", "c1", 1, 1)];

  it("shows the chip at the target (pending) then settles it via one atomic RPC — no separate delete", async () => {
    const move = deferred<PlannerPlacement[]>();
    moveMock.mockReturnValueOnce(move.promise);

    const { result } = renderHook(() => usePlacements(seeded, args()));

    act(() => {
      result.current.movePlacement("p1", { day: 2, period: 3 });
    });

    // Optimistic single pass: the chip sits at the target, pending, with no transient duplicate.
    expect(result.current.placements).toHaveLength(1);
    expect(result.current.placements[0]).toMatchObject({ courseId: "c1", day: 2, period: 3, pending: true });

    await act(async () => {
      move.resolve([{ id: "p1", courseId: "c1", day: 2, period: 3, week: "both", bundleId: "bundle-2-3" }]);
      await move.promise;
    });

    await waitFor(() => {
      expect(result.current.placements[0].pending).toBeFalsy();
    });
    expect(result.current.placements).toHaveLength(1);
    expect(result.current.placements[0]).toMatchObject({ courseId: "c1", day: 2, period: 3, bundleId: "bundle-2-3" });
    expect(moveMock).toHaveBeenCalledWith(
      expect.objectContaining({ day: 1, period: 1, courseIds: ["c1"], targetDay: 2, targetPeriod: 3 }),
    );
    expect(removeMock).not.toHaveBeenCalled(); // atomic — no best-effort origin delete
    expect(result.current.error).toBeNull();
  });

  it("rolls the whole move back to the origin and sets an error when the RPC rejects", async () => {
    moveMock.mockRejectedValueOnce(new Error("move boom"));

    const { result } = renderHook(() => usePlacements(seeded, args()));

    act(() => {
      result.current.movePlacement("p1", { day: 2, period: 3 });
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.placements).toHaveLength(1);
    expect(result.current.placements[0]).toMatchObject({ id: "p1", courseId: "c1", day: 1, period: 1 });
    expect(result.current.placements[0].pending).toBeFalsy();
    expect(result.current.error).toEqual({ kind: "message", message: "move boom" });
  });
});

describe("usePlacements — moveBundle (whole cell)", () => {
  const twoAtCell: PlannerPlacement[] = [placement("p1", "c1", 1, 1), placement("p2", "c2", 1, 1)];

  it("relocates every occupant to the target in one member-set move", async () => {
    const { result } = renderHook(() => usePlacements(twoAtCell, args()));

    act(() => {
      result.current.moveBundle(1, 1, { day: 2, period: 2 });
    });

    await waitFor(() => {
      expect(result.current.placements.every((p) => !p.pending)).toBe(true);
    });
    expect(result.current.placements).toHaveLength(2);
    expect(result.current.placements.every((p) => p.day === 2 && p.period === 2)).toBe(true);
    expect(moveMock).toHaveBeenCalledWith(
      expect.objectContaining({ day: 1, period: 1, courseIds: ["c1", "c2"], targetDay: 2, targetPeriod: 2 }),
    );
    expect(result.current.error).toBeNull();
  });
});

describe("usePlacements — remove", () => {
  const seeded: PlannerPlacement[] = [placement("p1", "c1", 1, 1)];

  it("optimistically removes the chip and calls removeBundleMembers with the cell + course", async () => {
    const { result } = renderHook(() => usePlacements(seeded, args()));

    act(() => {
      result.current.removePlacement("p1");
    });

    expect(result.current.placements).toHaveLength(0); // optimistic
    await waitFor(() => {
      expect(removeMock).toHaveBeenCalled();
    });
    expect(removeMock).toHaveBeenCalledWith(expect.objectContaining({ day: 1, period: 1, courseIds: ["c1"] }));
    expect(result.current.error).toBeNull();
  });

  it("restores the chip and sets an error when the remove RPC rejects", async () => {
    removeMock.mockRejectedValueOnce(new Error("remove boom"));

    const { result } = renderHook(() => usePlacements(seeded, args()));

    act(() => {
      result.current.removePlacement("p1");
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.placements).toHaveLength(1);
    expect(result.current.placements[0]).toMatchObject({ id: "p1", courseId: "c1", day: 1, period: 1 });
    expect(result.current.error).toEqual({ kind: "message", message: "remove boom" });
  });
});

describe("usePlacements — removeBundle (whole cell)", () => {
  const twoAtCell: PlannerPlacement[] = [placement("p1", "c1", 1, 1), placement("p2", "c2", 1, 1)];

  it("removes every occupant at the cell in one member-set remove", async () => {
    const { result } = renderHook(() => usePlacements(twoAtCell, args()));

    act(() => {
      result.current.removeBundle(1, 1);
    });

    expect(result.current.placements).toHaveLength(0);
    await waitFor(() => {
      expect(removeMock).toHaveBeenCalled();
    });
    expect(removeMock).toHaveBeenCalledWith(expect.objectContaining({ day: 1, period: 1, courseIds: ["c1", "c2"] }));
    expect(result.current.error).toBeNull();
  });
});

describe("usePlacements — setWeek", () => {
  const seededBiweekly: PlannerPlacement[] = [placement("p1", "c1", 1, 1, "a")];

  it("flips the lane optimistically and reconciles to the server row", async () => {
    const { result } = renderHook(() => usePlacements(seededBiweekly, args(new Map([["c1", "biweekly"]]))));

    act(() => {
      result.current.setWeek("p1", "b");
    });

    await waitFor(() => {
      expect(result.current.placements[0].week).toBe("b");
    });
    expect(updateWeekMock).toHaveBeenCalledWith("p1", "b");
    expect(result.current.error).toBeNull();
  });

  it("rolls the lane back to the previous week when the update rejects", async () => {
    updateWeekMock.mockRejectedValueOnce(new Error("week boom"));

    const { result } = renderHook(() => usePlacements(seededBiweekly, args(new Map([["c1", "biweekly"]]))));

    act(() => {
      result.current.setWeek("p1", "b");
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.placements[0].week).toBe("a");
    expect(result.current.error).toEqual({ kind: "message", message: "week boom" });
  });
});

// The real Risk #2 surface: after the async glue settles, the locally-derived verdict must
// recompute off the *settled* placement state — not the optimistic guess. Expected verdicts are
// hand-built from the catalog fixture (shared teacher t1), never recomputed from the validator.
describe("usePlacements — verdict recomputes off settled state", () => {
  it("an accepted non-colliding drop yields no blocking verdict", async () => {
    // c1/c2 share neither teacher nor student → no collision even in the same cell.
    const catalogById = catalog(course("c1", "t1"), course("c2", "t2"));
    const { result } = renderHook(() => usePlacements([], args()));

    act(() => {
      result.current.addCourse("c1", { day: 1, period: 1 });
    });
    await waitFor(() => {
      expect(result.current.placements).toHaveLength(1);
    });
    act(() => {
      result.current.addCourse("c2", { day: 1, period: 1 });
    });
    await waitFor(() => {
      expect(result.current.placements).toHaveLength(2);
    });

    const verdict = deriveCellViolations(result.current.placements, catalogById);
    expect(verdict.has(cellKey(1, 1))).toBe(false);
  });

  it("week both vs both: a colliding drop yields the expected blocking ids", async () => {
    // Two agnostic courses (week `both`) sharing teacher t1 in one cell → teacher collision.
    const catalogById = catalog(course("c1", "t1"), course("c2", "t1"));
    const { result } = renderHook(() => usePlacements([], args()));

    act(() => {
      result.current.addCourse("c1", { day: 1, period: 1 });
    });
    await waitFor(() => {
      expect(result.current.placements).toHaveLength(1);
    });
    act(() => {
      result.current.addCourse("c2", { day: 1, period: 1 });
    });
    await waitFor(() => {
      expect(result.current.placements).toHaveLength(2);
    });

    // Both settled rows are week `both` (agnostic) → weeks overlap → collision.
    expect(result.current.placements.every((p) => p.week === "both")).toBe(true);
    const verdict = deriveCellViolations(result.current.placements, catalogById);
    const cell = verdict.get(cellKey(1, 1));
    expect(cell?.blockingIds).toEqual(new Set(["c1", "c2"]));
  });

  it("week a vs b: opposite-week biweekly courses sharing a teacher do not collide", async () => {
    // Same shared teacher, but bi-weekly courses resolve to opposite lanes (a then b) → disjoint.
    const catalogById = catalog(course("c1", "t1"), course("c2", "t1"));
    const biweeklyModes = new Map<string, WeekMode>([
      ["c1", "biweekly"],
      ["c2", "biweekly"],
    ]);
    const { result } = renderHook(() => usePlacements([], args(biweeklyModes)));

    act(() => {
      result.current.addCourse("c1", { day: 1, period: 1 });
    });
    await waitFor(() => {
      expect(result.current.placements).toHaveLength(1);
    });
    act(() => {
      result.current.addCourse("c2", { day: 1, period: 1 });
    });
    await waitFor(() => {
      expect(result.current.placements).toHaveLength(2);
    });

    // Drop-time week resolution put them on opposite lanes.
    const weeks = result.current.placements.map((p) => p.week).sort();
    expect(weeks).toEqual<PlacementWeek[]>(["a", "b"]);
    const verdict = deriveCellViolations(result.current.placements, catalogById);
    expect(verdict.has(cellKey(1, 1))).toBe(false);
  });
});

/** placeCourse calls keyed by courseId → the week it was placed on (the assertion of interest). */
const weeksByCourse = (): Record<string, PlacementWeek> =>
  Object.fromEntries(placeMock.mock.calls.map(([a]) => [a.courseId, a.week]));

describe("usePlacements — duplicateBundle", () => {
  it("mirrors each source member's A/B week into the next free cell (week-faithful)", async () => {
    const a = biweekly("A", "ta");
    const b = biweekly("B", "tb");
    const initial = [placement("p1", "A", 1, 1, "a"), placement("p2", "B", 1, 1, "b")];
    const { result } = renderHook(() =>
      usePlacements(initial, args(new Map(), { catalog: [a, b], days: 2, periods: 2 })),
    );

    await act(async () => {
      result.current.duplicateBundle(1, 1);
      await Promise.resolve(); // let the optimistic fan-out settle inside act
    });

    // Landed at the next column-major free cell after the source (1,1) → (1,2).
    expect(placeMock).toHaveBeenCalledTimes(2);
    for (const [callArgs] of placeMock.mock.calls) {
      expect(callArgs.day).toBe(1);
      expect(callArgs.period).toBe(2);
    }
    // The exact A/B layout is reproduced, not re-resolved.
    expect(weeksByCourse()).toEqual({ A: "a", B: "b" });
    expect(result.current.lastDuplicated).toMatchObject({ day: 1, period: 2, nonce: 1 });
    expect(result.current.error).toBeNull();
  });

  it("is a no-op when any source row is still pending", () => {
    const a = course("A", "ta");
    const pendingRow: PlannerPlacement & { pending?: boolean } = {
      id: "p1",
      courseId: "A",
      day: 1,
      period: 1,
      week: "both",
      pending: true,
    };
    const { result } = renderHook(() => usePlacements([pendingRow], args(new Map(), { catalog: [a] })));

    act(() => {
      result.current.duplicateBundle(1, 1);
    });

    expect(placeMock).not.toHaveBeenCalled();
    expect(result.current.lastDuplicated).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("is a no-op when the source cell is empty", () => {
    const a = course("A", "ta");
    const { result } = renderHook(() => usePlacements([placement("p1", "A", 1, 1)], args(new Map(), { catalog: [a] })));

    act(() => {
      result.current.duplicateBundle(2, 2); // nothing placed here
    });

    expect(placeMock).not.toHaveBeenCalled();
    expect(result.current.lastDuplicated).toBeNull();
  });

  it("sets the message error and places nothing when no empty slot qualifies", () => {
    const a = course("A", "ta");
    const b = course("B", "tb");
    // 1×2 grid: source at (1,1), the only other cell (1,2) occupied → no empty cell anywhere.
    const initial = [placement("p1", "A", 1, 1), placement("p2", "B", 1, 2)];
    const { result } = renderHook(() =>
      usePlacements(initial, args(new Map(), { catalog: [a, b], days: 1, periods: 2 })),
    );

    act(() => {
      result.current.duplicateBundle(1, 1);
    });

    expect(placeMock).not.toHaveBeenCalled();
    expect(result.current.error).toEqual({ kind: "message", message: "No empty slot available to duplicate into" });
    expect(result.current.lastDuplicated).toBeNull();
  });

  it("bumps the nonce on each successful duplicate so a repeat re-fires the feedback", async () => {
    const a = course("A", "ta");
    const { result } = renderHook(() =>
      usePlacements([placement("p1", "A", 1, 1)], args(new Map(), { catalog: [a], days: 3, periods: 3 })),
    );

    await act(async () => {
      result.current.duplicateBundle(1, 1);
      await Promise.resolve();
    });
    expect(result.current.lastDuplicated?.nonce).toBe(1);

    await act(async () => {
      result.current.duplicateBundle(1, 1); // source still there → next free cell again
      await Promise.resolve();
    });
    expect(result.current.lastDuplicated?.nonce).toBe(2);
  });
});

describe("usePlacements — addGroup week precedence", () => {
  it("uses an explicit weekByMember over resolveDropWeek", async () => {
    const a = biweekly("A", "ta");
    const { result } = renderHook(() => usePlacements([], args(new Map([["A", "biweekly"]]), { catalog: [a] })));

    await act(async () => {
      result.current.addGroup(["A"], { day: 1, period: 1 }, { weekByMember: new Map([["A", "b"]]) });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(placeMock).toHaveBeenCalledTimes(1);
    });
    expect(weeksByCourse()).toEqual({ A: "b" }); // resolveDropWeek would have chosen "a"
  });

  it("falls back to resolveDropWeek for the plain grouping-drop path (agnostic ⇒ both)", async () => {
    const a = course("A", "ta");
    const { result } = renderHook(() => usePlacements([], args(new Map(), { catalog: [a] })));

    await act(async () => {
      result.current.addGroup(["A"], { day: 1, period: 1 });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(placeMock).toHaveBeenCalledTimes(1);
    });
    expect(weeksByCourse()).toEqual({ A: "both" });
  });

  it("alternates a/b for an opposite-week grouping when no explicit weeks are given", async () => {
    const a = biweekly("A", "ta");
    const b = biweekly("B", "tb");
    const modes = new Map<string, WeekMode>([
      ["A", "biweekly"],
      ["B", "biweekly"],
    ]);
    const { result } = renderHook(() => usePlacements([], args(modes, { catalog: [a, b] })));

    await act(async () => {
      result.current.addGroup(["A", "B"], { day: 1, period: 1 }, { oppositeWeek: true });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(placeMock).toHaveBeenCalledTimes(2);
    });
    // oppositeWeekAssignment sorts ids then alternates: A → a, B → b.
    expect(weeksByCourse()).toEqual({ A: "a", B: "b" });
  });
});
