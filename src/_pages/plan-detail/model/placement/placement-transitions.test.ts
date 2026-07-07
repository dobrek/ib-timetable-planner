import { describe, expect, it } from "vitest";
import type { CellData } from "../drag";
import type { LocalPlacement, PlannerPlacement } from "@/entities/timetable";
import {
  addManyOptimistic,
  addOptimistic,
  addReconcile,
  addRollback,
  canAdd,
  eligibleMembers,
  groupFailureError,
  groupFailureMessage,
  moveIntent,
  moveManyOptimistic,
  moveManyRollback,
  occupantsAt,
  oppositeWeekAssignment,
  outcomesByCourse,
  partitionBundleMove,
  placementErrorMessage,
  removeManyOptimistic,
  removeManyRollback,
  removeTarget,
  resolveDropWeek,
  settleMany,
} from "./placement-transitions";

const p = (
  id: string,
  courseId: string,
  day: number,
  period: number,
  pending?: boolean,
  week: LocalPlacement["week"] = "both",
): LocalPlacement => ({
  id,
  courseId,
  day,
  period,
  week,
  isOptional: false,
  ...(pending ? { pending } : {}),
});

const cell = (day: number, period: number): CellData => ({ day, period });

const server = (id: string, courseId: string, day: number, period: number, bundleId?: string): PlannerPlacement => ({
  id,
  courseId,
  day,
  period,
  week: "both",
  isOptional: false,
  ...(bundleId ? { bundleId } : {}),
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
    expect(addOptimistic(prev, "temp", "A", cell(1, 1), "both")).toEqual([
      p("p1", "B", 2, 2),
      p("temp", "A", 1, 1, true),
    ]);
  });

  it("addOptimistic does not mutate the input array", () => {
    const prev = [p("p1", "B", 2, 2)];
    const snapshot = [...prev];
    addOptimistic(prev, "temp", "A", cell(1, 1), "both");
    expect(prev).toEqual(snapshot);
  });

  it("addReconcile replaces the temp-id row with the server row", () => {
    const prev = [p("p1", "B", 2, 2), p("temp", "A", 1, 1, true)];
    expect(addReconcile(prev, "temp", server("real", "A", 1, 1))).toEqual([
      p("p1", "B", 2, 2),
      server("real", "A", 1, 1),
    ]);
  });

  it("addReconcile leaves other placements untouched", () => {
    const other = p("p1", "B", 2, 2);
    const prev = [other, p("temp", "A", 1, 1, true)];
    const result = addReconcile(prev, "temp", server("real", "A", 1, 1));
    expect(result[0]).toEqual(other);
  });

  it("addRollback removes the temp-id row", () => {
    const prev = [p("p1", "B", 2, 2), p("temp", "A", 1, 1, true)];
    expect(addRollback(prev, "temp")).toEqual([p("p1", "B", 2, 2)]);
  });

  it("addRollback leaves other placements untouched", () => {
    const other = p("p1", "B", 2, 2);
    const prev = [other, p("temp", "A", 1, 1, true)];
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
          { tempId: "t1", courseId: "A", week: "both", isOptional: false },
          { tempId: "t2", courseId: "B", week: "both", isOptional: false },
        ],
        cell(1, 1),
      ),
    ).toEqual([p("p1", "X", 2, 2), p("t1", "A", 1, 1, true), p("t2", "B", 1, 1, true)]);
  });

  it("addManyOptimistic does not mutate the input array", () => {
    const prev = [p("p1", "X", 2, 2)];
    const snapshot = [...prev];
    addManyOptimistic(prev, [{ tempId: "t1", courseId: "A", week: "both", isOptional: false }], cell(1, 1));
    expect(prev).toEqual(snapshot);
  });

  it("settleMany reconciles and rolls back in a single pass", () => {
    const prev = [p("p1", "X", 2, 2), p("t1", "A", 1, 1, true), p("t2", "B", 1, 1, true)];
    expect(
      settleMany(prev, [
        { tempId: "t1", result: server("real1", "A", 1, 1) },
        { tempId: "t2", result: null },
      ]),
    ).toEqual([p("p1", "X", 2, 2), server("real1", "A", 1, 1)]);
  });

  it("settleMany reconciles every row when all members succeed", () => {
    const prev = [p("t1", "A", 1, 1, true), p("t2", "B", 1, 1, true)];
    expect(
      settleMany(prev, [
        { tempId: "t1", result: server("real1", "A", 1, 1) },
        { tempId: "t2", result: server("real2", "B", 1, 1) },
      ]),
    ).toEqual([server("real1", "A", 1, 1), server("real2", "B", 1, 1)]);
  });

  it("settleMany removes every row when all members fail", () => {
    const prev = [p("p1", "X", 2, 2), p("t1", "A", 1, 1, true), p("t2", "B", 1, 1, true)];
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
    const prev = [p("t1", "A", 1, 1, true)];
    const snapshot = [...prev];
    settleMany(prev, [{ tempId: "t1", result: null }]);
    expect(prev).toEqual(snapshot);
  });

  it("settleMany carries the server row's bundleId onto the reconciled placement", () => {
    // The optimistic row has no bundleId until settle; the whole-row swap pulls it in from the
    // server row — no temp-bundle-id reconciliation index needed (forward use: S-07/S-08).
    const prev = [p("t1", "A", 1, 1, true)];
    const settled = settleMany(prev, [{ tempId: "t1", result: server("real1", "A", 1, 1, "bundle-1") }]);
    expect(settled).toEqual([server("real1", "A", 1, 1, "bundle-1")]);
    expect(settled[0].bundleId).toBe("bundle-1");
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
    expect(placementErrorMessage({ kind: "message", message: "boom" }, { A: { name: "Math HL", color: null } })).toBe(
      "boom",
    );
  });

  it("placementErrorMessage resolves failed course ids to display names", () => {
    expect(
      placementErrorMessage(
        { kind: "groupFailure", failedCourseIds: ["A", "B"], attempted: 6 },
        { A: { name: "Math HL", color: null }, B: { name: "Physics SL", color: null } },
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
        week: "both",
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
        week: "both",
      },
    });
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
});

