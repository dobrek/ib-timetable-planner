import { describe, expect, it, vi } from "vitest";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { WeekMode } from "@/shared/config";
import {
  course,
  EMPTY_AVAILABILITY_INDEX,
  EMPTY_CROSS_COHORT_INDEX,
  type LocalPlacement,
  placement,
  type PlannerPlacement,
} from "@/entities/timetable";
import type { GroupingCourse } from "../grouping/grouping";
import { createBoardWrites, type BoardDeps } from "./board-writes";
import type { LocalParkedBundle } from "./parked";
import type { WriteContext } from "./write-context";

// Drive the board factory against a FAKE WriteContext + boardDeps — stub stores applying functional
// updaters, stub `rpcs` resolving/rejecting, spies on `recordEdit`/`setError`/`setLastDuplicated`. No
// rendering. Mirrors `placement-transitions.test.ts` style; handlers are fire-and-forget so each test
// flushes the microtask queue after dispatching.

const serverRow = (id: string, courseId: string, day: number, period: number): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
  week: "both",
  isOptional: false,
  bundleId: `bundle-${day}-${period}`,
});

/** A live store whose `ref.current` reflects the latest functional-updater result. */
function makeStore<T>(initial: T[]): { ref: RefObject<T[]>; setter: Dispatch<SetStateAction<T[]>> } {
  const box: { current: T[] } = { current: initial };
  const setter: Dispatch<SetStateAction<T[]>> = (update) => {
    box.current = typeof update === "function" ? update(box.current) : update;
  };
  return { ref: box, setter };
}

/** Two microtask ticks — enough to drain a single `await rpcs.*` continuation and its sync tail. */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

function makeHarness(
  opts: {
    placements?: LocalPlacement[];
    weekModes?: Map<string, WeekMode>;
    catalog?: GroupingCourse[];
    days?: number;
    periods?: number;
  } = {},
) {
  const placements = makeStore<LocalPlacement>(opts.placements ?? []);
  const parked = makeStore<LocalParkedBundle>([]);
  const recordEdit = vi.fn();
  const setError = vi.fn();
  const setLastDuplicated = vi.fn();
  const snapshot = vi.fn(() => ({ placements: [], cards: [] }));
  const rpcs = {
    placeCourse: vi.fn(),
    moveBundleMembers: vi.fn(),
    removeBundleMembers: vi.fn(),
    updatePlacementWeek: vi.fn(),
    shelveBundle: vi.fn(),
    unshelveBundle: vi.fn(),
    deleteShelfBundle: vi.fn(),
    shelveCourses: vi.fn(),
  };

  const ctx: WriteContext = {
    rpcs,
    placementsRef: placements.ref,
    parkedBundlesRef: parked.ref,
    setPlacements: placements.setter,
    setParkedBundles: parked.setter,
    setError,
    recordEdit,
    snapshot,
  };

  const weekModeByCourseId = opts.weekModes ?? new Map<string, WeekMode>();
  const boardDeps: BoardDeps = {
    catalogById: new Map((opts.catalog ?? []).map((c) => [c.id, c])),
    availabilityIndex: EMPTY_AVAILABILITY_INDEX,
    crossCohortIndex: EMPTY_CROSS_COHORT_INDEX,
    days: opts.days ?? 5,
    periods: opts.periods ?? 10,
    weekModeOf: (courseId) => weekModeByCourseId.get(courseId) ?? "agnostic",
    setLastDuplicated,
  };

  return { writes: createBoardWrites(ctx, boardDeps), placements, recordEdit, setError, setLastDuplicated, rpcs };
}

