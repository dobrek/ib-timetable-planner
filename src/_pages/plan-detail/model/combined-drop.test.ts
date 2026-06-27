import { describe, expect, it } from "vitest";
import { resolveCombinedDrop } from "./combined-drop";
import type { BundleDrag, CellData, CourseDrag, GroupDrag, ParkedDrag, PlacementDrag, ShelfData } from "./drag";

const cell = (cohort: "dp1" | "dp2", day = 1, period = 1): CellData => ({ day, period, cohort });
const shelf: ShelfData = { kind: "shelf" };

describe("resolveCombinedDrop — cross-cohort guard", () => {
  it("rejects a placement move onto the OTHER cohort's cell", () => {
    const drag: PlacementDrag = { kind: "placement", placementId: "p1", courseId: "c1", cohort: "dp1" };
    expect(resolveCombinedDrop(drag, cell("dp2"), "dp1")).toBeNull();
  });

  it("dispatches a placement move within the SAME cohort", () => {
    const drag: PlacementDrag = { kind: "placement", placementId: "p1", courseId: "c1", cohort: "dp1" };
    expect(resolveCombinedDrop(drag, cell("dp1", 2, 3), "dp1")).toEqual({
      kind: "movePlacement",
      cohort: "dp1",
      placementId: "p1",
      cell: cell("dp1", 2, 3),
    });
  });

  it("rejects a bundle move across cohorts but dispatches it within the same cohort", () => {
    const drag: BundleDrag = { kind: "bundle", day: 1, period: 1, cohort: "dp2" };
    expect(resolveCombinedDrop(drag, cell("dp1"), "dp1")).toBeNull();
    expect(resolveCombinedDrop(drag, cell("dp2", 4, 5), "dp1")).toEqual({
      kind: "moveBundle",
      cohort: "dp2",
      day: 1,
      period: 1,
      cell: cell("dp2", 4, 5),
    });
  });

  it("rejects a parked place-back onto the OTHER cohort but dispatches it into its own cohort", () => {
    const drag: ParkedDrag = { kind: "parked", shelfBundleId: "s1", cohort: "dp1" };
    expect(resolveCombinedDrop(drag, cell("dp2"), "dp1")).toBeNull();
    expect(resolveCombinedDrop(drag, cell("dp1"), "dp1")).toEqual({
      kind: "placeBack",
      cohort: "dp1",
      shelfBundleId: "s1",
      cell: cell("dp1"),
    });
  });
});

describe("resolveCombinedDrop — routing", () => {
  it("adopts the target cell's cohort for a cohort-free course drag (not the active cohort)", () => {
    const drag: CourseDrag = { kind: "course", courseId: "c1" };
    expect(resolveCombinedDrop(drag, cell("dp2"), "dp1")).toEqual({
      kind: "addCourse",
      cohort: "dp2",
      courseId: "c1",
      cell: cell("dp2"),
    });
  });

  it("adopts the target cell's cohort for a cohort-free grouping drag (not the active cohort)", () => {
    const drag: GroupDrag = { kind: "grouping", groupingId: "g1" };
    expect(resolveCombinedDrop(drag, cell("dp1"), "dp2")).toEqual({
      kind: "dropGroup",
      cohort: "dp1",
      groupingId: "g1",
      cell: cell("dp1"),
    });
  });

  it("routes a bundle dropped on the shelf to a lift, keyed by source cohort", () => {
    const drag: BundleDrag = { kind: "bundle", day: 2, period: 3, cohort: "dp2" };
    expect(resolveCombinedDrop(drag, shelf, "dp1")).toEqual({ kind: "liftBundle", cohort: "dp2", day: 2, period: 3 });
  });

  it("is a no-op for a placement / parked dropped on the shelf", () => {
    expect(
      resolveCombinedDrop({ kind: "placement", placementId: "p1", courseId: "c1", cohort: "dp1" }, shelf, "dp1"),
    ).toBeNull();
    expect(resolveCombinedDrop({ kind: "parked", shelfBundleId: "s1", cohort: "dp1" }, shelf, "dp1")).toBeNull();
  });
});

