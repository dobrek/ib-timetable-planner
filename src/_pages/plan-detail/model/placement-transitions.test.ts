import { describe, expect, it } from "vitest";
import type { CellData } from "./drag";
import type { LocalPlacement, PlannerPlacement } from "./placement";
import {
  addManyOptimistic,
  addOptimistic,
  addReconcile,
  addRollback,
  canAdd,
  eligibleMembers,
  groupFailureMessage,
  moveIntent,
  moveOptimistic,
  moveReconcile,
  moveRollback,
  placementErrorMessage,
  removeOptimistic,
  removeRollback,
  removeTarget,
  settleMany,
} from "./placement-transitions";

const p = (id: string, courseId: string, day: number, period: number, pending?: boolean): LocalPlacement => ({
  id,
  courseId,
  day,
  period,
  ...(pending ? { pending } : {}),
});

const cell = (day: number, period: number): CellData => ({ day, period });

const server = (id: string, courseId: string, day: number, period: number): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
});

describe("add transitions", () => {
  it("canAdd returns true for an empty cell", () => {
    expect(canAdd([], "A", cell(1, 1))).toBe(true);
  });

  it("canAdd returns true when a different course occupies the cell", () => {
    expect(canAdd([p("p1", "B", 1, 1)], "A", cell(1, 1))).toBe(true);
  });

  it("canAdd returns false when the same course already occupies the cell", () => {
    expect(canAdd([p("p1", "A", 1, 1)], "A", cell(1, 1))).toBe(false);
  });

  it("addOptimistic appends a new placement with pending true", () => {
    const prev = [p("p1", "B", 2, 2)];
    expect(addOptimistic(prev, "temp", "A", cell(1, 1))).toEqual([
      p("p1", "B", 2, 2),
      { id: "temp", courseId: "A", day: 1, period: 1, pending: true },
    ]);
  });

  it("addOptimistic does not mutate the input array", () => {
    const prev = [p("p1", "B", 2, 2)];
    const snapshot = [...prev];
    addOptimistic(prev, "temp", "A", cell(1, 1));
    expect(prev).toEqual(snapshot);
  });

  it("addReconcile replaces the temp-id row with the server row", () => {
    const prev = [p("p1", "B", 2, 2), { id: "temp", courseId: "A", day: 1, period: 1, pending: true }];
    expect(addReconcile(prev, "temp", server("real", "A", 1, 1))).toEqual([
      p("p1", "B", 2, 2),
      server("real", "A", 1, 1),
    ]);
  });

  it("addReconcile leaves other placements untouched", () => {
    const other = p("p1", "B", 2, 2);
    const prev = [other, { id: "temp", courseId: "A", day: 1, period: 1, pending: true }];
    const result = addReconcile(prev, "temp", server("real", "A", 1, 1));
    expect(result[0]).toEqual(other);
  });

  it("addRollback removes the temp-id row", () => {
    const prev = [p("p1", "B", 2, 2), { id: "temp", courseId: "A", day: 1, period: 1, pending: true }];
    expect(addRollback(prev, "temp")).toEqual([p("p1", "B", 2, 2)]);
  });

  it("addRollback leaves other placements untouched", () => {
    const other = p("p1", "B", 2, 2);
    const prev = [other, { id: "temp", courseId: "A", day: 1, period: 1, pending: true }];
    const result = addRollback(prev, "temp");
    expect(result).toEqual([other]);
  });
});

