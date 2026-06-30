import { describe, expect, it } from "vitest";
import {
  SUBJECT_COLOR_VALUES,
  SUBJECT_COLORS,
  subjectChipClass,
  subjectColorSchema,
  toSubjectColor,
} from "./subject-colors";

describe("subject-colors config", () => {
  it("exposes a display entry for every value, in order", () => {
    expect(SUBJECT_COLORS.map((option) => option.value)).toEqual([...SUBJECT_COLOR_VALUES]);
    for (const option of SUBJECT_COLORS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  describe("subjectColorSchema", () => {
    it("accepts every known key", () => {
      for (const value of SUBJECT_COLOR_VALUES) {
        expect(subjectColorSchema.parse(value)).toBe(value);
      }
    });

    it("rejects an unknown key", () => {
      expect(subjectColorSchema.safeParse("magenta").success).toBe(false);
    });
  });

  describe("toSubjectColor", () => {
    it("returns the key when it is a known member", () => {
      expect(toSubjectColor("rose")).toBe("rose");
      expect(toSubjectColor("indigo")).toBe("indigo");
    });

    it("coerces an unknown string or null to null", () => {
      expect(toSubjectColor("magenta")).toBeNull();
      expect(toSubjectColor("")).toBeNull();
      expect(toSubjectColor(null)).toBeNull();
    });
  });

  describe("subjectChipClass", () => {
    it("returns a non-empty paired literal for every value", () => {
      for (const value of SUBJECT_COLOR_VALUES) {
        const classes = subjectChipClass(value);
        expect(classes).toBe(`bg-subject-${value} text-subject-${value}-foreground`);
      }
    });

    it("returns an empty string for null", () => {
      expect(subjectChipClass(null)).toBe("");
    });
  });
});
