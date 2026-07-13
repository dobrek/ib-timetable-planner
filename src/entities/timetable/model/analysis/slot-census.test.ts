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
