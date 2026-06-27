import { describe, expect, it } from "vitest";
import { resolveCombinedDrop } from "./combined-drop";
import type { BundleDrag, CellData, CourseDrag, GroupDrag, ParkedDrag, PlacementDrag, ShelfData } from "./drag";

const cell = (cohort: "dp1" | "dp2", day = 1, period = 1): CellData => ({ day, period, cohort });
const shelf: ShelfData = { kind: "shelf" };

describe("resolveCombinedDrop — cross-cohort guard", () => {
  it("rejects a placement move onto the OTHER cohort's cell", () => {
    const drag: PlacementDrag = { kind: "placement", placementId: "p1", courseId: "c1", cohort: "dp1" };
    expect(resolveCombinedDrop(drag, cell("dp2"))).toBeNull();
  });

  it("dispatches a placement move within the SAME cohort", () => {
    const drag: PlacementDrag = { kind: "placement", placementId: "p1", courseId: "c1", cohort: "dp1" };
    expect(resolveCombinedDrop(drag, cell("dp1", 2, 3))).toEqual({
      kind: "movePlacement",
      cohort: "dp1",
      placementId: "p1",
      cell: cell("dp1", 2, 3),
    });
  });

  it("rejects a bundle move across cohorts but dispatches it within the same cohort", () => {
    const drag: BundleDrag = { kind: "bundle", day: 1, period: 1, cohort: "dp2" };
    expect(resolveCombinedDrop(drag, cell("dp1"))).toBeNull();
    expect(resolveCombinedDrop(drag, cell("dp2", 4, 5))).toEqual({
      kind: "moveBundle",
      cohort: "dp2",
      day: 1,
      period: 1,
      cell: cell("dp2", 4, 5),
    });
  });

  it("rejects a parked place-back onto the OTHER cohort but dispatches it into its own cohort", () => {
    const drag: ParkedDrag = { kind: "parked", shelfBundleId: "s1", cohort: "dp1" };
    expect(resolveCombinedDrop(drag, cell("dp2"))).toBeNull();
    expect(resolveCombinedDrop(drag, cell("dp1"))).toEqual({
      kind: "placeBack",
      cohort: "dp1",
      shelfBundleId: "s1",
      cell: cell("dp1"),
    });
  });
});

describe("resolveCombinedDrop — routing", () => {
  it("adopts the target cell's cohort for a cohort-free course drag", () => {
    const drag: CourseDrag = { kind: "course", courseId: "c1" };
    expect(resolveCombinedDrop(drag, cell("dp2"))).toEqual({
      kind: "addCourse",
      cohort: "dp2",
      courseId: "c1",
      cell: cell("dp2"),
    });
  });

  it("adopts the target cell's cohort for a cohort-free grouping drag", () => {
    const drag: GroupDrag = { kind: "grouping", groupingId: "g1" };
    expect(resolveCombinedDrop(drag, cell("dp1"))).toEqual({
      kind: "dropGroup",
      cohort: "dp1",
      groupingId: "g1",
      cell: cell("dp1"),
    });
  });

  it("routes a bundle dropped on the shelf to a lift, keyed by source cohort", () => {
    const drag: BundleDrag = { kind: "bundle", day: 2, period: 3, cohort: "dp2" };
    expect(resolveCombinedDrop(drag, shelf)).toEqual({ kind: "liftBundle", cohort: "dp2", day: 2, period: 3 });
  });

  it("is a no-op for a placement / parked / course dropped on the shelf", () => {
    expect(
      resolveCombinedDrop({ kind: "placement", placementId: "p1", courseId: "c1", cohort: "dp1" }, shelf),
    ).toBeNull();
    expect(resolveCombinedDrop({ kind: "parked", shelfBundleId: "s1", cohort: "dp1" }, shelf)).toBeNull();
    expect(resolveCombinedDrop({ kind: "course", courseId: "c1" }, shelf)).toBeNull();
  });
});
