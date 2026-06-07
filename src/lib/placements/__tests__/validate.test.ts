import { describe, expect, it } from "vitest";
import { validatePlacementDelete, validatePlacementInsert } from "../validate";

const UUID_A = "5c7cce84-0000-4000-8000-000000000001";
const UUID_B = "5c7cce84-0000-4000-8000-000000000002";
const UUID_C = "5c7cce84-0000-4000-8000-000000000003";

const validBody = { variantId: UUID_A, cohortId: UUID_B, courseId: UUID_C, day: 3, period: 7 };

describe("validatePlacementInsert", () => {
  it("accepts a well-formed body and returns the typed row", () => {
    const result = validatePlacementInsert(validBody);
    expect(result).toEqual({ ok: true, row: validBody });
  });

  it("accepts the grid bounds (day 1..5, period 1..10)", () => {
    expect(validatePlacementInsert({ ...validBody, day: 1, period: 1 }).ok).toBe(true);
    expect(validatePlacementInsert({ ...validBody, day: 5, period: 10 }).ok).toBe(true);
  });

  it.each([
    ["variantId", { ...validBody, variantId: "not-a-uuid" }],
    ["cohortId", { ...validBody, cohortId: 42 }],
    ["courseId", { ...validBody, courseId: undefined }],
  ])("rejects a bad %s", (_field, body) => {
    expect(validatePlacementInsert(body).ok).toBe(false);
  });

  it.each([
    ["day below range", { ...validBody, day: 0 }],
    ["day above range", { ...validBody, day: 6 }],
    ["period below range", { ...validBody, period: 0 }],
    ["period above range", { ...validBody, period: 11 }],
    ["non-integer day", { ...validBody, day: 2.5 }],
  ])("rejects %s", (_label, body) => {
    expect(validatePlacementInsert(body).ok).toBe(false);
  });

  it.each([[null], [undefined], ["string"], [42], [[]]])("rejects non-record input %s", (input) => {
    expect(validatePlacementInsert(input).ok).toBe(false);
  });
});

describe("validatePlacementDelete", () => {
  it("accepts a body with a UUID id", () => {
    expect(validatePlacementDelete({ id: UUID_A })).toEqual({ ok: true, id: UUID_A });
  });

  it("rejects a missing or non-UUID id", () => {
    expect(validatePlacementDelete({}).ok).toBe(false);
    expect(validatePlacementDelete({ id: "nope" }).ok).toBe(false);
  });

  it("rejects non-record input", () => {
    expect(validatePlacementDelete(null).ok).toBe(false);
  });
});
