import { describe, expect, it, vi } from "vitest";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { PlacementWeek } from "@/shared/config";
import { placement } from "../__fixtures__/builders";
import type { LocalParkedBundle, ParkedMember } from "./parked";
import type { LocalPlacement, PlannerPlacement } from "./placement";
import { createShelfWrites } from "./shelf-writes";
import type { WriteContext } from "./write-context";

// Drive the shelf factory against a FAKE WriteContext — stub stores that apply functional updaters,
// stub `rpcs` resolving/rejecting, spies on `recordEdit`/`setError`. No rendering, mirroring the
// framework-free `shelf-transitions.test.ts` style. The public handlers are fire-and-forget
// (`void persist*`), so each test flushes the microtask queue after dispatching.

const member = (courseId: string, week: PlacementWeek = "both"): ParkedMember => ({ courseId, week });

const card = (id: string, members: ParkedMember[], pending?: boolean): LocalParkedBundle => ({
  id,
  members,
  ...(pending ? { pending } : {}),
});

const serverRow = (id: string, courseId: string, day: number, period: number): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
  week: "both",
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

function makeHarness(opts: { placements?: LocalPlacement[]; parked?: LocalParkedBundle[] } = {}) {
  const placements = makeStore<LocalPlacement>(opts.placements ?? []);
  const parked = makeStore<LocalParkedBundle>(opts.parked ?? []);
  const recordEdit = vi.fn();
  const setError = vi.fn();
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

  return { writes: createShelfWrites(ctx), placements, parked, recordEdit, setError, rpcs };
}

describe("createShelfWrites — shelveBundle (park, two-store)", () => {
  const twoAtCell = [placement("p1", "c1", 1, 1), placement("p2", "c2", 1, 1)];

  it("optimistically clears the cell + adds a pending card, then reconciles the card id", async () => {
    const h = makeHarness({ placements: twoAtCell });
    h.rpcs.shelveBundle.mockResolvedValueOnce({ id: "shelf-9", members: [] });

    h.writes.shelveBundle(1, 1);

    // Two-store optimistic: placements gone, a pending card carrying the members.
    expect(h.placements.ref.current).toHaveLength(0);
    expect(h.parked.ref.current).toHaveLength(1);
    expect(h.parked.ref.current[0].pending).toBe(true);
    expect(h.parked.ref.current[0].members.map((m) => m.courseId).sort()).toEqual(["c1", "c2"]);

    await flush();

    expect(h.parked.ref.current[0].id).toBe("shelf-9");
    expect(h.parked.ref.current[0].pending).toBeUndefined();
    expect(h.recordEdit).toHaveBeenCalledWith("lift", expect.anything(), expect.anything(), { day: 1, period: 1 });
    expect(h.setError).toHaveBeenLastCalledWith(null);
  });

  it("rolls BOTH stores back when the shelve RPC rejects", async () => {
    const h = makeHarness({ placements: twoAtCell });
    h.rpcs.shelveBundle.mockRejectedValueOnce(new Error("shelve boom"));

    h.writes.shelveBundle(1, 1);
    await flush();

    expect(h.placements.ref.current).toHaveLength(2); // restored
    expect(h.parked.ref.current).toHaveLength(0); // pending card dropped
    expect(h.setError).toHaveBeenLastCalledWith({ kind: "message", message: "shelve boom" });
  });

  it("is a no-op on an empty cell", () => {
    const h = makeHarness({ placements: [] });
    h.writes.shelveBundle(3, 3);
    expect(h.rpcs.shelveBundle).not.toHaveBeenCalled();
    expect(h.parked.ref.current).toHaveLength(0);
  });
});

