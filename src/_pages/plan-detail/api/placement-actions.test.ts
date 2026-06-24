import { describe, expect, it } from "vitest";
import { moveBundleMembersInput, placeCourseInput, removeBundleMembersInput } from "./placements";

const UUID_A = "5c7cce84-0000-4000-8000-000000000001";
const UUID_B = "5c7cce84-0000-4000-8000-000000000002";
const UUID_C = "5c7cce84-0000-4000-8000-000000000003";

describe("placeCourseInput", () => {
  it("accepts a well-formed body and defaults week to both", () => {
    const result = placeCourseInput.safeParse({ planId: UUID_A, cohort: "dp1", courseId: UUID_C, day: 3, period: 7 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.week).toBe("both");
  });

  it("accepts grid bounds (day 1..7, period 1..12 — the DB check constraints)", () => {
    expect(
      placeCourseInput.safeParse({ planId: UUID_A, cohort: "dp1", courseId: UUID_C, day: 1, period: 1 }).success,
    ).toBe(true);
    expect(
      placeCourseInput.safeParse({ planId: UUID_A, cohort: "dp2", courseId: UUID_C, day: 7, period: 12 }).success,
    ).toBe(true);
  });

  it.each([
    ["planId", { planId: "not-a-uuid", cohort: "dp1", courseId: UUID_C, day: 3, period: 7 }],
    ["cohort", { planId: UUID_A, cohort: "dp3", courseId: UUID_C, day: 3, period: 7 }],
    ["day below range", { planId: UUID_A, cohort: "dp1", courseId: UUID_C, day: 0, period: 7 }],
    ["day above range", { planId: UUID_A, cohort: "dp1", courseId: UUID_C, day: 8, period: 7 }],
    ["period above range", { planId: UUID_A, cohort: "dp1", courseId: UUID_C, day: 3, period: 13 }],
  ])("rejects invalid %s", (_label, body) => {
    expect(placeCourseInput.safeParse(body).success).toBe(false);
  });
});

describe("moveBundleMembersInput", () => {
  const valid = {
    planId: UUID_A,
    cohort: "dp1",
    day: 1,
    period: 1,
    courseIds: [UUID_B, UUID_C],
    targetDay: 2,
    targetPeriod: 3,
  };

  it("accepts a well-formed member-set move", () => {
    expect(moveBundleMembersInput.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty member set", () => {
    expect(moveBundleMembersInput.safeParse({ ...valid, courseIds: [] }).success).toBe(false);
  });

  it("rejects a non-UUID member id", () => {
    expect(moveBundleMembersInput.safeParse({ ...valid, courseIds: ["nope"] }).success).toBe(false);
  });

  it("rejects an out-of-range target cell", () => {
    expect(moveBundleMembersInput.safeParse({ ...valid, targetPeriod: 13 }).success).toBe(false);
  });
});

describe("removeBundleMembersInput", () => {
  const valid = { planId: UUID_A, cohort: "dp1", day: 1, period: 1, courseIds: [UUID_B] };

  it("accepts a well-formed member-set remove", () => {
    expect(removeBundleMembersInput.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty member set", () => {
    expect(removeBundleMembersInput.safeParse({ ...valid, courseIds: [] }).success).toBe(false);
  });
});
