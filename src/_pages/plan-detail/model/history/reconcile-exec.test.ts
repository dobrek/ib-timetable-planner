import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlacementWeek } from "@/shared/config";
import type { ParkedMember } from "../placement/parked";
import type { PlannerPlacement } from "@/entities/timetable";
import type { ReconcilePlan } from "./history-entry";
import { executeReconcilePlan, type ReconcileDeps, type ReconcileRegion } from "./reconcile-exec";

const key = (courseId: string, day: number, period: number, week: PlacementWeek = "both", isOptional = false) => ({
  courseId,
  day,
  period,
  week,
  isOptional,
});
const member = (courseId: string, week: PlacementWeek = "both"): ParkedMember => ({
  courseId,
  week,
  isOptional: false,
});
const row = (courseId: string, day: number, period: number, week: PlacementWeek = "both"): PlannerPlacement => ({
  id: `srv-${courseId}-${day}-${period}`,
  courseId,
  day,
  period,
  week,
  isOptional: false,
  bundleId: `bundle-${day}-${period}`,
});

const plan = (over: Partial<ReconcilePlan>): ReconcilePlan => ({
  toRemove: [],
  toPlace: [],
  cardsToDelete: [],
  cardsToCreate: [],
  ...over,
});

let calls: string[];
let deps: ReconcileDeps;

beforeEach(() => {
  calls = [];
  deps = {
    moveMembers: vi.fn<ReconcileDeps["moveMembers"]>((_s, t, courseIds) => {
      calls.push("move");
      return Promise.resolve(courseIds.map((courseId) => row(courseId, t.day, t.period)));
    }),
    shelve: vi.fn<ReconcileDeps["shelve"]>(() => {
      calls.push("shelve");
      return Promise.resolve({ id: "card-srv" });
    }),
    unshelve: vi.fn<ReconcileDeps["unshelve"]>((_id, t) => {
      calls.push("unshelve");
      return Promise.resolve([row("A", t.day, t.period)]);
    }),
    setOptional: vi.fn<ReconcileDeps["setOptional"]>((placementId, isOptional) => {
      calls.push(`setOptional:${placementId}`);
      return Promise.resolve({ ...row("A", 1, 1), id: placementId, isOptional });
    }),
    place: vi.fn<ReconcileDeps["place"]>((spec) => {
      calls.push(`place:${spec.courseId}`);
      return Promise.resolve(row(spec.courseId, spec.day, spec.period, spec.week));
    }),
    removeMembers: vi.fn<ReconcileDeps["removeMembers"]>((cell) => {
      calls.push(`remove:${cell.day}:${cell.period}`);
      return Promise.resolve();
    }),
    createCard: vi.fn<ReconcileDeps["createCard"]>(() => {
      calls.push("createCard");
      return Promise.resolve({ id: "new-card" });
    }),
    deleteCard: vi.fn<ReconcileDeps["deleteCard"]>((id) => {
      calls.push(`deleteCard:${id}`);
      return Promise.resolve();
    }),
    resolveCardId: vi.fn<ReconcileDeps["resolveCardId"]>(() => "resolved-card-id"),
    resolvePlacementId: vi.fn<ReconcileDeps["resolvePlacementId"]>((k) => `live-${k.courseId}`),
  };
});

describe("executeReconcilePlan — atomic compound dispatch", () => {
  it("a pure relocation routes through one move_bundle_members", async () => {
    const result = await executeReconcilePlan(plan({ toRemove: [key("A", 2, 2)], toPlace: [key("A", 1, 1)] }), deps);
    expect(deps.moveMembers).toHaveBeenCalledWith({ day: 2, period: 2 }, { day: 1, period: 1 }, ["A"]);
    expect(deps.place).not.toHaveBeenCalled();
    expect(result.placed).toHaveLength(1);
  });

  it("a lift (board-removes + one card-create) routes through one shelve_bundle", async () => {
    const result = await executeReconcilePlan(
      plan({ toRemove: [key("A", 1, 1), key("B", 1, 1, "a")], cardsToCreate: [[member("A"), member("B", "a")]] }),
      deps,
    );
    expect(deps.shelve).toHaveBeenCalledWith({ day: 1, period: 1 });
    expect(deps.removeMembers).not.toHaveBeenCalled();
    expect(result.createdCards).toEqual([{ members: [member("A"), member("B", "a")], id: "card-srv" }]);
  });

  it("a place-back (one card-delete + board-places) routes through one unshelve_bundle", async () => {
    const result = await executeReconcilePlan(
      plan({ toPlace: [key("A", 1, 1)], cardsToDelete: [[member("A")]] }),
      deps,
    );
    expect(deps.resolveCardId).toHaveBeenCalledWith([member("A")]);
    expect(deps.unshelve).toHaveBeenCalledWith("resolved-card-id", { day: 1, period: 1 });
    expect(deps.place).not.toHaveBeenCalled();
    expect(result.placed).toHaveLength(1);
  });
});

