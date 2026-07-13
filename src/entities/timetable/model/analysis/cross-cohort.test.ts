import { describe, expect, it } from "vitest";
import type { Cohort } from "@/shared/config";
import { biweekly, course } from "../__fixtures__/builders";
import { analyzed, row } from "./__fixtures__/builders";
import { deriveCrossCohort } from "./cross-cohort";
import type { AnalyzerCourse } from "./types";

const catalog = (dp1: AnalyzerCourse[], dp2: AnalyzerCourse[]): Record<Cohort, AnalyzerCourse[]> => ({ dp1, dp2 });

// The school skeleton, in miniature: Advisory runs in both cohorts at d3 P7 (one teacher each);
// SSSTS shares d3 P1 across cohorts on opposite week lanes (one teacher alternating).
const advisoryDp1 = analyzed(course("dp1-advisory", "KK", ["s1"]), { name: "Advisory", hours: 1 });
const advisoryDp2 = analyzed(course("dp2-advisory", "MD", ["u1"]), { name: "Advisory", hours: 1 });
const ssstsDp1 = analyzed(biweekly("dp1-sssts", "OT", ["s1"]), { name: "SSSTS", level: "SL", hours: 1 });
const ssstsDp2 = analyzed(biweekly("dp2-sssts", "OT", ["u1"]), { name: "SSSTS", level: "SL", hours: 1 });
const mathDp1 = analyzed(course("dp1-math", "OT", ["s1"]), { name: "Math", level: "HL", hours: 4 });
const mathDp2 = analyzed(course("dp2-math", "OT", ["u1"]), { name: "Math", level: "SL", hours: 4 });

const courses = catalog([advisoryDp1, ssstsDp1, mathDp1], [advisoryDp2, ssstsDp2, mathDp2]);

describe("deriveCrossCohort", () => {
  it("censuses the staffing overlap between the cohorts", () => {
    const features = deriveCrossCohort(courses, []);

    expect(features).toMatchObject({ teachers: 3, teachersInBothCohorts: 1 }); // OT teaches both
  });

  it("detects the mirrored cells — the school's fixtures, found automatically", () => {
    const rows = [
      row("dp1", "dp1-advisory", 3, 7),
      row("dp2", "dp2-advisory", 3, 7),
      row("dp1", "dp1-sssts", 3, 1, "a"),
      row("dp2", "dp2-sssts", 3, 1, "b"),
      row("dp1", "dp1-math", 1, 5),
      row("dp2", "dp2-math", 1, 5),
    ];

    const { mirroredCells } = deriveCrossCohort(courses, rows);

    // Advisory (same cell, both weeks) and SSSTS (same cell, OPPOSITE weeks — mirrored all the same).
    // Math is NOT mirrored: same name, but HL in dp1 and SL in dp2 is a different subject edition.
    expect(mirroredCells).toEqual([
      { name: "SSSTS", level: "SL", day: 3, period: 1, courseIds: { dp1: "dp1-sssts", dp2: "dp2-sssts" } },
      { name: "Advisory", level: "none", day: 3, period: 7, courseIds: { dp1: "dp1-advisory", dp2: "dp2-advisory" } },
    ]);
  });

  it("ignores a cell only one cohort uses", () => {
    const rows = [row("dp1", "dp1-advisory", 3, 7), row("dp2", "dp2-advisory", 4, 7)];

    expect(deriveCrossCohort(courses, rows).mirroredCells).toEqual([]);
  });

  it("separates a seamless hand-off from a gapped cohort switch", () => {
    // OT: dp1 math at P1, dp2 math at P2 → a switch, taken back-to-back.
    const seamless = deriveCrossCohort(courses, [row("dp1", "dp1-math", 1, 1), row("dp2", "dp2-math", 1, 2)]);
    // OT: dp1 math at P1, dp2 math at P5 → a switch across an idle gap.
    const gapped = deriveCrossCohort(courses, [row("dp1", "dp1-math", 1, 1), row("dp2", "dp2-math", 1, 5)]);

    expect(seamless).toMatchObject({ cohortSwitches: 2, seamlessSwitches: 2, seamlessShare: 1 });
    expect(gapped).toMatchObject({ cohortSwitches: 2, seamlessSwitches: 0, seamlessShare: 0 });
  });

  it("does not read the SSSTS week alternation as a switch — the weeks never meet", () => {
    const rows = [row("dp1", "dp1-sssts", 3, 1, "a"), row("dp2", "dp2-sssts", 3, 1, "b")];

    expect(deriveCrossCohort(courses, rows).cohortSwitches).toBe(0);
  });

  it("counts a teacher's day as cohort-pure only when every hour serves one cohort", () => {
    const rows = [
      row("dp1", "dp1-math", 1, 1), // OT: dp1 only on day 1 → pure
      row("dp1", "dp1-math", 2, 1), // OT: both cohorts on day 2 → mixed
      row("dp2", "dp2-math", 2, 3),
      row("dp1", "dp1-advisory", 1, 7), // KK: dp1 only → pure
    ];

    const features = deriveCrossCohort(courses, rows);

    expect(features).toMatchObject({ teacherDays: 3, cohortPureTeacherDays: 2 });
    expect(features.cohortPureShare).toBeCloseTo(2 / 3);
  });

  it("counts the days a teacher runs both editions of one subject", () => {
    const rows = [
      row("dp1", "dp1-math", 1, 1),
      row("dp2", "dp2-math", 1, 6), // OT teaches both Math editions on day 1
      row("dp1", "dp1-math", 2, 1),
      row("dp2", "dp2-math", 3, 6), // …and keeps them apart on days 2 and 3
    ];

    expect(deriveCrossCohort(courses, rows).sharedSubjectEditionDays).toBe(1);
  });

  it("reports an empty board without dividing by zero", () => {
    expect(deriveCrossCohort(courses, [])).toMatchObject({
      teacherDays: 0,
      cohortPureShare: 0,
      cohortSwitches: 0,
      seamlessShare: 0,
      mirroredCells: [],
    });
  });
});
