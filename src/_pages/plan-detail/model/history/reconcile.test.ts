import { describe, expect, it } from "vitest";
import type { PlacementWeek } from "@/shared/config";
import type { ParkedMember } from "../placement/parked";
import type { PlannerPlacement } from "@/entities/timetable";
import type { AffectedSlice } from "./history-entry";
import { diffReconcile } from "./reconcile";

const pp = (courseId: string, day: number, period: number, week: PlacementWeek = "both"): PlannerPlacement => ({
  id: `${courseId}-${day}-${period}-${week}`,
  courseId,
  day,
  period,
  week,
  isOptional: false,
  bundleId: `bundle-${day}-${period}`,
});

const member = (courseId: string, week: PlacementWeek = "both"): ParkedMember => ({
  courseId,
  week,
  isOptional: false,
});

const slice = (placements: PlannerPlacement[], cards: ParkedMember[][] = []): AffectedSlice => ({ placements, cards });

const keyOf = ({
  courseId,
  day,
  period,
  week,
  isOptional,
}: {
  courseId: string;
  day: number;
  period: number;
  week: string;
  isOptional: boolean;
}) => `${courseId}|${day}|${period}|${week}|${isOptional}`;

describe("diffReconcile — board", () => {
  it("add: target gains a placement → toPlace only", () => {
    const plan = diffReconcile(slice([]), slice([pp("A", 1, 1)]));
    expect(plan.toPlace).toEqual([{ courseId: "A", day: 1, period: 1, week: "both", isOptional: false }]);
    expect(plan.toRemove).toEqual([]);
    expect(plan.cardsToCreate).toEqual([]);
    expect(plan.cardsToDelete).toEqual([]);
  });

  it("remove: target loses a placement → toRemove only", () => {
    const plan = diffReconcile(slice([pp("A", 1, 1)]), slice([]));
    expect(plan.toRemove).toEqual([{ courseId: "A", day: 1, period: 1, week: "both", isOptional: false }]);
    expect(plan.toPlace).toEqual([]);
  });

  it("move: relocate one course → remove@source + place@target", () => {
    const plan = diffReconcile(slice([pp("A", 1, 1)]), slice([pp("A", 2, 3)]));
    expect(plan.toRemove).toEqual([{ courseId: "A", day: 1, period: 1, week: "both", isOptional: false }]);
    expect(plan.toPlace).toEqual([{ courseId: "A", day: 2, period: 3, week: "both", isOptional: false }]);
  });

  it("week-flip: same cell, week a → b → remove@a + place@b", () => {
    const plan = diffReconcile(slice([pp("A", 1, 1, "a")]), slice([pp("A", 1, 1, "b")]));
    expect(plan.toRemove).toEqual([{ courseId: "A", day: 1, period: 1, week: "a", isOptional: false }]);
    expect(plan.toPlace).toEqual([{ courseId: "A", day: 1, period: 1, week: "b", isOptional: false }]);
  });

  it("optional-flip: same cell, flag flips → remove@false + place@true (never an empty plan)", () => {
    // The flag is part of the business key: without it this diff would be empty and undoing a
    // mark/accept would silently no-op (a dead history entry).
    const plan = diffReconcile(slice([pp("A", 1, 1)]), slice([{ ...pp("A", 1, 1), isOptional: true }]));
    expect(plan.toRemove).toEqual([{ courseId: "A", day: 1, period: 1, week: "both", isOptional: false }]);
    expect(plan.toPlace).toEqual([{ courseId: "A", day: 1, period: 1, week: "both", isOptional: true }]);
  });

  it("merge-undo: restores placements at both cells (source split back out)", () => {
    // current = merged onto Mon·P1; target (before) = A at Mon·P1 and B at Tue·P3.
    const current = slice([pp("A", 1, 1), pp("B", 1, 1)]);
    const target = slice([pp("A", 1, 1), pp("B", 2, 3)]);
    const plan = diffReconcile(current, target);
    expect(plan.toRemove).toEqual([{ courseId: "B", day: 1, period: 1, week: "both", isOptional: false }]);
    expect(plan.toPlace).toEqual([{ courseId: "B", day: 2, period: 3, week: "both", isOptional: false }]);
  });

  it("no-op: identical slices → empty plan", () => {
    const current = slice([pp("A", 1, 1), pp("B", 2, 2, "a")]);
    const plan = diffReconcile(current, slice([pp("A", 1, 1), pp("B", 2, 2, "a")]));
    expect(plan).toEqual({ toRemove: [], toPlace: [], cardsToDelete: [], cardsToCreate: [] });
  });

  it("removes are computed independently of places (a move yields exactly one of each)", () => {
    const plan = diffReconcile(slice([pp("A", 1, 1)]), slice([pp("A", 2, 2)]));
    expect(plan.toRemove).toHaveLength(1);
    expect(plan.toPlace).toHaveLength(1);
    expect(keyOf(plan.toRemove[0])).toBe("A|1|1|both|false"); // the source row, the one a re-place must not collide with
    expect(keyOf(plan.toPlace[0])).toBe("A|2|2|both|false");
  });
});

describe("diffReconcile — shelf", () => {
  it("create: target gains a card → cardsToCreate", () => {
    const plan = diffReconcile(slice([]), slice([], [[member("A"), member("B", "a")]]));
    expect(plan.cardsToCreate).toEqual([[member("A"), member("B", "a")]]);
    expect(plan.cardsToDelete).toEqual([]);
  });

  it("delete: target loses a card → cardsToDelete", () => {
    const plan = diffReconcile(slice([], [[member("A")]]), slice([]));
    expect(plan.cardsToDelete).toEqual([[member("A")]]);
    expect(plan.cardsToCreate).toEqual([]);
  });

  it("identical member-set: no delete/create (multiset match, order-free)", () => {
    const current = slice([], [[member("A"), member("B", "b")]]);
    const target = slice([], [[member("B", "b"), member("A")]]);
    const plan = diffReconcile(current, target);
    expect(plan.cardsToDelete).toEqual([]);
    expect(plan.cardsToCreate).toEqual([]);
  });

  it("multiset count: two identical current cards, one target → exactly one delete", () => {
    const current = slice([], [[member("A")], [member("A")]]);
    const target = slice([], [[member("A")]]);
    const plan = diffReconcile(current, target);
    expect(plan.cardsToDelete).toEqual([[member("A")]]);
    expect(plan.cardsToCreate).toEqual([]);
  });
});

describe("diffReconcile — combined (lift-undo)", () => {
  it("undo of a lift: place the source occupants back AND delete the parked card", () => {
    // current (post-lift) = empty source cell + a card; target (before) = the occupants, no card.
    const current = slice([], [[member("A"), member("B", "a")]]);
    const target = slice([pp("A", 1, 1), pp("B", 1, 1, "a")]);
    const plan = diffReconcile(current, target);
    expect(plan.toPlace).toEqual([
      { courseId: "A", day: 1, period: 1, week: "both", isOptional: false },
      { courseId: "B", day: 1, period: 1, week: "a", isOptional: false },
    ]);
    expect(plan.toRemove).toEqual([]);
    expect(plan.cardsToDelete).toEqual([[member("A"), member("B", "a")]]);
    expect(plan.cardsToCreate).toEqual([]);
  });
});