describe("resolveCombinedDrop — park to shelf", () => {
  it("parks a course dropped on the shelf under the active cohort", () => {
    const drag: CourseDrag = { kind: "course", courseId: "c1" };
    expect(resolveCombinedDrop(drag, shelf, "dp1")).toEqual({ kind: "parkCourse", cohort: "dp1", courseId: "c1" });
    expect(resolveCombinedDrop(drag, shelf, "dp2")).toEqual({ kind: "parkCourse", cohort: "dp2", courseId: "c1" });
  });

  it("parks a grouping dropped on the shelf under the active cohort", () => {
    const drag: GroupDrag = { kind: "grouping", groupingId: "g1" };
    expect(resolveCombinedDrop(drag, shelf, "dp1")).toEqual({ kind: "parkGroup", cohort: "dp1", groupingId: "g1" });
    expect(resolveCombinedDrop(drag, shelf, "dp2")).toEqual({ kind: "parkGroup", cohort: "dp2", groupingId: "g1" });
  });
});

// The single board is the degenerate one-cohort case: its cells/drags carry NO cohort (untagged, to
// preserve the cell aria-label + parked-card tag). Every missing cohort resolves to `activeCohort` —
// the board's one cohort — so the cross-cohort guard never rejects and the dispatch matches the old
// single-board `switch (kind)`. These fold in the retired `single-drop.test.ts` cases.
describe("resolveCombinedDrop — single board (untagged, one cohort)", () => {
  const bareCell = (day = 1, period = 1): CellData => ({ day, period });

  it("places a palette course on an untagged cell under the board's cohort", () => {
    expect(resolveCombinedDrop({ kind: "course", courseId: "c1" }, bareCell(2, 3), "dp1")).toEqual({
      kind: "addCourse",
      cohort: "dp1",
      courseId: "c1",
      cell: bareCell(2, 3),
    });
  });

  it("fans a grouping into an untagged cell under the board's cohort", () => {
    expect(resolveCombinedDrop({ kind: "grouping", groupingId: "g1" }, bareCell(), "dp1")).toEqual({
      kind: "dropGroup",
      cohort: "dp1",
      groupingId: "g1",
      cell: bareCell(),
    });
  });

  it("moves an untagged placement onto an untagged cell — the guard trivially passes", () => {
    expect(
      resolveCombinedDrop({ kind: "placement", placementId: "p1", courseId: "c1" }, bareCell(4, 5), "dp1"),
    ).toEqual({ kind: "movePlacement", cohort: "dp1", placementId: "p1", cell: bareCell(4, 5) });
  });

  it("moves an untagged bundle onto a cell, and lifts one off onto the shelf", () => {
    expect(resolveCombinedDrop({ kind: "bundle", day: 1, period: 1 }, bareCell(2, 2), "dp1")).toEqual({
      kind: "moveBundle",
      cohort: "dp1",
      day: 1,
      period: 1,
      cell: bareCell(2, 2),
    });
    expect(resolveCombinedDrop({ kind: "bundle", day: 2, period: 3 }, shelf, "dp1")).toEqual({
      kind: "liftBundle",
      cohort: "dp1",
      day: 2,
      period: 3,
    });
  });

  it("places an untagged parked card back onto a cell, and no-ops on the shelf", () => {
    expect(resolveCombinedDrop({ kind: "parked", shelfBundleId: "s1" }, bareCell(3, 3), "dp1")).toEqual({
      kind: "placeBack",
      cohort: "dp1",
      shelfBundleId: "s1",
      cell: bareCell(3, 3),
    });
    expect(resolveCombinedDrop({ kind: "parked", shelfBundleId: "s1" }, shelf, "dp1")).toBeNull();
  });

  it("parks an untagged palette course / grouping onto the shelf under the board's cohort", () => {
    expect(resolveCombinedDrop({ kind: "course", courseId: "c1" }, shelf, "dp1")).toEqual({
      kind: "parkCourse",
      cohort: "dp1",
      courseId: "c1",
    });
    expect(resolveCombinedDrop({ kind: "grouping", groupingId: "g1" }, shelf, "dp1")).toEqual({
      kind: "parkGroup",
      cohort: "dp1",
      groupingId: "g1",
    });
  });

  it("no-ops an untagged placement dropped on the shelf", () => {
    expect(resolveCombinedDrop({ kind: "placement", placementId: "p1", courseId: "c1" }, shelf, "dp1")).toBeNull();
  });
});
