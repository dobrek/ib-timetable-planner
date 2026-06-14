import { describe, expect, it } from "vitest";
import { periodLabel } from "./period-label";

describe("periodLabel", () => {
  it("prefixes the period number with P", () => {
    expect(periodLabel(3)).toBe("P3");
  });
});
