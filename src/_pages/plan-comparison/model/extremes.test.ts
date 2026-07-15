import { describe, expect, it } from "vitest";
import { analyzePlan } from "@/entities/timetable";
import { worstStudentCell, worstTeacherCell } from "./extremes";
import { buildLoadedPlan, SAMPLE, type PlanSpec } from "./__fixtures__/loaded-plan";

const analyze = (spec: PlanSpec) => {
  const plan = buildLoadedPlan(spec);
  return {
    features: analyzePlan(plan.input),
    context: { planId: plan.id, naturalKeys: plan.naturalKeys },
  };
};

/** Ada teaches Maths on day 1 P1 and Physics on day 1 P5 — a gap-ridden day. Alan sits both. */
const GAPPY: PlanSpec = {
  ...SAMPLE,
  courses: [
    { name: "Maths", level: "HL", groupIndex: 5, hours: 2, teachers: ["AB"], students: ["Alan Turing"] },
    { name: "Physics", level: "SL", groupIndex: 4, hours: 2, teachers: ["AB"], students: ["Alan Turing"] },
  ],
  rows: [
    { cohort: "dp1", courseId: "p1-c-0", day: 1, period: 1, week: "both" },
    { cohort: "dp1", courseId: "p1-c-1", day: 1, period: 5, week: "both" },
  ],
};

describe("worst-case cells", () => {
  it("names the worst teacher and worst student — never a UUID", () => {
    const { features, context } = analyze(GAPPY);

    expect(worstTeacherCell(features, context).text).toMatch(/^Ada Byron: \d/);
    expect(worstTeacherCell(features, context).text).not.toMatch(/p1-t-/);
    expect(worstStudentCell(features, context).text).toMatch(/^Alan Turing: /);
    expect(worstStudentCell(features, context).text).not.toMatch(/p1-s-/);
  });

  // The gap that recurs every week is lived in both weeks: the P2–P4 hole on Ada's all-`both` day is a
  // fortnight span of 5 − 2 = 3 holes per week lane, so the total reads 6 and the single week reads 3.
  // Showing both is the whole point — the fortnight total is what looked like a doubling bug.
  it("shows the fortnight total and the busier single week for an all-weekly schedule", () => {
    const { features, context } = analyze(GAPPY);

    expect(worstTeacherCell(features, context).text).toBe("Ada Byron: 6 (3 / week)");
    expect(worstStudentCell(features, context).text).toBe("Alan Turing: 6 (3 / week)");
  });

  // No fortnight/week split to show when the schedule never repeats across the cycle: a purely week-A
  // board has empty week-B lanes, so the total IS one week and the "(N / week)" gloss would be noise.
  it("omits the per-week gloss when the total already is one week", () => {
    const { features, context } = analyze({
      ...GAPPY,
      rows: [
        { cohort: "dp1", courseId: "p1-c-0", day: 1, period: 1, week: "a" },
        { cohort: "dp1", courseId: "p1-c-1", day: 1, period: 5, week: "a" },
      ],
    });

    expect(worstTeacherCell(features, context).text).toBe("Ada Byron: 3");
  });

  /**
   * The number says WHO; the link says WHY. A worst case is only actionable if you can get to the
   * timetable that produced it, and the analyzer's key is exactly the id those routes are keyed by —
   * so the id we stopped printing is the one we now navigate with.
   */
  it("links each worst case to that person's timetable IN THAT PLAN", () => {
    const { features, context } = analyze(GAPPY);
    const teacherId = Object.keys(context.naturalKeys.teachers)[0];
    const studentId = Object.keys(context.naturalKeys.students)[0];

    expect(worstTeacherCell(features, context).href).toBe(`/plans/${context.planId}/teachers/${teacherId}`);
    expect(worstStudentCell(features, context).href).toBe(`/plans/${context.planId}/students/${studentId}`);
  });

  it("falls back to a teacher's code when they have no full name — a code is still human-readable", () => {
    const { features, context } = analyze({
      ...GAPPY,
      teachers: [{ code: "CD", fullName: null }],
      courses: GAPPY.courses?.map((course) => ({ ...course, teachers: ["CD"] })),
    });

    expect(worstTeacherCell(features, context).text).toMatch(/^CD: /);
  });

  // A board with people but no gaps has a worst case OF ZERO — that is a real answer, and the analyzer
  // says so. "Nobody at all" is the different case, and the one that must not be dressed up as zero.
  it("reports a gapless teacher as a worst case of zero — an answer, not an absence", () => {
    const { features, context } = analyze({ ...SAMPLE, rows: [] });

    expect(worstTeacherCell(features, context).text).toBe("Ada Byron: 0");
  });

  it("renders nobody-at-all as an em dash, and gives it nowhere to go", () => {
    const { features, context } = analyze({ teachers: [], students: [], courses: [], rows: [] });

    expect(worstTeacherCell(features, context)).toEqual({ text: "—" });
    expect(worstStudentCell(features, context)).toEqual({ text: "—" });
  });
});
