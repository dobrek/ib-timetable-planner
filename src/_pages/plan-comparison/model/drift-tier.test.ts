import { describe, expect, it } from "vitest";
import { computeCatalogFingerprint } from "./catalog-fingerprint";
import { driftTier, gridOf, sameGrid } from "./drift-tier";
import { buildLoadedPlan, SAMPLE, type PlanSpec } from "./__fixtures__/loaded-plan";

/**
 * Drives the tier the way the loader does — off the fingerprint and the grid, the only two facts it
 * rests on. Tiering a hand-built `{gridEqual, catalogEqual}` would test nothing but a boolean; the risk
 * worth pinning is whether the *fingerprint* sees a catalog change at all.
 */
const tierOf = async (reference: PlanSpec, other: PlanSpec) => {
  const [left, right] = [buildLoadedPlan(reference), buildLoadedPlan(other)];
  const [leftDigest, rightDigest] = await Promise.all([
    computeCatalogFingerprint(left),
    computeCatalogFingerprint(right),
  ]);

  return driftTier({
    gridEqual: sameGrid(gridOf(left), gridOf(right)),
    catalogEqual: leftDigest === rightDigest,
  });
};

describe("driftTier", () => {
  // The load-bearing case: every id is re-minted, and the tier must still see one catalog.
  it("is `clean` for a plan and its clone — the flow the analyzer was validated on", async () => {
    expect(await tierOf({ ...SAMPLE, idPrefix: "src" }, { ...SAMPLE, idPrefix: "cln" })).toBe("clean");
  });

  it("is `catalog-drift` when the course set differs", async () => {
    expect(await tierOf(SAMPLE, { ...SAMPLE, courses: (SAMPLE.courses ?? []).slice(1) })).toBe("catalog-drift");
  });

  it("is `catalog-drift` when only availability differs", async () => {
    expect(await tierOf(SAMPLE, { ...SAMPLE, availability: [] })).toBe("catalog-drift");
  });

  it("is `incomparable` when the grid differs", async () => {
    expect(await tierOf(SAMPLE, { ...SAMPLE, periods: 8 })).toBe("incomparable");
  });

  // A different board shape invalidates strictly more than a different catalog does — board-shape,
  // day-edge, slot-census and week-symmetry metrics all stop meaning anything. So it is the tier that
  // gets reported, even when the catalog ALSO drifted.
  it("ranks a grid mismatch above catalog drift when both are present", async () => {
    const bothWrong: PlanSpec = { ...SAMPLE, periods: 8, teachers: [{ code: "ZZ" }] };

    expect(await tierOf(SAMPLE, bothWrong)).toBe("incomparable");
  });
});
