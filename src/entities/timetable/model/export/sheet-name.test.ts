import { describe, expect, it } from "vitest";
import { SHEET_NAME_MAX, courseSheetName, dedupeSheetNames, sanitizeSheetName } from "./sheet-name";

describe("sanitizeSheetName", () => {
  it("replaces the Excel-illegal set with a space and collapses whitespace", () => {
    expect(sanitizeSheetName("Math [HL]/DP:1*?\\x")).toBe("Math HL DP 1 x");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeSheetName("  Biology  ")).toBe("Biology");
  });

  it("leaves a clean name unchanged", () => {
    expect(sanitizeSheetName("Mathematics HL")).toBe("Mathematics HL");
  });

  it("strips leading and trailing apostrophes (Excel rejects them at the edges)", () => {
    expect(sanitizeSheetName("'Physics'")).toBe("Physics");
    expect(sanitizeSheetName("'' Chemistry ''")).toBe("Chemistry");
  });
});

describe("courseSheetName", () => {
  it("appends the ` · DPx` cohort suffix", () => {
    expect(courseSheetName("Mathematics HL", "dp1")).toBe("Mathematics HL · DP1");
    expect(courseSheetName("Mathematics HL", "dp2")).toBe("Mathematics HL · DP2");
  });

  it("truncates a long name but preserves the full suffix within 31 chars", () => {
    const name = courseSheetName("Mathematics Higher Level Analysis and Approaches", "dp2");
    expect(name.length).toBeLessThanOrEqual(SHEET_NAME_MAX);
    expect(name.endsWith(" · DP2")).toBe(true);
  });

  it("strips illegal characters before applying the suffix", () => {
    expect(courseSheetName("Sci/Bio", "dp1")).toBe("Sci Bio · DP1");
  });

  it("degrades to the bare cohort label when the name sanitizes to nothing (no leading-space tab)", () => {
    expect(courseSheetName("///", "dp1")).toBe("DP1");
    expect(courseSheetName("", "dp2")).toBe("DP2");
  });
});

describe("dedupeSheetNames", () => {
  it("leaves already-unique names untouched", () => {
    expect(dedupeSheetNames(["Math · DP1", "Bio · DP1"])).toEqual(["Math · DP1", "Bio · DP1"]);
  });

  it("appends ~2, ~3 to later collisions", () => {
    expect(dedupeSheetNames(["Math · DP1", "Math · DP1", "Math · DP1"])).toEqual([
      "Math · DP1",
      "Math · DP1~2",
      "Math · DP1~3",
    ]);
  });

  it("de-dupes case-insensitively (Excel folds case for uniqueness)", () => {
    expect(dedupeSheetNames(["Math", "math"])).toEqual(["Math", "math~2"]);
  });

  it("trims the base of a de-duplicated collision to keep it within 31 chars", () => {
    const long = "A".repeat(SHEET_NAME_MAX);
    const [first, second] = dedupeSheetNames([long, long]);
    expect(first).toBe(long);
    expect(second.length).toBeLessThanOrEqual(SHEET_NAME_MAX);
    expect(second.endsWith("~2")).toBe(true);
  });
});
