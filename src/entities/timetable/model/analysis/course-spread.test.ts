import { describe, expect, it } from "vitest";
import { block, row } from "./__fixtures__/builders";
import { deriveCourseSpread } from "./course-spread";

describe("deriveCourseSpread", () => {
  it("counts the distinct days each course uses, not its hours", () => {
    // chem: three doubles across three days (the expert's shape); math: four singles, four days.
    const rows = [
      ...block("dp1", "chem", 1, 9, 2),
      ...block("dp1", "chem", 2, 1, 2),
      ...block("dp1", "chem", 4, 7, 2),
      row("dp1", "math", 1, 1),
      row("dp1", "math", 2, 3),
      row("dp1", "math", 3, 3),
      row("dp1", "math", 4, 3),
    ];

    const spread = deriveCourseSpread(rows);

    expect(spread).toMatchObject({ placedCourses: 2, multiDayCourses: 2 });
    expect(spread.daysUsed).toMatchObject({ min: 3, max: 4 });
  });

  it("leaves a single-day course out of the multi-day count", () => {
    expect(deriveCourseSpread(block("dp1", "cas", 3, 8, 2)).multiDayCourses).toBe(0);
  });

  it("reports each course's mean period — the raw material for the time-of-day gradient", () => {
    const rows = [row("dp1", "ssst", 1, 1), row("dp1", "ssst", 2, 2), row("dp1", "tok", 1, 6), row("dp1", "tok", 2, 8)];

    expect(deriveCourseSpread(rows).meanPeriodByCourse).toEqual([
      { courseId: "ssst", meanPeriod: 1.5 },
      { courseId: "tok", meanPeriod: 7 },
    ]);
  });

  it("reports an unplaced cohort as empty rather than throwing", () => {
    expect(deriveCourseSpread([])).toMatchObject({ placedCourses: 0, multiDayCourses: 0, meanPeriodByCourse: [] });
  });
});
