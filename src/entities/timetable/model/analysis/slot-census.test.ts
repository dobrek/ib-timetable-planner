import { describe, expect, it } from "vitest";
import { course } from "../__fixtures__/builders";
import { analyzed, block, row } from "./__fixtures__/builders";
import { deriveSlotCensus } from "./slot-census";

const cohort = [
  analyzed(course("math", "t1", ["s1", "s2", "s3", "s4"]), { name: "Math" }),
  analyzed(course("bio", "t2", ["s1", "s2"]), { name: "Biology" }),
  analyzed(course("art", "t3", ["s4"]), { name: "Art" }),
];

describe("deriveSlotCensus", () => {
  it("counts a cell's students as the union of its courses' enrolments", () => {
    // P1: math (s1..s4) + bio (s1,s2) → 4 distinct students, 2 parallel courses.
    const census = deriveSlotCensus(cohort, [row("dp1", "math", 1, 1), row("dp1", "bio", 1, 1)]);

    expect(census).toMatchObject({ cohortStudents: 4 });
    expect(census.studentsPerSlot).toMatchObject({ count: 1, max: 4 });
    expect(census.coursesPerSlot).toMatchObject({ max: 2 });
  });

  it("flags a thin slot and records WHERE it sits — the expert's deliberate edge doubles", () => {
    // Day 1: math P1–P2 (wide), art P3–P4 (1 of 4 students = 25% → thin, at the day's tail).
    const rows = [...block("dp1", "math", 1, 1, 2), ...block("dp1", "art", 1, 3, 2)];

    const census = deriveSlotCensus(cohort, rows);

    expect(census.thinSlots).toEqual([
      { day: 1, period: 3, students: 1, position: "interior" },
      { day: 1, period: 4, students: 1, position: "end" },
    ]);
  });

  it("leaves a wide slot out of the thin census", () => {
    const census = deriveSlotCensus(cohort, [row("dp1", "math", 2, 5)]);

    expect(census.thinSlots).toEqual([]);
  });

  it("collapses the two week lanes of one cell into a single slot", () => {
    const census = deriveSlotCensus(cohort, [row("dp1", "bio", 3, 8, "a"), row("dp1", "art", 3, 8, "b")]);

    expect(census.studentsPerSlot.count).toBe(1);
    expect(census.studentsPerSlot.max).toBe(3); // s1, s2 (bio) ∪ s4 (art)
  });

  it("reports an empty distribution for an unplaced cohort", () => {
    const census = deriveSlotCensus(cohort, []);

    expect(census.studentsPerSlot).toMatchObject({ count: 0, median: 0 });
    expect(census.thinSlots).toEqual([]);
  });
});

/** `s(1, 6)` → s1..s6. A 10-student cohort, so the 10% near-golden tolerance admits exactly one. */
const s = (first: number, last: number): string[] =>
  Array.from({ length: last - first + 1 }, (_, index) => `s${first + index}`);

const goldenCohort = [
  analyzed(course("eng-a", "t1", s(1, 6)), { name: "English A" }),
  analyzed(course("eng-b", "t2", s(7, 10)), { name: "English B" }),
  analyzed(course("tok", "t3", s(1, 9)), { name: "TOK" }), // 9/10 alone — one student short
  analyzed(course("hist", "t4", s(1, 8)), { name: "History" }), // 8/10 alone — two short
  analyzed(course("bm", "t5", s(1, 4)), { name: "BM" }),
  analyzed(course("german", "t6", s(5, 7)), { name: "German B" }),
  analyzed(course("tok2", "t7", s(8, 10)), { name: "TOK" }),
  analyzed(course("cas", "t8", s(7, 10)), { name: "CAS" }),
  analyzed(course("ee", "t9", s(7, 10)), { name: "EE" }),
];

