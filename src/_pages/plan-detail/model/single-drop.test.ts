import { describe, expect, it } from "vitest";
import { resolveSingleDrop } from "./single-drop";
import type { BundleDrag, CellData, CourseDrag, GroupDrag, ParkedDrag, PlacementDrag, ShelfData } from "./drag";

// Characterizes the single board's drop dispatch (PlannerBoard.handleDrop) as a pure decision,
// before Phase 7 folds it onto `resolveCombinedDrop`. Each case mirrors a branch of the original
// `switch (data.kind)` — onto a cell vs onto the cell-less shelf.
const cell = (day = 1, period = 1): CellData => ({ day, period });
const shelf: ShelfData = { kind: "shelf" };

describe("resolveSingleDrop — onto a cell", () => {
  it("places a palette course", () => {
    const drag: CourseDrag = { kind: "course", courseId: "c1" };
    expect(resolveSingleDrop(drag, cell(2, 3))).toEqual({ kind: "addCourse", courseId: "c1", cell: cell(2, 3) });
  });

  it("fans a grouping's members into the cell", () => {
    const drag: GroupDrag = { kind: "grouping", groupingId: "g1" };
    expect(resolveSingleDrop(drag, cell(1, 1))).toEqual({ kind: "dropGroup", groupingId: "g1", cell: cell(1, 1) });
  });

  it("moves a placement", () => {
    const drag: PlacementDrag = { kind: "placement", placementId: "p1", courseId: "c1" };
    expect(resolveSingleDrop(drag, cell(4, 5))).toEqual({ kind: "movePlacement", placementId: "p1", cell: cell(4, 5) });
  });

  it("moves a whole bundle", () => {
    const drag: BundleDrag = { kind: "bundle", day: 1, period: 1 };
    expect(resolveSingleDrop(drag, cell(2, 2))).toEqual({
      kind: "moveBundle",
      day: 1,
      period: 1,
      cell: cell(2, 2),
    });
  });

  it("places a parked bundle back", () => {
    const drag: ParkedDrag = { kind: "parked", shelfBundleId: "s1" };
    expect(resolveSingleDrop(drag, cell(3, 3))).toEqual({ kind: "placeBack", shelfBundleId: "s1", cell: cell(3, 3) });
  });
});

describe("resolveSingleDrop — onto the shelf", () => {
  it("parks a palette course directly", () => {
    const drag: CourseDrag = { kind: "course", courseId: "c1" };
    expect(resolveSingleDrop(drag, shelf)).toEqual({ kind: "parkCourse", courseId: "c1" });
  });

  it("parks a grouping directly", () => {
    const drag: GroupDrag = { kind: "grouping", groupingId: "g1" };
    expect(resolveSingleDrop(drag, shelf)).toEqual({ kind: "parkGroup", groupingId: "g1" });
  });

  it("lifts a bundle off the board", () => {
    const drag: BundleDrag = { kind: "bundle", day: 2, period: 3 };
    expect(resolveSingleDrop(drag, shelf)).toEqual({ kind: "liftBundle", day: 2, period: 3 });
  });

  it("is a no-op for a placement dropped on the shelf", () => {
    const drag: PlacementDrag = { kind: "placement", placementId: "p1", courseId: "c1" };
    expect(resolveSingleDrop(drag, shelf)).toBeNull();
  });

  it("is a no-op for a parked card dropped on the shelf", () => {
    const drag: ParkedDrag = { kind: "parked", shelfBundleId: "s1" };
    expect(resolveSingleDrop(drag, shelf)).toBeNull();
  });
});
