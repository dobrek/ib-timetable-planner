import { describe, expect, it } from "vitest";
import { diffCatalogs } from "./catalog-diff";
import { driftTier } from "./drift-tier";
import { buildLoadedPlan, SAMPLE, type PlanSpec } from "./__fixtures__/loaded-plan";

const tierOf = (reference: PlanSpec, other: PlanSpec) =>
  driftTier(diffCatalogs(buildLoadedPlan(reference), buildLoadedPlan(other)));

describe("driftTier", () => {
  it("is `clean` for a plan and its clone — the flow the analyzer was validated on", () => {
    expect(tierOf({ ...SAMPLE, idPrefix: "src" }, { ...SAMPLE, idPrefix: "cln" })).toBe("clean");
  });

  it("is `catalog-drift` when the course set differs", () => {
    expect(tierOf(SAMPLE, { ...SAMPLE, courses: (SAMPLE.courses ?? []).slice(1) })).toBe("catalog-drift");
  });

  it("is `catalog-drift` when only availability differs", () => {
    expect(tierOf(SAMPLE, { ...SAMPLE, availability: [] })).toBe("catalog-drift");
  });

  it("is `incomparable` when the grid differs", () => {
    expect(tierOf(SAMPLE, { ...SAMPLE, periods: 8 })).toBe("incomparable");
  });

  // A different board shape invalidates strictly more than a different catalog does — board-shape,
  // day-edge, slot-census and week-symmetry metrics all stop meaning anything. So it is the tier that
  // gets reported, even when the catalog ALSO drifted.
  it("ranks a grid mismatch above catalog drift when both are present", () => {
    const bothWrong: PlanSpec = { ...SAMPLE, periods: 8, teachers: [{ code: "ZZ" }] };

    expect(tierOf(SAMPLE, bothWrong)).toBe("incomparable");
  });
});
