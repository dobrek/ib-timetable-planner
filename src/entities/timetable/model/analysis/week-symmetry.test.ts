import { describe, expect, it } from "vitest";
import { row } from "./__fixtures__/builders";
import { deriveWeekSymmetry } from "./week-symmetry";

describe("deriveWeekSymmetry", () => {
  it("reports a fully agnostic board as symmetric", () => {
    const rows = [row("dp1", "math", 1, 1), row("dp1", "bio", 1, 2)];

    expect(deriveWeekSymmetry(rows)).toEqual({ slotsWeekA: 2, slotsWeekB: 2, slotDelta: 0, differingCells: 0 });
  });

  it("flags a paired biweekly cell as differing while keeping the slot counts level", () => {
    // The expert's CAS(a) + EE(b) cell: same slot both weeks, a different course in each.
    const rows = [row("dp1", "cas", 3, 8, "a"), row("dp1", "ee", 3, 8, "b")];

    expect(deriveWeekSymmetry(rows)).toEqual({ slotsWeekA: 1, slotsWeekB: 1, slotDelta: 0, differingCells: 1 });
  });

  it("counts a cell used in only one lane as differing and unbalances the slot counts", () => {
    const rows = [row("dp1", "math", 1, 1), row("dp1", "cas", 2, 4, "a")];

    expect(deriveWeekSymmetry(rows)).toEqual({ slotsWeekA: 2, slotsWeekB: 1, slotDelta: 1, differingCells: 1 });
  });

  it("reports an empty board as symmetric", () => {
    expect(deriveWeekSymmetry([])).toEqual({ slotsWeekA: 0, slotsWeekB: 0, slotDelta: 0, differingCells: 0 });
  });
});
