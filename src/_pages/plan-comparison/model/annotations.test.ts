import { describe, expect, it } from "vitest";
import { analyzePlan } from "@/entities/timetable";
import { completenessAnnotations, resolveExtremes } from "./annotations";
import { COHORT_SCOREBOARD } from "./metric-catalog";
import { buildLoadedPlan, SAMPLE, type PlanSpec } from "./__fixtures__/loaded-plan";

const analyze = (spec: PlanSpec) => {
  const plan = buildLoadedPlan(spec);
  return { plan, features: analyzePlan(plan.input) };
};

describe("completenessAnnotations", () => {
  /**
   * THE invariant (`plan-report.ts:96`): a slot count is only readable next to its hour accounting. An
   * incomplete board trivially uses fewer slots — which is exactly how the engine's 5 abandoned hours
   * once read as a "better" slot count than the expert's complete board.
   */
  it("names an incomplete cohort, and says the slot count is FLATTERED", () => {
    // Maths asks for 4 hours; only 1 is placed. Three go missing.
    const { plan, features } = analyze({
      ...SAMPLE,
      rows: [{ cohort: "dp1", courseId: "p1-c-0", day: 1, period: 1, week: "both" }],
    });

    const annotations = completenessAnnotations(plan, features);
    const incomplete = annotations.find((annotation) => annotation.kind === "incomplete");

    expect(incomplete?.cohort).toBe("dp1");
    expect(incomplete?.message).toContain("INCOMPLETE");
    expect(incomplete?.message).toContain("flattered");
    // Named by SUBJECT, not by UUID — this is a sentence a timetabler reads.
    expect(incomplete?.message).toContain("Maths HL −3h");
  });

  it("is impossible to render a slot count without one: any unplaced hour yields an annotation", () => {
    const { plan, features } = analyze({
      ...SAMPLE,
      rows: [{ cohort: "dp1", courseId: "p1-c-0", day: 1, period: 1, week: "both" }],
    });

    // The scoreboard carries a slot count…
    expect(COHORT_SCOREBOARD.some((row) => row.id === "occupiedSlots")).toBe(true);
    expect(features.cohorts.dp1.completeness.unplacedHours).toBeGreaterThan(0);
    // …so the data the UI renders beneath it must be non-empty.
    expect(completenessAnnotations(plan, features).length).toBeGreaterThan(0);
  });

  it("reports over-placed hours SEPARATELY from unplaced ones — the two never net out", () => {
    // Physics asks for 2 hours; 4 are placed. Maths (4h) gets none.
    const { plan, features } = analyze({
      ...SAMPLE,
      rows: [
        { cohort: "dp1", courseId: "p1-c-1", day: 1, period: 1, week: "both" },
        { cohort: "dp1", courseId: "p1-c-1", day: 1, period: 2, week: "both" },
        { cohort: "dp1", courseId: "p1-c-1", day: 2, period: 1, week: "both" },
        { cohort: "dp1", courseId: "p1-c-1", day: 2, period: 2, week: "both" },
      ],
    });

    const annotations = completenessAnnotations(plan, features);
    const kinds = annotations.map((annotation) => annotation.kind);

    // Netting +2 over against −4 under would erase both. It is the gold plan's Chemistry finding.
    expect(kinds).toContain("incomplete");
    expect(kinds).toContain("overplaced");
    expect(annotations.find((a) => a.kind === "overplaced")?.message).toContain("Physics SL 4/2h");
  });

  it("says nothing about a cohort whose hours balance", () => {
    const { plan, features } = analyze({
      ...SAMPLE,
      courses: [{ name: "Maths", level: "HL", groupIndex: 5, hours: 1, teachers: ["AB"], students: ["Alan Turing"] }],
      rows: [{ cohort: "dp1", courseId: "p1-c-0", day: 1, period: 1, week: "both" }],
    });

    expect(completenessAnnotations(plan, features)).toEqual([]);
  });
});

describe("resolveExtremes", () => {
  it("renders the worst teacher and worst student as NAMES, never as UUIDs", () => {
    // Ada teaches Maths on day 1 P1 and Physics on day 1 P5 — a gap-ridden day. Alan sits both.
    const { plan, features } = analyze({
      ...SAMPLE,
      courses: [
        { name: "Maths", level: "HL", groupIndex: 5, hours: 2, teachers: ["AB"], students: ["Alan Turing"] },
        { name: "Physics", level: "SL", groupIndex: 4, hours: 2, teachers: ["AB"], students: ["Alan Turing"] },
      ],
      rows: [
        { cohort: "dp1", courseId: "p1-c-0", day: 1, period: 1, week: "both" },
        { cohort: "dp1", courseId: "p1-c-1", day: 1, period: 5, week: "both" },
      ],
    });

    const extremes = resolveExtremes(features, plan.naturalKeys);

    expect(extremes.worstTeacherGaps?.name).toBe("Ada Byron");
    expect(extremes.worstTeacherGaps?.name).not.toMatch(/^p1-t-/);
    expect(extremes.worstStudentGaps?.name).toBe("Alan Turing");
    expect(extremes.worstStudentGaps?.name).not.toMatch(/^p1-s-/);
  });

  it("falls back to a teacher's code when they have no full name — a code is still human-readable", () => {
    const { plan, features } = analyze({
      ...SAMPLE,
      teachers: [{ code: "CD", fullName: null }],
      courses: [
        { name: "Maths", level: "HL", hours: 2, teachers: ["CD"], students: ["Alan Turing"] },
        { name: "Physics", level: "SL", hours: 2, teachers: ["CD"], students: ["Alan Turing"] },
      ],
      rows: [
        { cohort: "dp1", courseId: "p1-c-0", day: 1, period: 1, week: "both" },
        { cohort: "dp1", courseId: "p1-c-1", day: 1, period: 5, week: "both" },
      ],
    });

    expect(resolveExtremes(features, plan.naturalKeys).worstTeacherGaps?.name).toBe("CD");
  });

  // A board with people but no gaps has a worst case OF ZERO — that is a real answer, and the
  // analyzer says so. "Nobody at all" is the different case, and the one that must not be dressed up.
  it("passes a null extreme through rather than inventing a name for nobody", () => {
    const { plan, features } = analyze({ teachers: [], students: [], courses: [], rows: [] });

    const extremes = resolveExtremes(features, plan.naturalKeys);

    expect(extremes.worstTeacherGaps).toBeNull();
    expect(extremes.worstStudentGaps).toBeNull();
    expect(extremes.softHitsByTeacher).toEqual([]);
  });

  it("reports a gapless teacher as a worst case of zero — an answer, not an absence", () => {
    const { plan, features } = analyze({ ...SAMPLE, rows: [] });

    expect(resolveExtremes(features, plan.naturalKeys).worstTeacherGaps).toEqual({ name: "Ada Byron", value: 0 });
  });
});
