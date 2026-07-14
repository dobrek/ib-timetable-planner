import { describe, expect, it } from "vitest";
import { readCompareParams } from "./compare-params";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("readCompareParams", () => {
  // The exact shape the plans hub builds. The two live in different slices — steiger forbids the hub
  // from importing this codec — so the wire format is a contract, and the e2e hub→compare flow is what
  // guards it end to end.
  it("reads the picked plans, in the order the URL lists them", () => {
    expect(readCompareParams(`?plans=${A},${B}`)).toEqual({ planIds: [A, B] });
  });

  // A shareable URL is hand-edited and goes stale — a garbage id must cost the reader that plan, not
  // the whole page.
  it("drops malformed ids rather than rejecting the whole selection", () => {
    expect(readCompareParams(`?plans=${A},not-a-uuid,,${B}`)).toEqual({ planIds: [A, B] });
  });

  it("collapses duplicates — a plan compared with itself is a no-op column", () => {
    expect(readCompareParams(`?plans=${A},${A},${B}`).planIds).toEqual([A, B]);
  });

  it("ignores a stray baseline param — the concept no longer exists", () => {
    expect(readCompareParams(`?plans=${A},${B}&baseline=${B}`)).toEqual({ planIds: [A, B] });
  });

  it("yields an empty selection — the page's empty state, not an error", () => {
    expect(readCompareParams("")).toEqual({ planIds: [] });
    expect(readCompareParams("?plans=")).toEqual({ planIds: [] });
  });
});