describe("group batch transitions", () => {
  it("eligibleMembers keeps every member when the cell is empty", () => {
    expect(eligibleMembers([], ["A", "B", "C"], cell(1, 1))).toEqual(["A", "B", "C"]);
  });

  it("eligibleMembers filters members already occupying the target cell", () => {
    const placements = [p("p1", "B", 1, 1)];
    expect(eligibleMembers(placements, ["A", "B", "C"], cell(1, 1))).toEqual(["A", "C"]);
  });

  it("eligibleMembers returns empty when every member occupies the cell", () => {
    const placements = [p("p1", "A", 1, 1), p("p2", "B", 1, 1)];
    expect(eligibleMembers(placements, ["A", "B"], cell(1, 1))).toEqual([]);
  });

  it("eligibleMembers keeps members occupying a different cell", () => {
    const placements = [p("p1", "A", 2, 2)];
    expect(eligibleMembers(placements, ["A"], cell(1, 1))).toEqual(["A"]);
  });

  it("addManyOptimistic appends one pending row per entry", () => {
    const prev = [p("p1", "X", 2, 2)];
    expect(
      addManyOptimistic(
        prev,
        [
          { tempId: "t1", courseId: "A" },
          { tempId: "t2", courseId: "B" },
        ],
        cell(1, 1),
      ),
    ).toEqual([
      p("p1", "X", 2, 2),
      { id: "t1", courseId: "A", day: 1, period: 1, pending: true },
      { id: "t2", courseId: "B", day: 1, period: 1, pending: true },
    ]);
  });

  it("addManyOptimistic does not mutate the input array", () => {
    const prev = [p("p1", "X", 2, 2)];
    const snapshot = [...prev];
    addManyOptimistic(prev, [{ tempId: "t1", courseId: "A" }], cell(1, 1));
    expect(prev).toEqual(snapshot);
  });

  it("settleMany reconciles and rolls back in a single pass", () => {
    const prev = [
      p("p1", "X", 2, 2),
      { id: "t1", courseId: "A", day: 1, period: 1, pending: true },
      { id: "t2", courseId: "B", day: 1, period: 1, pending: true },
    ];
    expect(
      settleMany(prev, [
        { tempId: "t1", result: server("real1", "A", 1, 1) },
        { tempId: "t2", result: null },
      ]),
    ).toEqual([p("p1", "X", 2, 2), server("real1", "A", 1, 1)]);
  });

  it("settleMany reconciles every row when all members succeed", () => {
    const prev = [
      { id: "t1", courseId: "A", day: 1, period: 1, pending: true },
      { id: "t2", courseId: "B", day: 1, period: 1, pending: true },
    ];
    expect(
      settleMany(prev, [
        { tempId: "t1", result: server("real1", "A", 1, 1) },
        { tempId: "t2", result: server("real2", "B", 1, 1) },
      ]),
    ).toEqual([server("real1", "A", 1, 1), server("real2", "B", 1, 1)]);
  });

  it("settleMany removes every row when all members fail", () => {
    const prev = [
      p("p1", "X", 2, 2),
      { id: "t1", courseId: "A", day: 1, period: 1, pending: true },
      { id: "t2", courseId: "B", day: 1, period: 1, pending: true },
    ];
    expect(
      settleMany(prev, [
        { tempId: "t1", result: null },
        { tempId: "t2", result: null },
      ]),
    ).toEqual([p("p1", "X", 2, 2)]);
  });

  it("settleMany ignores outcomes whose tempId is not present", () => {
    const prev = [p("p1", "X", 2, 2)];
    expect(settleMany(prev, [{ tempId: "ghost", result: null }])).toEqual([p("p1", "X", 2, 2)]);
  });

  it("settleMany does not mutate the input array", () => {
    const prev = [{ id: "t1", courseId: "A", day: 1, period: 1, pending: true }];
    const snapshot = [...prev];
    settleMany(prev, [{ tempId: "t1", result: null }]);
    expect(prev).toEqual(snapshot);
  });

  it("groupFailureMessage formats a single failure", () => {
    expect(groupFailureMessage(["Math HL"], 6)).toBe("1 of 6 courses failed to save: Math HL");
  });

  it("groupFailureMessage formats multiple failures", () => {
    expect(groupFailureMessage(["Math HL", "Physics SL"], 6)).toBe(
      "2 of 6 courses failed to save: Math HL, Physics SL",
    );
  });

  it("groupFailureMessage uses the singular noun for a single attempt", () => {
    expect(groupFailureMessage(["Math HL"], 1)).toBe("1 of 1 course failed to save: Math HL");
  });

  it("placementErrorMessage passes a message error through verbatim", () => {
    expect(placementErrorMessage({ kind: "message", message: "boom" }, { A: "Math HL" })).toBe("boom");
  });

  it("placementErrorMessage resolves failed course ids to display names", () => {
    expect(
      placementErrorMessage(
        { kind: "groupFailure", failedCourseIds: ["A", "B"], attempted: 6 },
        { A: "Math HL", B: "Physics SL" },
      ),
    ).toBe("2 of 6 courses failed to save: Math HL, Physics SL");
  });

  it("placementErrorMessage falls back to the course id when the name is unknown", () => {
    expect(placementErrorMessage({ kind: "groupFailure", failedCourseIds: ["A"], attempted: 2 }, {})).toBe(
      "1 of 2 courses failed to save: A",
    );
  });
});

