import { describe, expect, it } from "vitest";
import { biweekly, course } from "../__fixtures__/builders";
import { countStudentHoles } from "../generation/objective";
import { analyzed, block, row } from "./__fixtures__/builders";
import { deriveStudentLens } from "./student-lens";

const PERIODS = 10;

const cohort = [
  analyzed(course("math", "t1", ["s1", "s2"]), { name: "Math", hours: 4 }),
  analyzed(course("bio", "t2", ["s1"]), { name: "Biology", hours: 2 }),
  analyzed(biweekly("cas", "t3", ["s2"]), { name: "CAS", hours: 1 }),
];

describe("deriveStudentLens", () => {
  it("totals student gaps exactly as the objective's countStudentHoles does (parity pin)", () => {
    // Every shape the fold has to agree on: a gapped day, a packed day, a biweekly single-lane row,
    // a shared period, and a student with two courses on one day.
    const rows = [
      row("dp1", "math", 1, 1),
      row("dp1", "bio", 1, 4),
      ...block("dp1", "math", 2, 3, 2),
      row("dp1", "cas", 3, 2, "a"),
      row("dp1", "math", 3, 7),
    ];

    const lens = deriveStudentLens(cohort, rows, PERIODS);

    expect(lens.gapSlots).toBe(countStudentHoles(cohort, rows));
    expect(lens.gapSlots).toBeGreaterThan(0);
  });

  it("attributes gaps to the student who suffers them", () => {
    // s1 takes math + bio: P1 then P4 → 2 holes per week lane → 4. s2 takes math only → no gap.
    const rows = [row("dp1", "math", 1, 1), row("dp1", "bio", 1, 4)];

    const lens = deriveStudentLens(cohort, rows, PERIODS);

    expect(lens.gapSlots).toBe(4);
    // value is the fortnight total (holes 2 × both week lanes); perWeek is one week's 2.
    expect(lens.worstStudentGaps).toEqual({ key: "s1", value: 4, perWeek: 2 });
    expect(lens.gapsPerStudent).toMatchObject({ count: 2, max: 4, min: 0 });
  });

  it("counts a one-lesson student-day in each week it happens", () => {
    // An agnostic single lesson runs in both weeks; a biweekly one runs in one.
    const agnostic = deriveStudentLens(cohort, [row("dp1", "math", 1, 3)], PERIODS);
    const singleLane = deriveStudentLens(cohort, [row("dp1", "cas", 1, 3, "a")], PERIODS);

    expect(agnostic.singleLessonDays).toBe(4); // 2 students × 2 week lanes
    expect(singleLane.singleLessonDays).toBe(1); // 1 student, week A only
  });

  it("reads a compact day as fully span-efficient and a gapped one as not", () => {
    const compact = deriveStudentLens(cohort, block("dp1", "math", 1, 1, 3), PERIODS);
    const gapped = deriveStudentLens(cohort, [row("dp1", "math", 1, 1), row("dp1", "math", 1, 5)], PERIODS);

    expect(compact.spanEfficiency.min).toBe(1);
    expect(compact.maxConsecutiveHours.max).toBe(3);
    expect(gapped.spanEfficiency.max).toBe(0.4); // 2 hours across a span of 5
  });

  it("measures each student-day's distance from the day's edges", () => {
    const lens = deriveStudentLens(cohort, [row("dp1", "bio", 2, 3), row("dp1", "bio", 2, 8)], PERIODS);

    expect(lens.earlyStarts.max).toBe(2); // starts at P3 → 2 free periods before
    expect(lens.lateFinishes.max).toBe(2); // ends at P8 → 2 free periods after
  });

  it("counts days on campus once per day, whichever week the lesson runs", () => {
    const rows = [row("dp1", "cas", 1, 2, "a"), row("dp1", "math", 1, 3), row("dp1", "math", 4, 3)];

    // s2 (math + cas) is in on days 1 and 4; s1 (math) on days 1 and 4 too.
    expect(deriveStudentLens(cohort, rows, PERIODS).daysOnCampus).toMatchObject({ min: 2, max: 2 });
  });

  it("keeps a stranded student in the distribution when the board is empty", () => {
    const lens = deriveStudentLens(cohort, [], PERIODS);

    expect(lens).toMatchObject({ students: 2, gapSlots: 0, singleLessonDays: 0 });
    expect(lens.gapsPerStudent.count).toBe(2);
  });
});