describe("bundle move/remove transitions", () => {
  it("partitionBundleMove classifies a course absent at the target as a mover", () => {
    const placements = [p("s_a", "A", 1, 1), p("s_b", "B", 1, 1)];
    expect(partitionBundleMove(placements, ["s_a", "s_b"], cell(2, 2))).toEqual({
      movers: ["s_a", "s_b"],
      mergers: [],
    });
  });

  it("partitionBundleMove classifies a course already at the target as a merger", () => {
    // B already sits at (2,2); A does not.
    const placements = [p("s_a", "A", 1, 1), p("s_b", "B", 1, 1), p("t_b", "B", 2, 2)];
    expect(partitionBundleMove(placements, ["s_a", "s_b"], cell(2, 2))).toEqual({
      movers: ["s_a"],
      mergers: ["s_b"],
    });
  });

  it("moveManyOptimistic moves movers to the target (pending) and drops mergers in one pass", () => {
    const prev = [p("s_a", "A", 1, 1), p("s_b", "B", 1, 1), p("t_b", "B", 2, 2), p("t_c", "C", 2, 2)];
    expect(moveManyOptimistic(prev, ["s_a"], ["s_b"], cell(2, 2))).toEqual([
      { id: "s_a", courseId: "A", day: 2, period: 2, week: "both", isOptional: false, pending: true },
      p("t_b", "B", 2, 2),
      p("t_c", "C", 2, 2),
    ]);
  });

  it("moveManyOptimistic does not mutate the input array", () => {
    const prev = [p("s_a", "A", 1, 1), p("s_b", "B", 1, 1)];
    const snapshot = [...prev];
    moveManyOptimistic(prev, ["s_a"], ["s_b"], cell(2, 2));
    expect(prev).toEqual(snapshot);
  });

  it("merge onto an occupied target yields exactly one row per course and an empty source", () => {
    // Source (1,1): A, B. Target (2,2): B (twin), C. Moving the bundle should leave the source
    // empty and the target holding A, B, C — with B appearing exactly once (no duplicate-course row).
    const prev = [p("s_a", "A", 1, 1), p("s_b", "B", 1, 1), p("t_b", "B", 2, 2), p("t_c", "C", 2, 2)];
    const { movers, mergers } = partitionBundleMove(prev, ["s_a", "s_b"], cell(2, 2));
    const optimistic = moveManyOptimistic(prev, movers, mergers, cell(2, 2));
    // Settle the one mover's POST-new (s_a's old id → its server row at the target).
    const settled = settleMany(optimistic, [{ tempId: "s_a", result: server("new_a", "A", 2, 2) }]);

    const source = settled.filter((row) => row.day === 1 && row.period === 1);
    const target = settled.filter((row) => row.day === 2 && row.period === 2);
    expect(source).toEqual([]);
    expect(target.map((row) => row.courseId).sort()).toEqual(["A", "B", "C"]);
    // B is present exactly once — the merger's source row was dropped, not moved onto its twin.
    expect(target.filter((row) => row.courseId === "B")).toHaveLength(1);
  });

  it("removeManyOptimistic clears every id in the set in one pass", () => {
    const prev = [p("p1", "A", 1, 1), p("p2", "B", 1, 1), p("p3", "C", 2, 2)];
    expect(removeManyOptimistic(prev, ["p1", "p2"])).toEqual([p("p3", "C", 2, 2)]);
  });

  it("removeManyOptimistic does not mutate the input array", () => {
    const prev = [p("p1", "A", 1, 1), p("p2", "B", 1, 1)];
    const snapshot = [...prev];
    removeManyOptimistic(prev, ["p1"]);
    expect(prev).toEqual(snapshot);
  });

  it("moveManyRollback restores the source occupants, drops the moved movers, and leaves twins in place", () => {
    // Pre-move: source (1,1) holds A, B; target (2,2) holds a B twin. The optimistic move sent
    // s_a to (2,2) and filtered the merger s_b. Rollback must restore A+B at the source, remove
    // the moved s_a from the target, and leave the untouched twin t_b alone.
    const original = [p("s_a", "A", 1, 1), p("s_b", "B", 1, 1)];
    const twin = p("t_b", "B", 2, 2);
    const optimistic = moveManyOptimistic([...original, twin], ["s_a"], ["s_b"], cell(2, 2));
    const rolledBack = moveManyRollback(optimistic, ["s_a"], original);

    expect(rolledBack).toContainEqual(twin);
    expect(rolledBack.filter((r) => r.id === "s_a")).toEqual([p("s_a", "A", 1, 1)]); // back at source, not pending
    expect(
      rolledBack
        .filter((r) => r.day === 1 && r.period === 1)
        .map((r) => r.courseId)
        .sort(),
    ).toEqual(["A", "B"]);
  });

  it("removeManyRollback restores the optimistically-removed rows", () => {
    const removed = [p("p1", "A", 1, 1), p("p2", "B", 1, 1)];
    expect(removeManyRollback([p("p3", "C", 2, 2)], removed)).toEqual([
      p("p3", "C", 2, 2),
      p("p1", "A", 1, 1),
      p("p2", "B", 1, 1),
    ]);
  });
});