describe("createBoardWrites — addCourse", () => {
  it("shows a pending row, then reconciles to the server row", async () => {
    const h = makeHarness();
    h.rpcs.placeCourse.mockResolvedValueOnce(serverRow("srv-1", "c1", 1, 1));

    h.writes.addCourse("c1", { day: 1, period: 1 });

    expect(h.placements.ref.current).toHaveLength(1);
    expect(h.placements.ref.current[0]).toMatchObject({ courseId: "c1", day: 1, period: 1, pending: true });

    await flush();

    expect(h.placements.ref.current[0].id).toBe("srv-1");
    expect(h.placements.ref.current[0].pending).toBeUndefined();
    expect(h.recordEdit).toHaveBeenCalledWith("add", expect.anything(), expect.anything(), { day: 1, period: 1 });
    expect(h.setError).toHaveBeenLastCalledWith(null);
  });

  it("rolls back the optimistic row and sets an error when the place rejects", async () => {
    const h = makeHarness();
    h.rpcs.placeCourse.mockRejectedValueOnce(new Error("place boom"));

    h.writes.addCourse("c1", { day: 1, period: 1 });
    await flush();

    expect(h.placements.ref.current).toHaveLength(0);
    expect(h.setError).toHaveBeenLastCalledWith({ kind: "message", message: "place boom" });
  });

  it("is a no-op when the course already occupies the cell", () => {
    const h = makeHarness({ placements: [placement("p1", "c1", 1, 1)] });
    h.writes.addCourse("c1", { day: 1, period: 1 });
    expect(h.rpcs.placeCourse).not.toHaveBeenCalled();
    expect(h.placements.ref.current).toHaveLength(1);
  });
});

describe("createBoardWrites — movePlacement", () => {
  it("relocates the chip in one atomic move (no separate delete) and settles it", async () => {
    const h = makeHarness({ placements: [placement("p1", "c1", 1, 1)] });
    h.rpcs.moveBundleMembers.mockResolvedValueOnce([serverRow("p1", "c1", 2, 3)]);

    h.writes.movePlacement("p1", { day: 2, period: 3 });

    expect(h.placements.ref.current).toHaveLength(1);
    expect(h.placements.ref.current[0]).toMatchObject({ courseId: "c1", day: 2, period: 3, pending: true });

    await flush();

    expect(h.placements.ref.current[0].pending).toBeFalsy();
    expect(h.rpcs.moveBundleMembers).toHaveBeenCalledWith(
      expect.objectContaining({ day: 1, period: 1, courseIds: ["c1"], targetDay: 2, targetPeriod: 3 }),
    );
    expect(h.rpcs.removeBundleMembers).not.toHaveBeenCalled();
    expect(h.recordEdit).toHaveBeenCalledWith("move", expect.anything(), expect.anything(), { day: 2, period: 3 });
    expect(h.setError).toHaveBeenLastCalledWith(null);
  });

  it("rolls the move back to the origin when the RPC rejects", async () => {
    const h = makeHarness({ placements: [placement("p1", "c1", 1, 1)] });
    h.rpcs.moveBundleMembers.mockRejectedValueOnce(new Error("move boom"));

    h.writes.movePlacement("p1", { day: 2, period: 3 });
    await flush();

    expect(h.placements.ref.current).toHaveLength(1);
    expect(h.placements.ref.current[0]).toMatchObject({ id: "p1", day: 1, period: 1 });
    expect(h.placements.ref.current[0].pending).toBeFalsy();
    expect(h.setError).toHaveBeenLastCalledWith({ kind: "message", message: "move boom" });
  });

  it("is a no-op for a same-cell move", () => {
    const h = makeHarness({ placements: [placement("p1", "c1", 1, 1)] });
    h.writes.movePlacement("p1", { day: 1, period: 1 });
    expect(h.rpcs.moveBundleMembers).not.toHaveBeenCalled();
  });
});

