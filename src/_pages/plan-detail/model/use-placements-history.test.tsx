import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cohort, PlacementWeek, WeekMode } from "@/shared/config";
import { moveBundleMembers, placeCourse, removeBundleMembers, updatePlacementWeek } from "../api/placement-client";
import { deleteShelfBundle, shelveBundle, shelveCourses, unshelveBundle } from "../api/shelf-client";
import { course, EMPTY_AVAILABILITY_INDEX, EMPTY_CROSS_COHORT_INDEX, placement } from "@/entities/timetable";
import type { GroupingCourse } from "./grouping/grouping";
import type { HistoryEntry } from "./history/history-entry";
import type { ParkedBundle, ParkedMember } from "./placement/parked";
import { usePlacements } from "./use-placements";

// This suite drives the undo/redo write-path seam: that `onRecord` fires once per settled edit
// across the op matrix (and never on rollback / from `applyReconcile`), and that `applyReconcile`
// drives both stores over the mocked RPCs with id-remap, two-store atomicity, and rollback.
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

const placeMock = vi.mocked(placeCourse);
const moveMock = vi.mocked(moveBundleMembers);
const removeMock = vi.mocked(removeBundleMembers);
const updateWeekMock = vi.mocked(updatePlacementWeek);
const shelveMock = vi.mocked(shelveBundle);
const unshelveMock = vi.mocked(unshelveBundle);
const deleteShelfMock = vi.mocked(deleteShelfBundle);
const shelveCoursesMock = vi.mocked(shelveCourses);

const PLAN_ID = "plan-1";
const COHORT: Cohort = "dp1";

type RecordFn = (entry: Omit<HistoryEntry, "cohort">) => void;

const member = (courseId: string, week: PlacementWeek = "both"): ParkedMember => ({
  courseId,
  week,
  isOptional: false,
});

function serverEcho(): void {
  let n = 0;
  placeMock.mockImplementation((a) =>
    Promise.resolve({
      id: `srv-${++n}`,
      courseId: a.courseId,
      day: a.day,
      period: a.period,
      week: a.week,
      isOptional: false,
      bundleId: `bundle-${a.day}-${a.period}`,
    }),
  );
  moveMock.mockImplementation((a) =>
    Promise.resolve(
      a.courseIds.map((courseId) => ({
        id: `moved-${courseId}`,
        courseId,
        day: a.targetDay,
        period: a.targetPeriod,
        week: "both" as const,
        isOptional: false,
        bundleId: `bundle-${a.targetDay}-${a.targetPeriod}`,
      })),
    ),
  );
  removeMock.mockResolvedValue(undefined);
  updateWeekMock.mockImplementation((id, week) =>
    Promise.resolve({ id, courseId: "echo", day: 1, period: 1, week, isOptional: false }),
  );
  shelveMock.mockImplementation((a) => Promise.resolve({ id: `shelf-${a.day}-${a.period}`, members: [] }));
  unshelveMock.mockImplementation((a) =>
    Promise.resolve([
      {
        id: `un-${a.shelfBundleId}`,
        courseId: "c1",
        day: a.targetDay,
        period: a.targetPeriod,
        week: "both",
        isOptional: false,
        bundleId: "b",
      },
    ]),
  );
  deleteShelfMock.mockResolvedValue(undefined);
  shelveCoursesMock.mockImplementation((a) => Promise.resolve({ id: "shelf-courses", members: a.members }));
}

const mkArgs = (
  onRecord: RecordFn | undefined,
  weekModeByCourseId: Map<string, WeekMode> = new Map(),
  opts: { catalog?: GroupingCourse[]; days?: number; periods?: number; initialParked?: ParkedBundle[] } = {},
) => ({
  planId: PLAN_ID,
  cohort: COHORT,
  weekModeByCourseId,
  catalogById: new Map((opts.catalog ?? []).map((c) => [c.id, c] as const)),
  availabilityIndex: EMPTY_AVAILABILITY_INDEX,
  crossCohortIndex: EMPTY_CROSS_COHORT_INDEX,
  days: opts.days ?? 5,
  periods: opts.periods ?? 10,
  initialParked: opts.initialParked ?? [],
  onRecord,
});

