import { describe, expect, it } from "vitest";
import { computeGroupingsInput } from "./grouping-compute";

const UUID_A = "5c7cce84-0000-4000-8000-000000000001";
const UUID_B = "5c7cce84-0000-4000-8000-000000000002";

describe("computeGroupingsInput", () => {
  it("accepts well-formed UUIDs", () => {
    expect(computeGroupingsInput.safeParse({ planId: UUID_A, cohortId: UUID_B }).success).toBe(true);
  });

  it.each([
    ["planId", { planId: "not-a-uuid", cohortId: UUID_B }],
    ["cohortId", { planId: UUID_A, cohortId: 42 }],
  ])("rejects invalid %s", (_field, body) => {
    expect(computeGroupingsInput.safeParse(body).success).toBe(false);
  });
});