describe("executeReconcilePlan — optional-flip dispatch", () => {
  it("a pure optional-flip routes through one in-place update, never remove+place", async () => {
    const result = await executeReconcilePlan(
      plan({ toRemove: [key("A", 1, 1)], toPlace: [key("A", 1, 1, "both", true)] }),
      deps,
    );
    expect(deps.resolvePlacementId).toHaveBeenCalledWith(key("A", 1, 1));
    expect(deps.setOptional).toHaveBeenCalledExactlyOnceWith("live-A", true);
    expect(deps.removeMembers).not.toHaveBeenCalled();
    expect(deps.place).not.toHaveBeenCalled();
    expect(result.placed).toHaveLength(1);
  });

  it("flips every member of a multi-course flip, each to its own target flag", async () => {
    await executeReconcilePlan(
      plan({
        toRemove: [key("A", 1, 1, "both", true), key("B", 1, 1)],
        toPlace: [key("A", 1, 1), key("B", 1, 1, "both", true)],
      }),
      deps,
    );
    expect(deps.setOptional).toHaveBeenCalledTimes(2);
    expect(deps.setOptional).toHaveBeenCalledWith("live-A", false);
    expect(deps.setOptional).toHaveBeenCalledWith("live-B", true);
    expect(deps.removeMembers).not.toHaveBeenCalled();
  });

  it("falls back to decomposed remove+place when a flipped row's id cannot be resolved", async () => {
    vi.mocked(deps.resolvePlacementId).mockReturnValue(undefined);
    await executeReconcilePlan(plan({ toRemove: [key("A", 1, 1)], toPlace: [key("A", 1, 1, "both", true)] }), deps);
    expect(deps.setOptional).not.toHaveBeenCalled();
    expect(deps.removeMembers).toHaveBeenCalledWith({ day: 1, period: 1 }, ["A"]);
    expect(deps.place).toHaveBeenCalledTimes(1);
  });

  it("a mixed plan (flip + relocation) is not a pure flip and decomposes", async () => {
    await executeReconcilePlan(
      plan({
        toRemove: [key("A", 1, 1), key("B", 1, 1)],
        toPlace: [key("A", 1, 1, "both", true), key("B", 2, 2)],
      }),
      deps,
    );
    expect(deps.setOptional).not.toHaveBeenCalled();
    expect(deps.place).toHaveBeenCalledTimes(2);
  });
});

describe("executeReconcilePlan — decomposed fallback", () => {
  it("merge-undo (re-places at two cells, member-sets differ) decomposes, not move", async () => {
    await executeReconcilePlan(plan({ toRemove: [key("B", 1, 1)], toPlace: [key("A", 3, 3), key("B", 3, 3)] }), deps);
    expect(deps.moveMembers).not.toHaveBeenCalled();
    expect(deps.removeMembers).toHaveBeenCalledWith({ day: 1, period: 1 }, ["B"]);
    expect(deps.place).toHaveBeenCalledTimes(2);
  });

  it("orders card-deletes → board-removes → board-places → card-creates", async () => {
    await executeReconcilePlan(
      plan({
        toRemove: [key("X", 1, 1)],
        toPlace: [key("Y", 2, 2)],
        cardsToDelete: [[member("Z")]],
        cardsToCreate: [[member("W")]],
      }),
      deps,
    );
    expect(calls).toEqual(["deleteCard:resolved-card-id", "remove:1:1", "place:Y", "createCard"]);
  });

  it("a plain add decomposes to place_course only", async () => {
    const result = await executeReconcilePlan(plan({ toPlace: [key("A", 1, 1)] }), deps);
    expect(deps.place).toHaveBeenCalledTimes(1);
    expect(deps.moveMembers).not.toHaveBeenCalled();
    expect(result.placed).toHaveLength(1);
  });

  it("a plain remove decomposes to remove_bundle_members only (grouped by cell)", async () => {
    await executeReconcilePlan(plan({ toRemove: [key("A", 1, 1), key("B", 1, 1)] }), deps);
    expect(deps.removeMembers).toHaveBeenCalledExactlyOnceWith({ day: 1, period: 1 }, ["A", "B"]);
  });

  it("a park (card-create only) decomposes to shelve_courses", async () => {
    const result = await executeReconcilePlan(plan({ cardsToCreate: [[member("A")]] }), deps);
    expect(deps.createCard).toHaveBeenCalledWith([member("A")]);
    expect(result.createdCards).toEqual([{ members: [member("A")], id: "new-card" }]);
  });

  it("a discard (card-delete only) decomposes to delete_shelf_bundle via resolveCardId", async () => {
    await executeReconcilePlan(plan({ cardsToDelete: [[member("A")]] }), deps);
    expect(deps.deleteCard).toHaveBeenCalledWith("resolved-card-id");
  });
});

