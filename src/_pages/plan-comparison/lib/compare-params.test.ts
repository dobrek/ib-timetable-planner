import { describe, expect, it } from "vitest";
import { MAX_COMPARE_PLANS, readCompareParams } from "./compare-params";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

/** N distinct, well-formed plan ids. Well-formed is the point: the cap has to hold against a URL whose
 *  ids all pass the guard, which is exactly what the hub's "Select all plans" checkbox produces. */
const planIds = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${String(index + 10).padStart(8, "0")}-1111-4111-8111-111111111111`);

describe("readCompareParams", () => {
  // The exact shape the plans hub builds. The two live in different slices — steiger forbids the hub
  // from importing this codec — so the wire format is a contract, and the e2e hub→compare flow is what
  // guards it end to end.
  it("reads the picked plans, in the order the URL lists them", () => {
    expect(readCompareParams(`?plans=${A},${B}`)).toEqual({ planIds: [A, B], omittedForCap: 0 });
  });

  // A shareable URL is hand-edited and goes stale — a garbage id must cost the reader that plan, not
  // the whole page.
  it("drops malformed ids rather than rejecting the whole selection", () => {
    expect(readCompareParams(`?plans=${A},not-a-uuid,,${B}`)).toEqual({ planIds: [A, B], omittedForCap: 0 });
  });

  it("collapses duplicates — a plan compared with itself is a no-op column", () => {
    expect(readCompareParams(`?plans=${A},${A},${B}`).planIds).toEqual([A, B]);
  });

  it("ignores a stray baseline param — the concept no longer exists", () => {
    expect(readCompareParams(`?plans=${A},${B}&baseline=${B}`)).toEqual({ planIds: [A, B], omittedForCap: 0 });
  });

  it("yields an empty selection — the page's empty state, not an error", () => {
    expect(readCompareParams("")).toEqual({ planIds: [], omittedForCap: 0 });
    expect(readCompareParams("?plans=")).toEqual({ planIds: [], omittedForCap: 0 });
  });

  describe("the cap", () => {
    // The reliability bound, not a taste one. Each plan costs ~18 Supabase round trips, fired
    // concurrently, against the Workers cap of 1000 subrequests per invocation — so an uncapped
    // selection hard-500s the page somewhere past N ≈ 55. The hub's one-click "Select all plans"
    // checkbox reaches that with a single click once an author has enough plans.
    it("caps the selection, so N can never reach the Workers subrequest ceiling", () => {
      const { planIds: capped } = readCompareParams(`?plans=${planIds(60).join(",")}`);

      expect(capped).toHaveLength(MAX_COMPARE_PLANS);
      expect(capped).toEqual(planIds(60).slice(0, MAX_COMPARE_PLANS));
    });

    // A silently shortened comparison is a comparison the reader misreads: they asked for twelve plans,
    // got eight, and have no way to tell. The count is what lets the page say so.
    it("reports how many ids it dropped, so the page can say the selection was shortened", () => {
      expect(readCompareParams(`?plans=${planIds(12).join(",")}`).omittedForCap).toBe(12 - MAX_COMPARE_PLANS);
    });

    it("reports no omission when the selection fits", () => {
      expect(readCompareParams(`?plans=${planIds(MAX_COMPARE_PLANS).join(",")}`).omittedForCap).toBe(0);
    });

    // The cap counts what SURVIVES parsing, not what the URL listed — otherwise a URL padded with
    // garbage ids would report an omission it never made.
    it("counts deduped, well-formed ids only", () => {
      const { planIds: capped, omittedForCap } = readCompareParams(`?plans=${A},${A},junk,${B}`);

      expect(capped).toEqual([A, B]);
      expect(omittedForCap).toBe(0);
    });
  });
});