describe("deriveSlotCensus — golden census", () => {
  it("counts a cell golden when its parallel occupants cover the whole cohort", () => {
    // The expert's canonical pair: English A ∥ English B — every student is in class at P5.
    const census = deriveSlotCensus(goldenCohort, [row("dp1", "eng-a", 1, 5), row("dp1", "eng-b", 1, 5)]);

    expect(census.goldenCensus.golden).toEqual([
      { day: 1, period: 5, courses: 2, students: 10, missing: 0, inBand: true },
    ]);
    expect(census.goldenCensus).toMatchObject({ composites: 0, meanPeriod: 5, goldenInBand: 1, bandShare: 1 });
  });

  it("admits a cell missing at most 10% of the cohort as near-golden, and nothing beyond it", () => {
    // TOK alone serves 9/10 (missing 1 — the expert's "1–2 students"); History 8/10 (missing 2 — too far).
    const census = deriveSlotCensus(goldenCohort, [row("dp1", "tok", 1, 4), row("dp1", "hist", 2, 4)]);

    expect(census.goldenCensus.golden).toEqual([]);
    expect(census.goldenCensus.nearGolden).toEqual([
      { day: 1, period: 4, courses: 1, students: 9, missing: 1, inBand: true },
    ]);
    expect(census.goldenCensus.missShare).toBe(0.1);
  });

  it("counts a golden cell of 3+ parallel courses as a composite", () => {
    const rows = [row("dp1", "bm", 2, 6), row("dp1", "german", 2, 6), row("dp1", "tok2", 2, 6)];

    const census = deriveSlotCensus(goldenCohort, rows);

    expect(census.goldenCensus.golden).toEqual([
      { day: 2, period: 6, courses: 3, students: 10, missing: 0, inBand: true },
    ]);
    expect(census.goldenCensus.composites).toBe(1);
  });

  it("scores each week lane on its own: a cell whose UNION covers everyone is not golden", () => {
    // English A in week a, English B in week b. Union = the whole cohort, but in week a four students
    // are free and in week b six are — nobody experiences a slot where everyone is in class.
    const rows = [row("dp1", "eng-a", 1, 5, "a"), row("dp1", "eng-b", 1, 5, "b")];

    const census = deriveSlotCensus(goldenCohort, rows);

    expect(census.goldenCensus.golden).toEqual([]);
    expect(census.goldenCensus.nearGolden).toEqual([]); // worst lane (b) serves 4 of 10
  });

  it("is golden when EACH lane completes the roster — the expert's biweekly composite", () => {
    // English A (both weeks) + CAS in week a + EE in week b: lane a and lane b each reach 10 of 10.
    const rows = [row("dp1", "eng-a", 5, 2), row("dp1", "cas", 5, 2, "a"), row("dp1", "ee", 5, 2, "b")];

    const census = deriveSlotCensus(goldenCohort, rows);

    expect(census.goldenCensus.golden).toEqual([
      { day: 5, period: 2, courses: 3, students: 10, missing: 0, inBand: false },
    ]);
    expect(census.goldenCensus).toMatchObject({ composites: 1, goldenInBand: 0, bandShare: 0 });
  });

  it("never counts a single-lane cell as golden — its students are free the other week", () => {
    const rows = [row("dp1", "eng-a", 1, 5, "a"), row("dp1", "eng-b", 1, 5, "a")];

    const census = deriveSlotCensus(goldenCohort, rows);

    expect(census.goldenCensus.golden).toEqual([]);
  });

  it("reports WHERE the golden cells sit — position, not count, is the discriminating signal", () => {
    // One golden pair at P3 (a day-tail-style outlier), one at P6 (inside the mid-day band).
    const rows = [
      row("dp1", "eng-a", 1, 3),
      row("dp1", "eng-b", 1, 3),
      row("dp1", "eng-a", 2, 6),
      row("dp1", "eng-b", 2, 6),
    ];

    const census = deriveSlotCensus(goldenCohort, rows);

    expect(census.goldenCensus.golden.map((cell) => cell.period)).toEqual([3, 6]);
    expect(census.goldenCensus).toMatchObject({
      meanPeriod: 4.5,
      goldenInBand: 1,
      bandShare: 0.5,
      band: { first: 4, last: 7 },
    });
  });

  it("reports an empty census for an unplaced cohort", () => {
    const census = deriveSlotCensus(goldenCohort, []);

    expect(census.goldenCensus).toMatchObject({
      golden: [],
      nearGolden: [],
      composites: 0,
      meanPeriod: 0,
      goldenInBand: 0,
      bandShare: 0,
    });
  });

  it("never reads a cell as golden when the cohort has no students at all", () => {
    const studentless = [analyzed(course("advisory", "t1"), { name: "Advisory" })];

    const census = deriveSlotCensus(studentless, [row("dp1", "advisory", 1, 5)]);

    expect(census.goldenCensus.golden).toEqual([]);
  });
});
