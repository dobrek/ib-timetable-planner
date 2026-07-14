import { describe, expect, it } from "vitest";
import { readCompareParams, toCompareSearch } from "./compare-params";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("readCompareParams", () => {
  it("reads the picked plans and the designated baseline", () => {
    expect(readCompareParams(`?plans=${A},${B}&baseline=${B}`)).toEqual({ planIds: [A, B], baselineId: B });
  });

  it("defaults the baseline to the first picked plan", () => {
    expect(readCompareParams(`?plans=${A},${B}`)).toEqual({ planIds: [A, B], baselineId: A });
  });

  // A shareable URL is hand-edited and goes stale — a garbage id must cost the reader that plan, not
  // the whole page.
  it("drops malformed ids rather than rejecting the whole selection", () => {
    expect(readCompareParams(`?plans=${A},not-a-uuid,,${B}`)).toEqual({ planIds: [A, B], baselineId: A });
  });

  it("collapses duplicates — a plan compared with itself is a no-op column", () => {
    expect(readCompareParams(`?plans=${A},${A},${B}`).planIds).toEqual([A, B]);
  });

  it("ignores a baseline that names a plan not being compared", () => {
    expect(readCompareParams(`?plans=${A},${B}&baseline=${C}`).baselineId).toBe(A);
  });

  it("ignores a malformed baseline", () => {
    expect(readCompareParams(`?plans=${A}&baseline=nonsense`).baselineId).toBe(A);
  });

  it("yields an empty selection — the picker's empty state, not an error", () => {
    expect(readCompareParams("")).toEqual({ planIds: [], baselineId: null });
    expect(readCompareParams("?plans=")).toEqual({ planIds: [], baselineId: null });
  });
});

describe("toCompareSearch", () => {
  it("omits the baseline when it is the default (the first plan), so a clean state yields a clean URL", () => {
    expect(toCompareSearch({ planIds: [A, B], baselineId: A })).toBe(`plans=${A}%2C${B}`);
  });

  it("writes the baseline when it is not the first plan", () => {
    expect(toCompareSearch({ planIds: [A, B], baselineId: B })).toBe(`plans=${A}%2C${B}&baseline=${B}`);
  });

  it("yields an empty string for an empty selection", () => {
    expect(toCompareSearch({ planIds: [], baselineId: null })).toBe("");
  });

  it("round-trips", () => {
    const state = { planIds: [A, B, C], baselineId: C };

    expect(readCompareParams(`?${toCompareSearch(state)}`)).toEqual(state);
  });
});