describe("move transitions", () => {
  it("moveIntent returns intent for a valid, non-pending placement to a different cell", () => {
    const placements = [p("p1", "A", 1, 1)];
    expect(moveIntent(placements, "p1", cell(2, 3))).toEqual({
      ok: true,
      value: {
        oldId: "p1",
        origin: { day: 1, period: 1 },
        courseId: "A",
      },
    });
  });

  it("moveIntent returns not-found when placement not found", () => {
    expect(moveIntent([p("p1", "A", 1, 1)], "missing", cell(2, 2))).toEqual({
      ok: false,
      error: "not-found",
    });
  });

  it("moveIntent returns pending when placement is pending", () => {
    expect(moveIntent([p("p1", "A", 1, 1, true)], "p1", cell(2, 2))).toEqual({
      ok: false,
      error: "pending",
    });
  });

  it("moveIntent returns same-cell when target is the same cell", () => {
    expect(moveIntent([p("p1", "A", 1, 1)], "p1", cell(1, 1))).toEqual({
      ok: false,
      error: "same-cell",
    });
  });

  it("moveIntent returns occupied when same course already occupies target cell", () => {
    const placements = [p("p1", "A", 1, 1), p("p2", "A", 2, 2)];
    expect(moveIntent(placements, "p1", cell(2, 2))).toEqual({
      ok: false,
      error: "occupied",
    });
  });

  it("moveIntent captures origin coordinates and courseId correctly", () => {
    const result = moveIntent([p("p1", "C", 3, 4)], "p1", cell(5, 6));
    expect(result).toEqual({
      ok: true,
      value: {
        oldId: "p1",
        origin: { day: 3, period: 4 },
        courseId: "C",
      },
    });
  });

  it("moveOptimistic updates day/period and sets pending true", () => {
    const prev = [p("p1", "A", 1, 1)];
    expect(moveOptimistic(prev, "p1", cell(2, 3))).toEqual([
      { id: "p1", courseId: "A", day: 2, period: 3, pending: true },
    ]);
  });

  it("moveOptimistic leaves other placements untouched", () => {
    const other = p("p2", "B", 5, 5);
    const prev = [p("p1", "A", 1, 1), other];
    const result = moveOptimistic(prev, "p1", cell(2, 3));
    expect(result[1]).toEqual(other);
  });

  it("moveReconcile replaces the old row with the server-created row", () => {
    const prev = [{ id: "p1", courseId: "A", day: 2, period: 3, pending: true }];
    expect(moveReconcile(prev, "p1", server("new", "A", 2, 3))).toEqual([server("new", "A", 2, 3)]);
  });

  it("moveRollback restores origin coordinates and clears pending", () => {
    const prev = [{ id: "p1", courseId: "A", day: 2, period: 3, pending: true }];
    expect(moveRollback(prev, "p1", { day: 1, period: 1 })).toEqual([
      { id: "p1", courseId: "A", day: 1, period: 1, pending: false },
    ]);
  });
});

describe("remove transitions", () => {
  it("removeTarget returns the row when it exists and is not pending", () => {
    const row = p("p1", "A", 1, 1);
    expect(removeTarget([row], "p1")).toEqual({ ok: true, value: row });
  });

  it("removeTarget returns not-found when placement not found", () => {
    expect(removeTarget([p("p1", "A", 1, 1)], "missing")).toEqual({
      ok: false,
      error: "not-found",
    });
  });

  it("removeTarget returns pending when placement is pending", () => {
    expect(removeTarget([p("p1", "A", 1, 1, true)], "p1")).toEqual({
      ok: false,
      error: "pending",
    });
  });

  it("removeOptimistic filters out the placement", () => {
    const prev = [p("p1", "A", 1, 1), p("p2", "B", 2, 2)];
    expect(removeOptimistic(prev, "p1")).toEqual([p("p2", "B", 2, 2)]);
  });

  it("removeRollback appends the row back", () => {
    const row = p("p1", "A", 1, 1);
    expect(removeRollback([p("p2", "B", 2, 2)], row)).toEqual([p("p2", "B", 2, 2), row]);
  });
});