describe("createShelfWrites — placeBack (two-store)", () => {
  const parkedCard = card("s1", [member("c1"), member("c2")]);

  it("removes the card and settles temp placements to server rows by course", async () => {
    const h = makeHarness({ parked: [parkedCard] });
    h.rpcs.unshelveBundle.mockResolvedValueOnce([serverRow("srv-1", "c1", 2, 2), serverRow("srv-2", "c2", 2, 2)]);

    h.writes.placeBack("s1", { day: 2, period: 2 });

    // Optimistic: card gone, two pending placements at the target.
    expect(h.parked.ref.current).toHaveLength(0);
    expect(h.placements.ref.current).toHaveLength(2);
    expect(h.placements.ref.current.every((p) => p.day === 2 && p.period === 2 && p.pending)).toBe(true);

    await flush();

    expect(h.placements.ref.current.map((p) => p.id).sort()).toEqual(["srv-1", "srv-2"]);
    expect(h.placements.ref.current.every((p) => !p.pending)).toBe(true);
    expect(h.recordEdit).toHaveBeenCalledWith("placeBack", expect.anything(), expect.anything(), { day: 2, period: 2 });
    expect(h.setError).toHaveBeenLastCalledWith(null);
  });

  it("drops a member already present at an occupied target (merge, no duplicate)", async () => {
    const h = makeHarness({ placements: [placement("existing", "c2", 2, 2)], parked: [parkedCard] });
    h.rpcs.unshelveBundle.mockResolvedValueOnce([serverRow("srv-1", "c1", 2, 2), serverRow("existing", "c2", 2, 2)]);

    h.writes.placeBack("s1", { day: 2, period: 2 });

    // Only c1 added optimistically; c2's twin is untouched → exactly one c2 row.
    expect(h.placements.ref.current.filter((p) => p.courseId === "c2")).toHaveLength(1);

    await flush();

    expect(h.placements.ref.current.filter((p) => p.courseId === "c2")).toHaveLength(1);
    expect(h.placements.ref.current).toHaveLength(2);
    expect(h.setError).toHaveBeenLastCalledWith(null);
  });

  it("rolls BOTH stores back when the unshelve RPC rejects", async () => {
    const h = makeHarness({ parked: [parkedCard] });
    h.rpcs.unshelveBundle.mockRejectedValueOnce(new Error("unshelve boom"));

    h.writes.placeBack("s1", { day: 2, period: 2 });
    await flush();

    expect(h.parked.ref.current).toHaveLength(1); // card restored
    expect(h.parked.ref.current[0].id).toBe("s1");
    expect(h.placements.ref.current).toHaveLength(0); // temp placements dropped
    expect(h.setError).toHaveBeenLastCalledWith({ kind: "message", message: "unshelve boom" });
  });

  it("is a no-op for an unknown / pending card", () => {
    const h = makeHarness({ parked: [card("tmp", [member("c1")], true)] });
    h.writes.placeBack("tmp", { day: 2, period: 2 });
    expect(h.rpcs.unshelveBundle).not.toHaveBeenCalled();
    expect(h.parked.ref.current).toHaveLength(1);
  });
});

describe("createShelfWrites — parkMembers (shelf-only)", () => {
  const members = [member("c1", "a"), member("c2", "b")];

  it("adds a pending card, reconciles its id, never touches the board", async () => {
    const h = makeHarness();
    h.rpcs.shelveCourses.mockResolvedValueOnce({ id: "shelf-7", members });

    h.writes.parkMembers(members);

    expect(h.parked.ref.current).toHaveLength(1);
    expect(h.parked.ref.current[0].pending).toBe(true);
    expect(h.placements.ref.current).toHaveLength(0);

    await flush();

    expect(h.parked.ref.current[0].id).toBe("shelf-7");
    expect(h.parked.ref.current[0].pending).toBeUndefined();
    expect(h.recordEdit).toHaveBeenCalledWith("parkMembers", expect.anything(), expect.anything());
    expect(h.setError).toHaveBeenLastCalledWith(null);
  });

  it("drops the pending card and sets an error when the RPC rejects", async () => {
    const h = makeHarness();
    h.rpcs.shelveCourses.mockRejectedValueOnce(new Error("park boom"));

    h.writes.parkMembers(members);
    await flush();

    expect(h.parked.ref.current).toHaveLength(0);
    expect(h.setError).toHaveBeenLastCalledWith({ kind: "message", message: "park boom" });
  });

  it("is a no-op for an empty member-set", () => {
    const h = makeHarness();
    h.writes.parkMembers([]);
    expect(h.rpcs.shelveCourses).not.toHaveBeenCalled();
    expect(h.parked.ref.current).toHaveLength(0);
  });
});

describe("createShelfWrites — removeParked (discard, shelf-only)", () => {
  const parkedCard = card("s1", [member("c1")]);

  it("discards the card optimistically and calls deleteShelfBundle", async () => {
    const h = makeHarness({ parked: [parkedCard] });
    h.rpcs.deleteShelfBundle.mockResolvedValueOnce(undefined);

    h.writes.removeParked("s1");

    expect(h.parked.ref.current).toHaveLength(0); // optimistic

    await flush();

    expect(h.rpcs.deleteShelfBundle).toHaveBeenCalledWith({ shelfBundleId: "s1" });
    expect(h.recordEdit).toHaveBeenCalledWith("discard", expect.anything(), expect.anything());
    expect(h.setError).toHaveBeenLastCalledWith(null);
  });

  it("restores the card when the delete RPC rejects", async () => {
    const h = makeHarness({ parked: [parkedCard] });
    h.rpcs.deleteShelfBundle.mockRejectedValueOnce(new Error("discard boom"));

    h.writes.removeParked("s1");
    await flush();

    expect(h.parked.ref.current).toHaveLength(1);
    expect(h.parked.ref.current[0].id).toBe("s1");
    expect(h.setError).toHaveBeenLastCalledWith({ kind: "message", message: "discard boom" });
  });

  it("is a no-op for a pending card", () => {
    const h = makeHarness({ parked: [card("tmp", [member("c1")], true)] });
    h.writes.removeParked("tmp");
    expect(h.rpcs.deleteShelfBundle).not.toHaveBeenCalled();
    expect(h.parked.ref.current).toHaveLength(1);
  });
});
