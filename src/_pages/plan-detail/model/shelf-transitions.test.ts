import { describe, expect, it } from "vitest";
import type { LocalParkedBundle, ParkedMember } from "./parked";
import type { LocalPlacement } from "./placement";
import {
  isCourseSetParked,
  membersAtCell,
  parkAddOptimistic,
  parkReconcile,
  parkRollback,
  unparkOptimistic,
  unparkRollback,
} from "./shelf-transitions";

const member = (courseId: string, week: ParkedMember["week"] = "both"): ParkedMember => ({ courseId, week });

const card = (id: string, members: ParkedMember[], pending?: boolean): LocalParkedBundle => ({
  id,
  members,
  ...(pending ? { pending } : {}),
});

const p = (
  id: string,
  courseId: string,
  day: number,
  period: number,
  week: LocalPlacement["week"] = "both",
): LocalPlacement => ({ id, courseId, day, period, week });

describe("park transitions", () => {
  it("parkAddOptimistic appends a pending card carrying the members", () => {
    const next = parkAddOptimistic([], "tmp-1", [member("A"), member("B", "a")]);
    expect(next).toEqual([{ id: "tmp-1", members: [member("A"), member("B", "a")], pending: true }]);
  });

  it("parkAddOptimistic preserves existing cards (immutable append)", () => {
    const prev = [card("s1", [member("X")])];
    const next = parkAddOptimistic(prev, "tmp-1", [member("A")]);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(prev[0]); // untouched
    expect(prev).toHaveLength(1); // input not mutated
  });

  it("parkReconcile swaps the temp id for the server id and clears pending", () => {
    const prev = [card("s1", [member("X")]), card("tmp-1", [member("A"), member("B")], true)];
    const next = parkReconcile(prev, "tmp-1", "srv-9");
    expect(next[1]).toEqual({ id: "srv-9", members: [member("A"), member("B")] });
    expect(next[1].pending).toBeUndefined();
    expect(next[0]).toBe(prev[0]); // other cards untouched
  });

  it("parkRollback drops the pending card by temp id", () => {
    const prev = [card("s1", [member("X")]), card("tmp-1", [member("A")], true)];
    const next = parkRollback(prev, "tmp-1");
    expect(next).toEqual([card("s1", [member("X")])]);
  });
});

describe("unpark transitions", () => {
  it("unparkOptimistic removes the card being placed back / discarded", () => {
    const prev = [card("s1", [member("X")]), card("s2", [member("A")])];
    expect(unparkOptimistic(prev, "s1")).toEqual([card("s2", [member("A")])]);
  });

  it("unparkOptimistic is a no-op for an unknown id", () => {
    const prev = [card("s1", [member("X")])];
    expect(unparkOptimistic(prev, "missing")).toEqual(prev);
  });

  it("unparkRollback restores the removed card", () => {
    const removed = card("s1", [member("X"), member("Y", "b")]);
    expect(unparkRollback([card("s2", [member("A")])], removed)).toEqual([card("s2", [member("A")]), removed]);
  });
});

describe("isCourseSetParked", () => {
  const prev = [card("s1", [member("A"), member("B")]), card("s2", [member("C")])];

  it("matches an existing course-set regardless of order or week", () => {
    expect(isCourseSetParked(prev, ["B", "A"])).toBe(true); // order-independent
    expect(isCourseSetParked(prev, ["C"])).toBe(true);
  });

  it("does not match a different set (superset, subset, or disjoint)", () => {
    expect(isCourseSetParked(prev, ["A"])).toBe(false); // subset of s1
    expect(isCourseSetParked(prev, ["A", "B", "C"])).toBe(false); // superset
    expect(isCourseSetParked(prev, ["D"])).toBe(false); // disjoint
    expect(isCourseSetParked([], ["A"])).toBe(false); // empty shelf
  });
});

describe("membersAtCell", () => {
  it("reads the {courseId, week} set at the cell, capturing A/B weeks", () => {
    const placements = [p("p1", "A", 1, 1, "a"), p("p2", "B", 1, 1, "b"), p("p3", "C", 2, 2)];
    expect(membersAtCell(placements, 1, 1)).toEqual([member("A", "a"), member("B", "b")]);
  });

  it("returns an empty set for an empty cell", () => {
    expect(membersAtCell([p("p1", "A", 1, 1)], 3, 3)).toEqual([]);
  });
});
