import { describe, expect, it } from "vitest";
import { computeGroupingsInput } from "./grouping-compute";

const UUID_A = "5c7cce84-0000-4000-8000-000000000001";

describe("computeGroupingsInput", () => {
  it("accepts a well-formed plan id + cohort", () => {
    expect(computeGroupingsInput.safeParse({ planId: UUID_A, cohort: "dp2" }).success).toBe(true);
  });

  it.each([
    ["planId", { planId: "not-a-uuid", cohort: "dp1" }],
    ["cohort", { planId: UUID_A, cohort: "dp3" }],
  ])("rejects invalid %s", (_field, body) => {
    expect(computeGroupingsInput.safeParse(body).success).toBe(false);
  });
});