describe("drop-time week assignment", () => {
  it("resolveDropWeek returns both for an agnostic course", () => {
    expect(resolveDropWeek("agnostic", [], cell(1, 1))).toBe("both");
  });

  it("resolveDropWeek returns a for a bi-weekly course in an empty cell", () => {
    expect(resolveDropWeek("biweekly", [], cell(1, 1))).toBe("a");
  });

  it("resolveDropWeek picks the free week when one is already taken", () => {
    const occupied = [p("x", "X", 1, 1, false, "a")];
    expect(resolveDropWeek("biweekly", occupied, cell(1, 1))).toBe("b");
  });

  it("resolveDropWeek falls back to a when both weeks are taken", () => {
    const occupied = [p("x", "X", 1, 1, false, "a"), p("y", "Y", 1, 1, false, "b")];
    expect(resolveDropWeek("biweekly", occupied, cell(1, 1))).toBe("a");
  });

  it("resolveDropWeek ignores occupants in other cells", () => {
    const elsewhere = [p("x", "X", 2, 2, false, "a")];
    expect(resolveDropWeek("biweekly", elsewhere, cell(1, 1))).toBe("a");
  });

  it("oppositeWeekAssignment puts the sorted-first id on a and the second on b", () => {
    const assignment = oppositeWeekAssignment(["B", "A"]);
    expect(assignment.get("A")).toBe("a");
    expect(assignment.get("B")).toBe("b");
  });
});

describe("occupantsAt", () => {
  it("returns every placement sitting at the cell", () => {
    const placements = [p("p1", "A", 1, 1), p("p2", "B", 1, 1), p("p3", "C", 2, 2)];
    expect(occupantsAt(placements, cell(1, 1))).toEqual([p("p1", "A", 1, 1), p("p2", "B", 1, 1)]);
  });

  it("returns an empty array when no placement sits at the cell", () => {
    expect(occupantsAt([p("p1", "A", 1, 1)], cell(2, 2))).toEqual([]);
  });
});

describe("outcomesByCourse", () => {
  it("matches each entry to its server row by course id", () => {
    const entries = [
      { tempId: "t1", courseId: "A" },
      { tempId: "t2", courseId: "B" },
    ];
    const serverRows = [server("real-a", "A", 2, 2), server("real-b", "B", 2, 2)];
    expect(outcomesByCourse(entries, serverRows)).toEqual([
      { tempId: "t1", courseId: "A", result: server("real-a", "A", 2, 2) },
      { tempId: "t2", courseId: "B", result: server("real-b", "B", 2, 2) },
    ]);
  });

  it("yields a null result for an entry the server did not return (the failed member)", () => {
    const entries = [
      { tempId: "t1", courseId: "A" },
      { tempId: "t2", courseId: "B" },
    ];
    const serverRows = [server("real-a", "A", 2, 2)];
    expect(outcomesByCourse(entries, serverRows)).toEqual([
      { tempId: "t1", courseId: "A", result: server("real-a", "A", 2, 2) },
      { tempId: "t2", courseId: "B", result: null },
    ]);
  });
});

describe("groupFailureError", () => {
  it("returns null when every outcome settled", () => {
    const outcomes = [
      { tempId: "t1", courseId: "A", result: server("real-a", "A", 1, 1) },
      { tempId: "t2", courseId: "B", result: server("real-b", "B", 1, 1) },
    ];
    expect(groupFailureError(outcomes, 2)).toBeNull();
  });

  it("returns a groupFailure naming the failed courses with the attempted count", () => {
    const outcomes = [
      { tempId: "t1", courseId: "A", result: server("real-a", "A", 1, 1) },
      { tempId: "t2", courseId: "B", result: null },
    ];
    expect(groupFailureError(outcomes, 2)).toEqual({
      kind: "groupFailure",
      failedCourseIds: ["B"],
      attempted: 2,
    });
  });
});
