import { describe, expect, it } from "vitest";
import type { PlacementWeek } from "@/shared/config";
import { cellKey, type LocalPlacement } from "@/entities/timetable";
import type { LocalParkedBundle, ParkedMember } from "../placement/parked";
import { memberSetKey, placementBusinessKey, sliceAt } from "./affected-slice";
import type { AffectedScope } from "./history-entry";

const lp = (
  id: string,
  courseId: string,
  day: number,
  period: number,
  week: PlacementWeek = "both",
  pending?: boolean,
): LocalPlacement => ({
  id,
  courseId,
  day,
  period,
  week,
  isOptional: false,
  bundleId: `bundle-${day}-${period}`,
  ...(pending ? { pending } : {}),
});

const member = (courseId: string, week: PlacementWeek = "both"): ParkedMember => ({
  courseId,
  week,
  isOptional: false,
});

const card = (id: string, members: ParkedMember[]): LocalParkedBundle => ({ id, members });

const scope = (cells: string[], cardSets: ParkedMember[][] = []): AffectedScope => ({ cells, cardSets });

describe("sliceAt — board", () => {
  it("returns only the placements whose cell is in scope (cell union)", () => {
    const placements = [lp("p1", "A", 1, 1), lp("p2", "B", 1, 1), lp("p3", "C", 2, 3), lp("p4", "D", 4, 4)];
    const result = sliceAt(placements, [], scope([cellKey(1, 1), cellKey(2, 3)]));
    expect(result.placements.map((p) => p.courseId).sort()).toEqual(["A", "B", "C"]);
  });

  it("returns an empty placement list for a scope of empty cells", () => {
    const result = sliceAt([lp("p1", "A", 1, 1)], [], scope([cellKey(5, 5)]));
    expect(result.placements).toEqual([]);
  });

  it("strips the local-only pending flag to a clean PlannerPlacement", () => {
    const result = sliceAt([lp("p1", "A", 1, 1, "a", true)], [], scope([cellKey(1, 1)]));
    expect(result.placements).toEqual([
      { id: "p1", courseId: "A", day: 1, period: 1, week: "a", isOptional: false, bundleId: "bundle-1-1" },
    ]);
    expect("pending" in result.placements[0]).toBe(false);
  });
});

describe("sliceAt — shelf", () => {
  it("returns the cards whose member-set matches a scoped set (order-free)", () => {
    const cards = [card("s1", [member("A"), member("B", "a")]), card("s2", [member("Z")])];
    const result = sliceAt([], cards, scope([], [[member("B", "a"), member("A")]]));
    expect(result.cards).toEqual([[member("A"), member("B", "a")]]);
  });

  it("excludes cards whose member-set is not scoped", () => {
    const cards = [card("s1", [member("A")]), card("s2", [member("Z")])];
    const result = sliceAt([], cards, scope([], [[member("A")]]));
    expect(result.cards).toEqual([[member("A")]]);
  });

  it("respects multiset count: one scoped set matches only one of two identical cards", () => {
    const cards = [card("s1", [member("A")]), card("s2", [member("A")])];
    const result = sliceAt([], cards, scope([], [[member("A")]]));
    expect(result.cards).toEqual([[member("A")]]);
  });

  it("matches both when the scope lists the set twice", () => {
    const cards = [card("s1", [member("A")]), card("s2", [member("A")])];
    const result = sliceAt([], cards, scope([], [[member("A")], [member("A")]]));
    expect(result.cards).toEqual([[member("A")], [member("A")]]);
  });
});

describe("business keys — the optional axis", () => {
  it("placementBusinessKey separates two rows differing only in isOptional", () => {
    const key = { courseId: "A", day: 1, period: 1, week: "both" as const };
    expect(placementBusinessKey({ ...key, isOptional: false })).not.toBe(
      placementBusinessKey({ ...key, isOptional: true }),
    );
  });

  it("memberSetKey separates two member-sets differing only in isOptional", () => {
    expect(memberSetKey([member("A")])).not.toBe(memberSetKey([{ ...member("A"), isOptional: true }]));
  });

  it("sliceAt does not match a card whose member-set differs only in the flag", () => {
    const cards = [card("s1", [member("A")])];
    const result = sliceAt([], cards, scope([], [[{ ...member("A"), isOptional: true }]]));
    expect(result.cards).toEqual([]);
  });
});

describe("sliceAt — combined", () => {
  it("reads both stores at once (lift scope: source cell + the card's member-set)", () => {
    const placements = [lp("p1", "A", 1, 1)];
    const cards = [card("s1", [member("X"), member("Y", "b")])];
    const result = sliceAt(placements, cards, scope([cellKey(1, 1)], [[member("X"), member("Y", "b")]]));
    expect(result.placements).toHaveLength(1);
    expect(result.cards).toEqual([[member("X"), member("Y", "b")]]);
  });
});
