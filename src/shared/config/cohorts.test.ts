import { describe, expect, it } from "vitest";
import { cohortLabel } from "./cohorts";

describe("cohortLabel", () => {
  it("maps cohorts to their display label", () => {
    expect(cohortLabel("dp1")).toBe("DP1");
    expect(cohortLabel("dp2")).toBe("DP2");
  });
});
