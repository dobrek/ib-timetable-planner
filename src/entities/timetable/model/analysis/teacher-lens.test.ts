import { describe, expect, it } from "vitest";
import type { BoardAvailabilityCell } from "../availability-index";
import { coTaught, course } from "../__fixtures__/builders";
import { analyzed, block, row } from "./__fixtures__/builders";
import { deriveTeacherLens } from "./teacher-lens";

const courses = [
  analyzed(course("dp1-math", "T1", ["s1"]), { name: "Math", hours: 4 }),
  analyzed(course("dp2-math", "T1", ["u1"]), { name: "Math", hours: 4 }),
  analyzed(coTaught("dp1-art", ["T2", "T3"], ["s1"]), { name: "Art", hours: 2 }),
];

describe("deriveTeacherLens", () => {
  it("merges a teacher's two cohorts into one day — teachers are one staffing system", () => {
    // T1 teaches dp1 at P1 and dp2 at P4 on day 1: one day, one span, 2 gap-slots per week lane.
    const rows = [row("dp1", "dp1-math", 1, 1), row("dp2", "dp2-math", 1, 4)];

    const lens = deriveTeacherLens(courses, rows, []);

    expect(lens.gapSlots).toBe(4); // (span 4 − 2 occupied) × 2 week lanes
    expect(lens.worstTeacherGaps).toEqual({ key: "T1", value: 4 });
    expect(lens.teachingDays.max).toBe(1);
  });

  it("counts a co-taught hour for every teacher of the course", () => {
    const lens = deriveTeacherLens(courses, block("dp1", "dp1-art", 2, 3, 2), []);

    expect(lens.teachers).toBe(3);
    expect(lens.hoursPerTeachingDay).toMatchObject({ count: 2, min: 2, max: 2 }); // T2 and T3, 2 h each
    expect(lens.maxConsecutiveTeaching.max).toBe(2);
  });

  it("localizes soft-availability hits to the teacher who took them", () => {
    const availability: BoardAvailabilityCell[] = [
      { teacherKey: "T1", day: 1, period: 1, severity: "soft" },
      { teacherKey: "T1", day: 2, period: 2, severity: "strong" },
    ];
    const rows = [row("dp1", "dp1-math", 1, 1), row("dp1", "dp1-math", 2, 2), row("dp1", "dp1-math", 3, 3)];

    const lens = deriveTeacherLens(courses, rows, availability);

    expect(lens).toMatchObject({ softAvailabilityHits: 1, strongAvailabilityHits: 1 });
    expect(lens.softHitsByTeacher).toEqual([{ key: "T1", value: 1 }]);
  });

  it("reports the expert's zero-hit board as clean", () => {
    const availability: BoardAvailabilityCell[] = [{ teacherKey: "T1", day: 5, period: 9, severity: "soft" }];

    const lens = deriveTeacherLens(courses, block("dp1", "dp1-math", 1, 1, 2), availability);

    expect(lens).toMatchObject({ softAvailabilityHits: 0, strongAvailabilityHits: 0, softHitsByTeacher: [] });
  });

  it("keeps an unscheduled teacher in the distribution at zero", () => {
    const lens = deriveTeacherLens(courses, [], []);

    expect(lens).toMatchObject({ teachers: 3, gapSlots: 0 });
    expect(lens.gapsPerTeacher).toMatchObject({ count: 3, max: 0 });
    expect(lens.teachingDays).toMatchObject({ count: 3, max: 0 });
  });
});
