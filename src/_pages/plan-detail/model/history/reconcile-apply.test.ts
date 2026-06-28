import { describe, expect, it } from "vitest";
import type { PlacementWeek } from "@/shared/config";
import type { LocalParkedBundle, ParkedMember } from "../placement/parked";
import type { LocalPlacement } from "../placement/placement";
import type { PlacementKey } from "./history-entry";
import {
  reconcileCardsOptimistic,
  reconcilePlacementsOptimistic,
  rollbackReconcileCards,
  rollbackReconcilePlacements,
  settleReconcileCards,
  settleReconcilePlacements,
  type CardEntry,
  type PlaceEntry,
} from "./reconcile-apply";

const lp = (
  id: string,
  courseId: string,
  day: number,
  period: number,
  week: PlacementWeek = "both",
): LocalPlacement => ({
  id,
  courseId,
  day,
  period,
  week,
  bundleId: `bundle-${day}-${period}`,
});
const key = (courseId: string, day: number, period: number, week: PlacementWeek = "both"): PlacementKey => ({
  courseId,
  day,
  period,
  week,
});
const member = (courseId: string, week: PlacementWeek = "both"): ParkedMember => ({ courseId, week });
const card = (id: string, members: ParkedMember[]): LocalParkedBundle => ({ id, members });

describe("reconcilePlacementsOptimistic", () => {
  it("drops the keyed removes and appends the places as pending temps in one pass", () => {
    const prev = [lp("p1", "A", 1, 1), lp("p2", "B", 2, 2)];
    const placeEntries: PlaceEntry[] = [{ tempId: "t1", spec: key("A", 3, 3) }];
    const next = reconcilePlacementsOptimistic(prev, [key("A", 1, 1)], placeEntries);
    expect(next).toEqual([
      lp("p2", "B", 2, 2),
      { id: "t1", courseId: "A", day: 3, period: 3, week: "both", pending: true },
    ]);
    expect(prev).toHaveLength(2); // input not mutated
  });
});

describe("reconcileCardsOptimistic", () => {
  it("drops the deleted cards by id and appends the creates as pending temps", () => {
    const prev = [card("s1", [member("A")]), card("s2", [member("B")])];
    const cardEntries: CardEntry[] = [{ tempId: "tc1", members: [member("C")] }];
    const next = reconcileCardsOptimistic(prev, ["s1"], cardEntries);
    expect(next).toEqual([card("s2", [member("B")]), { id: "tc1", members: [member("C")], pending: true }]);
  });
});

describe("settleReconcilePlacements", () => {
  it("swaps placed temps for their server rows by course id", () => {
    const prev = [{ id: "t1", courseId: "A", day: 3, period: 3, week: "both" as const, pending: true }];
    const placeEntries: PlaceEntry[] = [{ tempId: "t1", spec: key("A", 3, 3) }];
    const next = settleReconcilePlacements(prev, placeEntries, [lp("srv-A", "A", 3, 3)]);
    expect(next).toEqual([lp("srv-A", "A", 3, 3)]);
  });

  it("drops a temp the RPC did not return a row for", () => {
    const prev = [{ id: "t1", courseId: "A", day: 3, period: 3, week: "both" as const, pending: true }];
    const placeEntries: PlaceEntry[] = [{ tempId: "t1", spec: key("A", 3, 3) }];
    expect(settleReconcilePlacements(prev, placeEntries, [])).toEqual([]);
  });
});

describe("settleReconcileCards", () => {
  it("swaps created temps for their server ids by member-set", () => {
    const prev = [{ id: "tc1", members: [member("C")], pending: true }];
    const cardEntries: CardEntry[] = [{ tempId: "tc1", members: [member("C")] }];
    const next = settleReconcileCards(prev, cardEntries, [{ members: [member("C")], id: "srv-card" }]);
    expect(next).toEqual([{ id: "srv-card", members: [member("C")] }]);
  });
});

describe("rollback", () => {
  it("rollbackReconcilePlacements drops the optimistic places and restores the removed rows", () => {
    const prev = [
      lp("p2", "B", 2, 2),
      { id: "t1", courseId: "A", day: 3, period: 3, week: "both" as const, pending: true },
    ];
    const placeEntries: PlaceEntry[] = [{ tempId: "t1", spec: key("A", 3, 3) }];
    const next = rollbackReconcilePlacements(prev, placeEntries, [lp("p1", "A", 1, 1)]);
    expect(next).toEqual([lp("p2", "B", 2, 2), lp("p1", "A", 1, 1)]);
  });

  it("rollbackReconcileCards drops the optimistic creates and restores the deleted cards", () => {
    const prev = [card("s2", [member("B")]), { id: "tc1", members: [member("C")], pending: true }];
    const cardEntries: CardEntry[] = [{ tempId: "tc1", members: [member("C")] }];
    const next = rollbackReconcileCards(prev, cardEntries, [card("s1", [member("A")])]);
    expect(next).toEqual([card("s2", [member("B")]), card("s1", [member("A")])]);
  });
});