describe("createBoardWrites — moveBundle (whole cell)", () => {
  it("relocates every occupant in one member-set move", async () => {
    const h = makeHarness({ placements: [placement("p1", "c1", 1, 1), placement("p2", "c2", 1, 1)] });
    h.rpcs.moveBundleMembers.mockResolvedValueOnce([serverRow("p1", "c1", 2, 2), serverRow("p2", "c2", 2, 2)]);

    h.writes.moveBundle(1, 1, { day: 2, period: 2 });
    await flush();

    expect(h.placements.ref.current).toHaveLength(2);
    expect(h.placements.ref.current.every((p) => p.day === 2 && p.period === 2 && !p.pending)).toBe(true);
    expect(h.rpcs.moveBundleMembers).toHaveBeenCalledWith(
      expect.objectContaining({ day: 1, period: 1, courseIds: ["c1", "c2"], targetDay: 2, targetPeriod: 2 }),
    );
    expect(h.recordEdit).toHaveBeenCalledWith("moveBundle", expect.anything(), expect.anything(), {
      day: 2,
      period: 2,
    });
  });

  it("surfaces a partial-failure banner when one mover's server row is missing", async () => {
    const h = makeHarness({ placements: [placement("p1", "c1", 1, 1), placement("p2", "c2", 1, 1)] });
    // The atomic move resolves but returns a row for c1 only; c2 has no server row → partial failure.
    h.rpcs.moveBundleMembers.mockResolvedValueOnce([serverRow("p1", "c1", 2, 2)]);

    h.writes.moveBundle(1, 1, { day: 2, period: 2 });
    await flush();

    expect(h.setError).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "groupFailure", failedCourseIds: ["c2"], attempted: 2 }),
    );
  });
});

describe("createBoardWrites — removePlacement / removeBundle", () => {
  it("optimistically removes the chip and calls removeBundleMembers with the cell + course", async () => {
    const h = makeHarness({ placements: [placement("p1", "c1", 1, 1)] });
    h.rpcs.removeBundleMembers.mockResolvedValueOnce(undefined);

    h.writes.removePlacement("p1");
    expect(h.placements.ref.current).toHaveLength(0); // optimistic

    await flush();

    expect(h.rpcs.removeBundleMembers).toHaveBeenCalledWith({ day: 1, period: 1, courseIds: ["c1"] });
    expect(h.recordEdit).toHaveBeenCalledWith("remove", expect.anything(), expect.anything(), { day: 1, period: 1 });
    expect(h.setError).toHaveBeenLastCalledWith(null);
  });

  it("restores the chip when the remove RPC rejects", async () => {
    const h = makeHarness({ placements: [placement("p1", "c1", 1, 1)] });
    h.rpcs.removeBundleMembers.mockRejectedValueOnce(new Error("remove boom"));

    h.writes.removePlacement("p1");
    await flush();

    expect(h.placements.ref.current).toHaveLength(1);
    expect(h.placements.ref.current[0]).toMatchObject({ id: "p1", courseId: "c1", day: 1, period: 1 });
    expect(h.setError).toHaveBeenLastCalledWith({ kind: "message", message: "remove boom" });
  });

  it("removeBundle removes every occupant at the cell in one member-set remove", async () => {
    const h = makeHarness({ placements: [placement("p1", "c1", 1, 1), placement("p2", "c2", 1, 1)] });
    h.rpcs.removeBundleMembers.mockResolvedValueOnce(undefined);

    h.writes.removeBundle(1, 1);
    expect(h.placements.ref.current).toHaveLength(0);

    await flush();
    expect(h.rpcs.removeBundleMembers).toHaveBeenCalledWith({ day: 1, period: 1, courseIds: ["c1", "c2"] });
  });
});

describe("createBoardWrites — setWeek", () => {
  const biweeklyModes = new Map<string, WeekMode>([["c1", "biweekly"]]);

  it("flips the lane optimistically and reconciles to the server row", async () => {
    const h = makeHarness({ placements: [placement("p1", "c1", 1, 1, "a")], weekModes: biweeklyModes });
    h.rpcs.updatePlacementWeek.mockResolvedValueOnce(serverRow("p1", "c1", 1, 1));

    h.writes.setWeek("p1", "b");
    expect(h.placements.ref.current[0].week).toBe("b"); // optimistic

    await flush();
    expect(h.rpcs.updatePlacementWeek).toHaveBeenCalledWith("p1", "b");
    expect(h.recordEdit).toHaveBeenCalledWith("setWeek", expect.anything(), expect.anything(), { day: 1, period: 1 });
    expect(h.setError).toHaveBeenLastCalledWith(null);
  });

  it("rolls the lane back to the previous week when the update rejects", async () => {
    const h = makeHarness({ placements: [placement("p1", "c1", 1, 1, "a")], weekModes: biweeklyModes });
    h.rpcs.updatePlacementWeek.mockRejectedValueOnce(new Error("week boom"));

    h.writes.setWeek("p1", "b");
    await flush();

    expect(h.placements.ref.current[0].week).toBe("a");
    expect(h.setError).toHaveBeenLastCalledWith({ kind: "message", message: "week boom" });
  });
});

