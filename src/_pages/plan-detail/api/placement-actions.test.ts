import { describe, expect, it } from "vitest";
import { createPlacementInput, deletePlacementInput } from "./placements";

const UUID_A = "5c7cce84-0000-4000-8000-000000000001";
const UUID_B = "5c7cce84-0000-4000-8000-000000000002";
const UUID_C = "5c7cce84-0000-4000-8000-000000000003";

describe("createPlacementInput", () => {
  it("accepts a well-formed body", () => {
    const result = createPlacementInput.safeParse({
      variantId: UUID_A,
      cohortId: UUID_B,
      courseId: UUID_C,
      day: 3,
      period: 7,
    });
    expect(result.success).toBe(true);
  });

  it("accepts grid bounds (day 1..5, period 1..10)", () => {
    expect(
      createPlacementInput.safeParse({ variantId: UUID_A, cohortId: UUID_B, courseId: UUID_C, day: 1, period: 1 })
        .success,
    ).toBe(true);
    expect(
      createPlacementInput.safeParse({ variantId: UUID_A, cohortId: UUID_B, courseId: UUID_C, day: 5, period: 10 })
        .success,
    ).toBe(true);
  });

  it.each([
    ["variantId", { variantId: "not-a-uuid", cohortId: UUID_B, courseId: UUID_C, day: 3, period: 7 }],
    ["day below range", { variantId: UUID_A, cohortId: UUID_B, courseId: UUID_C, day: 0, period: 7 }],
    ["period above range", { variantId: UUID_A, cohortId: UUID_B, courseId: UUID_C, day: 3, period: 11 }],
  ])("rejects invalid %s", (_label, body) => {
    expect(createPlacementInput.safeParse(body).success).toBe(false);
  });
});

describe("deletePlacementInput", () => {
  it("accepts a UUID id", () => {
    expect(deletePlacementInput.safeParse({ id: UUID_A }).success).toBe(true);
  });

  it("rejects a non-UUID id", () => {
    expect(deletePlacementInput.safeParse({ id: "nope" }).success).toBe(false);
  });
});
