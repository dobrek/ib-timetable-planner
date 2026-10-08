import { describe, expect, it } from "vitest";
import { GOLDEN_BAND, GOLDEN_COVERAGE } from "./golden-sets";

describe("GOLDEN_BAND", () => {
  it("is the expert's mid-day band, P4–P7", () => {
    expect(GOLDEN_BAND).toEqual({ first: 4, last: 7 });
  });
});

describe("GOLDEN_COVERAGE", () => {
  it("is the expert's tolerance, at most 10% of the cohort missing (G1)", () => {
    expect(GOLDEN_COVERAGE).toBe(0.9);
  });
});
