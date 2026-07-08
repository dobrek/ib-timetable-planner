import { describe, expect, it } from "vitest";
import { exportFileName } from "./export-file-name";

describe("exportFileName", () => {
  it("slugifies the plan name and appends the view", () => {
    expect(exportFileName("IB 2027 draft", "combined")).toBe("ib-2027-draft-combined.xlsx");
  });

  it("collapses runs of non-alphanumerics to a single dash", () => {
    expect(exportFileName("Plan   #2 (final!!)", "dp1")).toBe("plan-2-final-dp1.xlsx");
  });

  it("trims leading and trailing separators", () => {
    expect(exportFileName("  ***Draft***  ", "dp2")).toBe("draft-dp2.xlsx");
  });

  it("falls back to 'plan' when the name has no alphanumerics", () => {
    expect(exportFileName("!!!", "combined")).toBe("plan-combined.xlsx");
    expect(exportFileName("", "dp1")).toBe("plan-dp1.xlsx");
  });
});