describe("createBoardWrites — addGroup", () => {
  it("honors an explicit weekByMember over resolveDropWeek", async () => {
    const h = makeHarness({ weekModes: new Map([["A", "biweekly"]]) });
    h.rpcs.placeCourse.mockResolvedValueOnce(serverRow("srv-1", "A", 1, 1));

    h.writes.addGroup(["A"], { day: 1, period: 1 }, { weekByMember: new Map([["A", "b"]]) });
    await flush();

    expect(h.rpcs.placeCourse).toHaveBeenCalledTimes(1);
    expect(h.rpcs.placeCourse).toHaveBeenCalledWith(expect.objectContaining({ courseId: "A", week: "b" }));
  });

  it("alternates a/b weeks across members when oppositeWeek is set", async () => {
    const h = makeHarness();
    h.rpcs.placeCourse.mockResolvedValue(serverRow("srv", "x", 1, 1));

    h.writes.addGroup(["c1", "c2"], { day: 1, period: 1 }, { oppositeWeek: true });
    await flush();

    expect(h.rpcs.placeCourse).toHaveBeenCalledWith(expect.objectContaining({ courseId: "c1", week: "a" }));
    expect(h.rpcs.placeCourse).toHaveBeenCalledWith(expect.objectContaining({ courseId: "c2", week: "b" }));
  });

  it("surfaces a partial-failure banner when one member fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = makeHarness();
    h.rpcs.placeCourse
      .mockRejectedValueOnce(new Error("member boom"))
      .mockResolvedValueOnce(serverRow("srv-2", "c2", 1, 1));

    h.writes.addGroup(["c1", "c2"], { day: 1, period: 1 });
    await flush();

    expect(h.setError).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "groupFailure" }));
    errSpy.mockRestore();
  });
});

describe("createBoardWrites — duplicateBundle", () => {
  it("fans the bundle into the next free cell and publishes the landing (setLastDuplicated)", async () => {
    const h = makeHarness({
      placements: [placement("p1", "A", 1, 1)],
      catalog: [course("A", "ta")],
      days: 3,
      periods: 3,
    });
    h.rpcs.placeCourse.mockResolvedValueOnce(serverRow("srv-1", "A", 1, 2));

    h.writes.duplicateBundle(1, 1);

    // The landing cell is published synchronously (optimistic pulse), before the fan-out settles.
    expect(h.setLastDuplicated).toHaveBeenCalledTimes(1);

    await flush();
    expect(h.rpcs.placeCourse).toHaveBeenCalledWith(expect.objectContaining({ courseId: "A", day: 1, period: 2 }));
  });

  it("sets the message error and places nothing when no empty slot qualifies", () => {
    const h = makeHarness({
      placements: [placement("pA", "A", 1, 1), placement("pB", "B", 1, 2)],
      catalog: [course("A", "ta"), course("B", "tb")],
      days: 1,
      periods: 2,
    });

    h.writes.duplicateBundle(1, 1);

    expect(h.rpcs.placeCourse).not.toHaveBeenCalled();
    expect(h.setError).toHaveBeenCalledWith({ kind: "message", message: "No empty slot available to duplicate into" });
    expect(h.setLastDuplicated).not.toHaveBeenCalled();
  });

  it("is a no-op for an empty or pending source cell", () => {
    const empty = makeHarness({ catalog: [course("A", "ta")] });
    empty.writes.duplicateBundle(2, 2);
    expect(empty.rpcs.placeCourse).not.toHaveBeenCalled();

    const pending: LocalPlacement = {
      id: "p1",
      courseId: "A",
      day: 1,
      period: 1,
      week: "both",
      isOptional: false,
      pending: true,
    };
    const busy = makeHarness({ placements: [pending], catalog: [course("A", "ta")] });
    busy.writes.duplicateBundle(1, 1);
    expect(busy.rpcs.placeCourse).not.toHaveBeenCalled();
    expect(busy.setLastDuplicated).not.toHaveBeenCalled();
  });
});