describe("executeReconcilePlan — batch region recognizer (apply_generated_placements)", () => {
  const withRegion = (): { deps: ReconcileDeps; region: ReconcileRegion } => ({
    deps: {
      ...deps,
      applyGeneratedRegion: vi.fn<NonNullable<ReconcileDeps["applyGeneratedRegion"]>>((_cells, placements) => {
        calls.push("region");
        return Promise.resolve(placements.map((spec) => row(spec.courseId, spec.day, spec.period, spec.week)));
      }),
    },
    region: {
      cells: [
        { day: 1, period: 1 },
        { day: 2, period: 3 },
      ],
      placements: [key("pin", 1, 1), key("gen", 2, 3)],
    },
  });

  it("a multi-cell board-only plan dispatches to ONE region replace (undo of a generated batch)", async () => {
    const { deps: batchDeps, region } = withRegion();
    const result = await executeReconcilePlan(
      plan({ toRemove: [key("gen-1", 1, 1), key("gen-2", 2, 3)] }),
      batchDeps,
      region,
    );
    expect(batchDeps.applyGeneratedRegion).toHaveBeenCalledExactlyOnceWith(region.cells, region.placements);
    expect(batchDeps.removeMembers).not.toHaveBeenCalled();
    expect(batchDeps.place).not.toHaveBeenCalled();
    expect(result.placed).toHaveLength(2);
  });

  it("a single-cell plan keeps its existing path even with a region supplied", async () => {
    const { deps: batchDeps } = withRegion();
    await executeReconcilePlan(plan({ toRemove: [key("gen-1", 1, 1), key("gen-2", 1, 1)] }), batchDeps, {
      cells: [{ day: 1, period: 1 }],
      placements: [],
    });
    expect(batchDeps.applyGeneratedRegion).not.toHaveBeenCalled();
    expect(batchDeps.removeMembers).toHaveBeenCalledExactlyOnceWith({ day: 1, period: 1 }, ["gen-1", "gen-2"]);
  });

  it("a plan with card ops never takes the batch path", async () => {
    const { deps: batchDeps, region } = withRegion();
    await executeReconcilePlan(
      plan({ toRemove: [key("gen-1", 1, 1), key("gen-2", 2, 3)], cardsToCreate: [[member("gen-1")]] }),
      batchDeps,
      region,
    );
    expect(batchDeps.applyGeneratedRegion).not.toHaveBeenCalled();
    expect(batchDeps.removeMembers).toHaveBeenCalledTimes(2);
  });

  it("without a region the multi-cell plan still decomposes (existing injectors unchanged)", async () => {
    await executeReconcilePlan(plan({ toRemove: [key("gen-1", 1, 1), key("gen-2", 2, 3)] }), deps);
    expect(deps.removeMembers).toHaveBeenCalledTimes(2);
  });

  it("the atomic relocation recognizer wins over the batch path", async () => {
    const { deps: batchDeps, region } = withRegion();
    await executeReconcilePlan(plan({ toRemove: [key("A", 2, 2)], toPlace: [key("A", 1, 1)] }), batchDeps, region);
    expect(batchDeps.moveMembers).toHaveBeenCalledOnce();
    expect(batchDeps.applyGeneratedRegion).not.toHaveBeenCalled();
  });
});
