import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cohort, PlacementWeek, WeekMode } from "@/shared/config";
import { createPlacement, deletePlacement, updatePlacementWeek } from "../api/placement-client";
import { catalog, course, placement } from "./__fixtures__/builders";
import { cellKey, deriveCellViolations } from "./collisions";
import type { PlannerPlacement } from "./placement";
import { usePlacements } from "./use-placements";

// The async boundary under test is the orchestration glue, so the network edge is mocked.
// The pure transitions it composes (`addReconcile`, `moveRollback`, …) are already unit-covered
// in `placement-transitions.test.ts`; here we drive the public hook API and assert the
// optimistic→settled lifecycle, then re-derive the verdict off the settled state.
vi.mock("../api/placement-client", () => ({
  createPlacement: vi.fn(),
  deletePlacement: vi.fn(),
  updatePlacementWeek: vi.fn(),
}));

const createMock = vi.mocked(createPlacement);
const deleteMock = vi.mocked(deletePlacement);
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

/** Server-faithful default: echo the persisted args back as a row with a stable id, like the real insert. */
function serverEcho(prefix = "srv"): void {
  let n = 0;
  createMock.mockImplementation((createArgs) =>
    Promise.resolve({
      id: `${prefix}-${++n}`,
      courseId: createArgs.courseId,
      day: createArgs.day,
      period: createArgs.period,
      week: createArgs.week,
    }),
  );
  deleteMock.mockResolvedValue(undefined);
  updateWeekMock.mockImplementation((id, week) => Promise.resolve({ id, courseId: "echo", day: 1, period: 1, week }));
}

const args = (weekModeByCourseId: Map<string, WeekMode> = new Map()) => ({
  planId: PLAN_ID,
  cohort: COHORT,
  weekModeByCourseId,
});

beforeEach(() => {
  serverEcho();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePlacements — add", () => {
  it("shows an optimistic pending row immediately, then reconciles to the server id", async () => {
    const create = deferred<PlannerPlacement>();
    createMock.mockReturnValueOnce(create.promise);

    const { result } = renderHook(() => usePlacements([], args()));

    act(() => {
      result.current.addCourse("c1", { day: 1, period: 1 });
    });

    // Optimistic: a pending row with a temp id appears before the await resolves.
    expect(result.current.placements).toHaveLength(1);
    expect(result.current.placements[0]).toMatchObject({ courseId: "c1", day: 1, period: 1, pending: true });
    const tempId = result.current.placements[0].id;

    await act(async () => {
      create.resolve({ id: "srv-1", courseId: "c1", day: 1, period: 1, week: "both" });
      await create.promise;
    });

    await waitFor(() => {
      expect(result.current.placements[0].id).toBe("srv-1");
    });
    expect(result.current.placements[0].id).not.toBe(tempId);
    expect(result.current.placements[0].pending).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it("rolls back the optimistic row and sets an error when the insert rejects", async () => {
    createMock.mockRejectedValueOnce(new Error("insert boom"));

    const { result } = renderHook(() => usePlacements([], args()));

    act(() => {
      result.current.addCourse("c1", { day: 1, period: 1 });
    });

    await waitFor(() => {
      expect(result.current.placements).toHaveLength(0);
    });
    expect(result.current.error).toEqual({ kind: "message", message: "insert boom" });
  });
});

describe("usePlacements — move", () => {
  const seeded: PlannerPlacement[] = [placement("p1", "c1", 1, 1)];

  it("reconciles the destination then cleans up the origin row (no error)", async () => {
    const { result } = renderHook(() => usePlacements(seeded, args()));

    act(() => {
      result.current.movePlacement("p1", { day: 2, period: 3 });
    });

    await waitFor(() => {
      expect(result.current.placements[0].id).toBe("srv-1");
    });
    expect(result.current.placements).toHaveLength(1);
    expect(result.current.placements[0]).toMatchObject({ courseId: "c1", day: 2, period: 3 });
    expect(result.current.placements[0].pending).toBeUndefined();
    // Origin row cleanup: the old id is DELETEd, and the move reports no error.
    expect(deleteMock).toHaveBeenCalledWith("p1");
    expect(result.current.error).toBeNull();
  });

  it("rolls the chip back to its origin and sets an error when the destination insert rejects", async () => {
    createMock.mockRejectedValueOnce(new Error("move boom"));

    const { result } = renderHook(() => usePlacements(seeded, args()));

    act(() => {
      result.current.movePlacement("p1", { day: 2, period: 3 });
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.placements).toHaveLength(1);
    expect(result.current.placements[0]).toMatchObject({ id: "p1", day: 1, period: 1 });
    expect(result.current.placements[0].pending).toBeFalsy();
    // A failed destination insert must NOT delete the origin row.
    expect(deleteMock).not.toHaveBeenCalled();
    expect(result.current.error).toEqual({ kind: "message", message: "move boom" });
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
