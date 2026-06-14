import { describe, expect, it } from "vitest";
import { formatCourseBadgeLabel, formatCourseRowBadgeLabel } from "./course-label";

describe("formatCourseBadgeLabel", () => {
  it("includes the level and circled group-index suffix", () => {
    expect(formatCourseBadgeLabel({ name: "Math", level: "HL", groupIndex: 2 })).toBe("Math HL②");
  });

  it("omits the level when 'none' and the suffix when groupIndex is 0", () => {
    expect(formatCourseBadgeLabel({ name: "Math", level: "none", groupIndex: 0 })).toBe("Math");
  });

  it("omits the suffix when groupIndex is beyond the circled-digit range", () => {
    expect(formatCourseBadgeLabel({ name: "Math", level: "SL", groupIndex: 9 })).toBe("Math SL");
  });
});

describe("formatCourseRowBadgeLabel", () => {
  it("bridges a snake_case catalog row to the label", () => {
    expect(formatCourseRowBadgeLabel({ name: "Bio", level: "HL", group_index: 1 })).toBe("Bio HL①");
  });
});
