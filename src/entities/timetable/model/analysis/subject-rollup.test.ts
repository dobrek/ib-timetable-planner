import { describe, expect, it } from "vitest";
import { course } from "../__fixtures__/builders";
import { analyzed, block, row } from "./__fixtures__/builders";
import { deriveSubjectRollup } from "./subject-rollup";

const courses = [
  analyzed(course("dp1-sssts", "OT", ["s1"]), { name: "SSSTS", hours: 2 }),
  analyzed(course("dp1-chem", "KK", ["s1"]), { name: "Chemistry", level: "HL", hours: 2 }),
  analyzed(course("dp2-chem", "KK", ["u1"]), { name: "Chemistry", level: "SL", hours: 2 }),
];

describe("deriveSubjectRollup", () => {
  it("orders subjects by mean period — the expert's time-of-day gradient", () => {
    const rows = [
      ...block("dp1", "dp1-sssts", 3, 1, 2), // morning skills subject
      ...block("dp1", "dp1-chem", 1, 6, 2), // afternoon science
      ...block("dp2", "dp2-chem", 2, 8, 2),
    ];

    const rollup = deriveSubjectRollup(courses, rows);

    expect(rollup.map((subject) => subject.subject)).toEqual(["SSSTS", "Chemistry"]);
    expect(rollup[0]).toMatchObject({ subject: "SSSTS", meanPeriod: 1.5, courses: 1, placedHours: 2 });
    expect(rollup[1]).toMatchObject({ subject: "Chemistry", meanPeriod: 7.5, courses: 2, placedHours: 4 });
  });

  it("rolls both cohort editions of a subject into one row (the provisional `name` key)", () => {
    const rollup = deriveSubjectRollup(courses, [row("dp1", "dp1-chem", 1, 6), row("dp2", "dp2-chem", 1, 6)]);

    expect(rollup).toHaveLength(1);
    expect(rollup[0]).toMatchObject({ subject: "Chemistry", courses: 2, placedHours: 2 });
  });

  it("keeps adjacency at course grain — two editions of a subject never pair with each other", () => {
    // dp1-chem at P6 and dp2-chem at P7 are adjacent periods, but different students: not a double.
    const across = deriveSubjectRollup(courses, [row("dp1", "dp1-chem", 1, 6), row("dp2", "dp2-chem", 1, 7)]);
    // The same course across P6–P7 IS a double (counted in both week lanes).
    const within = deriveSubjectRollup(courses, block("dp1", "dp1-chem", 1, 6, 2));

    expect(across[0].adjacentPairs).toBe(0);
    expect(within[0]).toMatchObject({ adjacentPairs: 2, sameDaySplits: 0 });
  });

  it("takes a replaceable key function — the level split is one argument away", () => {
    const byNameAndLevel = deriveSubjectRollup(
      courses,
      [row("dp1", "dp1-chem", 1, 6), row("dp2", "dp2-chem", 1, 6)],
      (candidate) => `${candidate.name} ${candidate.level}`,
    );

    expect(byNameAndLevel.map((subject) => subject.subject)).toEqual(["Chemistry HL", "Chemistry SL"]);
  });

  it("lists no subjects for an unplaced board", () => {
    expect(deriveSubjectRollup(courses, [])).toEqual([]);
  });
});
