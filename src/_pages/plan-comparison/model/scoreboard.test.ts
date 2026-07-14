import { describe, expect, it } from "vitest";
import { analyzePlan } from "@/entities/timetable";
import { COHORT_VALUES } from "@/shared/config";
import { BOARD_WIDE, COHORT_SCOREBOARD } from "./metric-catalog";
import { buildCohortSection, buildPlanSection, type AnalyzedPlan } from "./scoreboard";
import { buildLoadedPlan, SAMPLE, type PlanSpec } from "./__fixtures__/loaded-plan";

/** Distinct ids and names per plan, so a mis-assembled matrix shows up as the WRONG plan's column rather
 *  than as a plausible-looking number. */
const analyzed = (id: string, name: string, idPrefix: string): AnalyzedPlan => {
  const spec: PlanSpec = {
    ...SAMPLE,
    id,
    name,
    idPrefix,
    rows: [{ cohort: "dp1", courseId: `${idPrefix}-c-0`, day: 1, period: 1, week: "both" }],
  };
  const plan = buildLoadedPlan(spec);

  return { id: plan.id, name: plan.name, features: analyzePlan(plan.input), naturalKeys: plan.naturalKeys };
};

const expert = analyzed("plan-a", "Expert", "aaa");
const engine = analyzed("plan-b", "Engine", "bbb");
const draft = analyzed("plan-c", "Draft", "ccc");

describe("buildCohortSection", () => {
  // The scoreboard is per-cohort, so N plans is 2N columns — the readability ceiling the whole feature
  // is bounded by. N=3 is the case the render test does not exercise.
  it("lays out N plans as 2N columns, cohort-major within each plan", () => {
    const section = buildCohortSection("Cohort scoreboard", COHORT_SCOREBOARD, [expert, engine, draft]);

    expect(section.columns).toHaveLength(6);
    expect(section.columns.map((column) => [column.planName, column.cohort])).toEqual([
      ["Expert", "dp1"],
      ["Expert", "dp2"],
      ["Engine", "dp1"],
      ["Engine", "dp2"],
      ["Draft", "dp1"],
      ["Draft", "dp2"],
    ]);
  });

  // The one alignment that must never slip: cell[i] is column[i]. A row that emitted its cells in a
  // different order than the header would put one plan's numbers under another plan's name — a silent
  // misread, and the worst failure this page could have.
  it("emits exactly one cell per column, in column order, on every row", () => {
    const section = buildCohortSection("Cohort scoreboard", COHORT_SCOREBOARD, [expert, engine]);

    expect(section.columns).toHaveLength(4);
    for (const row of section.rows) expect(row.cells).toHaveLength(section.columns.length);
  });

  it("reads each cell from its own column's plan and cohort", () => {
    const [plans, cohorts] = [[expert, engine], COHORT_VALUES] as const;
    const section = buildCohortSection("Cohort scoreboard", COHORT_SCOREBOARD, [...plans]);
    const row = section.rows.find((candidate) => candidate.id === COHORT_SCOREBOARD[0].id);

    // Each cell must equal what the catalog row itself yields for that column's (plan, cohort) pair —
    // i.e. the section did no re-ordering, no re-use, and no cross-wiring of one plan's features.
    const expected = plans.flatMap((plan) => cohorts.map((cohort) => COHORT_SCOREBOARD[0].read(plan.features, cohort)));

    expect(row?.cells).toEqual(expected);
  });

  it("carries each row's id, label and help through untouched", () => {
    const section = buildCohortSection("Cohort scoreboard", COHORT_SCOREBOARD, [expert]);

    expect(section.title).toBe("Cohort scoreboard");
    expect(section.rows.map((row) => row.id)).toEqual(COHORT_SCOREBOARD.map((row) => row.id));
    expect(section.rows.map((row) => row.label)).toEqual(COHORT_SCOREBOARD.map((row) => row.label));
    expect(section.rows.map((row) => row.help)).toEqual(COHORT_SCOREBOARD.map((row) => row.help));
  });

  it("degenerates cleanly to a single plan — one plan's feature vector is still a page", () => {
    const section = buildCohortSection("Cohort scoreboard", COHORT_SCOREBOARD, [expert]);

    expect(section.columns).toHaveLength(2);
    for (const row of section.rows) expect(row.cells).toHaveLength(2);
  });
});

describe("buildPlanSection", () => {
  it("lays out N plans as N columns, with no cohort grain", () => {
    const section = buildPlanSection("Board-wide", BOARD_WIDE, [expert, engine, draft]);

    expect(section.columns.map((column) => column.planName)).toEqual(["Expert", "Engine", "Draft"]);
    expect(section.columns.every((column) => column.cohort === undefined)).toBe(true);
  });

  it("emits exactly one cell per column, in column order, on every row", () => {
    const section = buildPlanSection("Board-wide", BOARD_WIDE, [expert, engine, draft]);

    for (const row of section.rows) expect(row.cells).toHaveLength(3);
  });

  // The board-wide rows are the ones that LINK (worst teacher / worst student), and the link is
  // plan-scoped: it must land in the plan whose column you clicked, not in the first plan on the page.
  it("scopes each column's cell to its own plan, so a linked cell points at that plan", () => {
    const section = buildPlanSection("Board-wide", BOARD_WIDE, [expert, engine]);
    const linked = section.rows.filter((row) => row.cells.some((cell) => cell.href !== undefined));

    expect(linked.length).toBeGreaterThan(0);
    for (const row of linked) {
      expect(row.cells[0].href).toContain("/plans/plan-a/");
      expect(row.cells[1].href).toContain("/plans/plan-b/");
    }
  });
});