beforeEach(() => {
  serverEcho();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("onRecord matrix — fires once per settled edit", () => {
  it("add", async () => {
    const onRecord = vi.fn<RecordFn>();
    const { result } = renderHook(() => usePlacements([], mkArgs(onRecord)));
    act(() => {
      result.current.addCourse("c1", { day: 1, period: 1 });
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0]).toMatchObject({
      label: "Place course at Mon · P1",
      scope: { cells: ["1:1"], cardSets: [] },
      target: { placements: [], cards: [] },
    });
  });

  it("group", async () => {
    const onRecord = vi.fn<RecordFn>();
    const { result } = renderHook(() => usePlacements([], mkArgs(onRecord)));
    act(() => {
      result.current.addGroup(["c1", "c2"], { day: 1, period: 1 });
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0]).toMatchObject({ label: "Place group at Mon · P1" });
  });

  it("single move", async () => {
    const onRecord = vi.fn<RecordFn>();
    const { result } = renderHook(() => usePlacements([placement("p1", "c1", 1, 1)], mkArgs(onRecord)));
    act(() => {
      result.current.movePlacement("p1", { day: 2, period: 2 });
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0]).toMatchObject({
      label: "Move course at Tue · P2",
      scope: { cells: ["1:1", "2:2"], cardSets: [] },
    });
  });

  it("bundle move", async () => {
    const onRecord = vi.fn<RecordFn>();
    const initial = [placement("p1", "c1", 1, 1), placement("p2", "c2", 1, 1)];
    const { result } = renderHook(() => usePlacements(initial, mkArgs(onRecord)));
    act(() => {
      result.current.moveBundle(1, 1, { day: 2, period: 2 });
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0]).toMatchObject({ label: "Move bundle at Tue · P2" });
  });

  it("merge (move onto a shared-course cell) records once", async () => {
    const onRecord = vi.fn<RecordFn>();
    const initial = [placement("p1", "c1", 1, 1), placement("p2", "c1", 2, 2)];
    const { result } = renderHook(() => usePlacements(initial, mkArgs(onRecord)));
    act(() => {
      result.current.moveBundle(1, 1, { day: 2, period: 2 });
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
  });

  it("single remove", async () => {
    const onRecord = vi.fn<RecordFn>();
    const { result } = renderHook(() => usePlacements([placement("p1", "c1", 1, 1)], mkArgs(onRecord)));
    act(() => {
      result.current.removePlacement("p1");
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0]).toMatchObject({ label: "Remove course at Mon · P1" });
  });

  it("bundle remove", async () => {
    const onRecord = vi.fn<RecordFn>();
    const initial = [placement("p1", "c1", 1, 1), placement("p2", "c2", 1, 1)];
    const { result } = renderHook(() => usePlacements(initial, mkArgs(onRecord)));
    act(() => {
      result.current.removeBundle(1, 1);
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0]).toMatchObject({ label: "Remove bundle at Mon · P1" });
  });

  it("setWeek", async () => {
    const onRecord = vi.fn<RecordFn>();
    const initial = [placement("p1", "c1", 1, 1, "a")];
    const { result } = renderHook(() => usePlacements(initial, mkArgs(onRecord, new Map([["c1", "biweekly"]]))));
    act(() => {
      result.current.setWeek("p1", "b");
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0]).toMatchObject({ label: "Flip week at Mon · P1" });
  });

  it("lift", async () => {
    const onRecord = vi.fn<RecordFn>();
    const { result } = renderHook(() => usePlacements([placement("p1", "c1", 1, 1)], mkArgs(onRecord)));
    act(() => {
      result.current.shelveBundle(1, 1);
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0]).toMatchObject({
      label: "Lift bundle at Mon · P1",
      scope: { cells: ["1:1"], cardSets: [[member("c1")]] },
    });
  });

  it("place-back", async () => {
    const onRecord = vi.fn<RecordFn>();
    const parked: ParkedBundle[] = [{ id: "s1", members: [member("c1")] }];
    const { result } = renderHook(() => usePlacements([], mkArgs(onRecord, new Map(), { initialParked: parked })));
    act(() => {
      result.current.placeBack("s1", { day: 1, period: 1 });
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0]).toMatchObject({ label: "Place bundle at Mon · P1" });
  });

  it("park-set", async () => {
    const onRecord = vi.fn<RecordFn>();
    const { result } = renderHook(() => usePlacements([], mkArgs(onRecord)));
    act(() => {
      result.current.parkMembers([member("c1")]);
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0]).toMatchObject({
      label: "Park bundle",
      scope: { cells: [], cardSets: [[member("c1")]] },
    });
  });

  it("discard", async () => {
    const onRecord = vi.fn<RecordFn>();
    const parked: ParkedBundle[] = [{ id: "s1", members: [member("c1")] }];
    const { result } = renderHook(() => usePlacements([], mkArgs(onRecord, new Map(), { initialParked: parked })));
    act(() => {
      result.current.removeParked("s1");
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0]).toMatchObject({ label: "Discard parked bundle" });
  });

  it("duplicate records once with the Duplicate label (not Place group)", async () => {
    const onRecord = vi.fn<RecordFn>();
    const a = course("A", "ta");
    const initial = [placement("p1", "A", 1, 1)];
    const { result } = renderHook(() =>
      usePlacements(initial, mkArgs(onRecord, new Map(), { catalog: [a], days: 2, periods: 2 })),
    );
    act(() => {
      result.current.duplicateBundle(1, 1);
    });
    await waitFor(() => {
      expect(onRecord).toHaveBeenCalledTimes(1);
    });
    expect(onRecord.mock.calls[0][0].label.startsWith("Duplicate")).toBe(true);
  });
});

describe("recorder bypass", () => {
  it("does NOT record on a failed (rolled-back) edit", async () => {
    placeMock.mockRejectedValueOnce(new Error("boom"));
    const onRecord = vi.fn<RecordFn>();
    const { result } = renderHook(() => usePlacements([], mkArgs(onRecord)));
    act(() => {
      result.current.addCourse("c1", { day: 1, period: 1 });
    });
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(onRecord).not.toHaveBeenCalled();
  });

  it("does NOT record from applyReconcile", async () => {
    const onRecord = vi.fn<RecordFn>();
    const { result } = renderHook(() => usePlacements([placement("p1", "c1", 1, 1)], mkArgs(onRecord)));
    await act(async () => {
      await result.current.applyReconcile({ placements: [], cards: [] }, { cells: ["1:1"], cardSets: [] });
    });
    expect(onRecord).not.toHaveBeenCalled();
  });
});

describe("applyReconcile", () => {
  it("drives a removal: empties the cell via remove_bundle_members", async () => {
    const { result } = renderHook(() => usePlacements([placement("p1", "c1", 1, 1)], mkArgs(undefined)));
    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.applyReconcile({ placements: [], cards: [] }, { cells: ["1:1"], cardSets: [] });
    });
    expect(outcome).toEqual({ ok: true });
    expect(removeMock).toHaveBeenCalled();
    expect(result.current.placements).toEqual([]);
  });

  it("drives a placement with id-remap: temp settles to the server row", async () => {
    const { result } = renderHook(() => usePlacements([], mkArgs(undefined)));
    await act(async () => {
      await result.current.applyReconcile(
        {
          placements: [{ id: "stale", courseId: "c1", day: 1, period: 1, week: "both", isOptional: false }],
          cards: [],
        },
        { cells: ["1:1"], cardSets: [] },
      );
    });
    expect(placeMock).toHaveBeenCalled();
    expect(result.current.placements).toHaveLength(1);
    expect(result.current.placements[0].id).toMatch(/^srv-/);
    expect(result.current.placements[0].pending).toBeUndefined();
  });

  it("drives a two-store lift: empties the cell and mints a settled card", async () => {
    const { result } = renderHook(() => usePlacements([placement("p1", "c1", 1, 1)], mkArgs(undefined)));
    await act(async () => {
      await result.current.applyReconcile(
        { placements: [], cards: [[member("c1")]] },
        { cells: ["1:1"], cardSets: [[member("c1")]] },
      );
    });
    expect(shelveMock).toHaveBeenCalledWith({ planId: PLAN_ID, cohort: COHORT, day: 1, period: 1 });
    expect(result.current.placements).toEqual([]);
    expect(result.current.parkedBundles).toEqual([{ id: "shelf-1-1", members: [member("c1")] }]);
  });

  it("rolls both stores back and surfaces the error on RPC failure", async () => {
    removeMock.mockRejectedValueOnce(new Error("nope"));
    const initial = [placement("p1", "c1", 1, 1)];
    const { result } = renderHook(() => usePlacements(initial, mkArgs(undefined)));
    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.applyReconcile({ placements: [], cards: [] }, { cells: ["1:1"], cardSets: [] });
    });
    expect(outcome).toEqual({ ok: false });
    expect(result.current.error).not.toBeNull();
    expect(result.current.placements).toEqual([placement("p1", "c1", 1, 1)]);
  });
});
