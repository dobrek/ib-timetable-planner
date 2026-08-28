import { describe, expect, it } from "vitest";
import { isPendingProposal, isPlanId, isUuid, type PlanSummary } from "./load-plan-summary";

/**
 * The route-param guards and S-306's pending predicate — the pure half of this module. `loadPlanSummary`
 * itself is exercised by the integration suites, which have a database to resolve an id against.
 */
const summary = (over: Partial<PlanSummary> = {}): PlanSummary => ({
  id: "6f0d5b6e-6a3e-4c2b-9f7d-2b1b0a4f5c31",
  name: "Year 2026/27",
  slot_grid_preset: "5x8",
  pending_proposal: false,
  ...over,
});

describe("isUuid / isPlanId", () => {
  it("accepts a well-formed UUID in either case", () => {
    expect(isUuid("6f0d5b6e-6a3e-4c2b-9f7d-2b1b0a4f5c31")).toBe(true);
    expect(isPlanId("6F0D5B6E-6A3E-4C2B-9F7D-2B1B0A4F5C31")).toBe(true);
  });

  it("rejects undefined and anything that is not a UUID", () => {
    // The point of the guard: a raw non-UUID reaching a `.eq(\"id\", …)` makes PostgREST error, which
    // is a 500 where the honest answer is 404.
    for (const id of [undefined, "", "not-a-uuid", "6f0d5b6e-6a3e-4c2b-9f7d"]) {
      expect(isPlanId(id)).toBe(false);
    }
  });
});

describe("isPendingProposal", () => {
  it("is true only for a proposal whose board has not landed yet", () => {
    expect(isPendingProposal(summary({ pending_proposal: true }))).toBe(true);
    expect(isPendingProposal(summary())).toBe(false);
  });

  it("is the symbol every plan-scoped page greps for", () => {
    // Deliberately a trivial assertion over a trivial function. The roadmap names "a future
    // plan-scoped page forgets the guard" as this slice's residual risk, and a named predicate with a
    // test beside it is what makes the whole guard surface findable — a bare `plan.pending_proposal`
    // read scattered across seven routes would not be.
    expect(typeof isPendingProposal).toBe("function");
  });
});
