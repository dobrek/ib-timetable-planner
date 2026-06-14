import { describe, expect, it } from "vitest";
import { cohortLabel } from "./cohorts";

describe("cohortLabel", () => {
  it("maps cohorts to their school-year label", () => {
    expect(cohortLabel("dp1")).toBe("Year 1");
    expect(cohortLabel("dp2")).toBe("Year 2");
  });
});
