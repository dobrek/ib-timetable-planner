import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { buildComparisonData, type PlanComparisonData } from "../api/load-comparison";
import { buildLoadedPlan, SAMPLE, type PlanSpec } from "../model/__fixtures__/loaded-plan";
import PlanComparisonPage from "./PlanComparisonPage";

const OPTIONS = [
  { id: "base-plan", name: "Expert" },
  { id: "other-plan", name: "Engine" },
];

/** Baseline: Maths (4h) placed twice, so dp1 is INCOMPLETE — the completeness invariant has something
 *  real to say. Comparand: an identical catalog (a clone) with one extra placement. */
const baselineSpec: PlanSpec = {
  ...SAMPLE,
  id: "base-plan",
  name: "Expert",
  idPrefix: "base",
  rows: [
    { cohort: "dp1", courseId: "base-c-0", day: 1, period: 1, week: "both" },
    { cohort: "dp1", courseId: "base-c-0", day: 1, period: 2, week: "both" },
  ],
};

const cloneSpec: PlanSpec = {
  ...SAMPLE,
  id: "other-plan",
  name: "Engine",
  idPrefix: "cln",
  rows: [
    { cohort: "dp1", courseId: "cln-c-0", day: 1, period: 1, week: "both" },
    { cohort: "dp1", courseId: "cln-c-0", day: 1, period: 2, week: "both" },
    { cohort: "dp1", courseId: "cln-c-1", day: 3, period: 5, week: "both" },
  ],
};

const build = (other: PlanSpec) =>
  buildComparisonData([buildLoadedPlan(baselineSpec), buildLoadedPlan(other)], "base-plan");

describe("PlanComparisonPage", () => {
  let cleanPair: PlanComparisonData;

  beforeAll(async () => {
    cleanPair = await build(cloneSpec);
  });

  it("renders all five sections from fixture data", () => {
    render(<PlanComparisonPage data={cleanPair} allPlans={OPTIONS} />);

    expect(screen.getByRole("heading", { name: "Cohort scoreboard" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Golden slots/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Board-wide/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cross-cohort weave" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Distributions/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rule verdict" })).toBeTruthy();
  });

  it("renders 2N columns for the cohort sections — one per plan per cohort", () => {
    render(<PlanComparisonPage data={cleanPair} allPlans={OPTIONS} />);

    const scoreboard = screen.getByRole("region", { name: "Cohort scoreboard" });
    const headers = within(scoreboard).getAllByRole("columnheader");

    // "Metric" + Expert dp1/dp2 + Engine dp1/dp2.
    expect(headers).toHaveLength(5);
    expect(headers[0].textContent).toBe("Metric");
  });

  // The load-bearing claim of the whole drift model: a plan and its clone (every UUID re-minted)
  // must NOT light up the banner. The old catalog_hash would report drift on this exact pair.
  it("shows NO drift banner for a plan and its catalog-identical clone", () => {
    render(<PlanComparisonPage data={cleanPair} allPlans={OPTIONS} />);

    expect(screen.queryByText(/Catalog drift/)).toBeNull();
    expect(screen.queryByText(/Not comparable/)).toBeNull();
  });

  it("NAMES the drift when the catalogs differ", async () => {
    const drifted = await build({
      ...cloneSpec,
      students: [...(SAMPLE.students ?? []), { name: "Katherine Johnson" }],
    });

    render(<PlanComparisonPage data={drifted} allPlans={OPTIONS} />);

    expect(screen.getByText(/Catalog drift/)).toBeTruthy();
    expect(screen.getByText(/1 student added/)).toBeTruthy();
  });

  it("uses the louder `incomparable` tier — and says so plainly — when the grid differs", async () => {
    const drifted = await build({ ...cloneSpec, periods: 8 });

    render(<PlanComparisonPage data={drifted} allPlans={OPTIONS} />);

    const notice = screen.getByRole("status");

    expect(notice.dataset.tier).toBe("incomparable");
    expect(within(notice).getByText("Not comparable")).toBeTruthy();
    // Names both grid shapes, and says plainly which metric families stop meaning anything.
    expect(notice.textContent).toContain("5×10");
    expect(notice.textContent).toContain("5×8");
    expect(notice.textContent).toMatch(/not comparable/i);
    expect(notice.textContent).toMatch(/Board-shape, day-edge, slot-census and week-symmetry/);
  });

  /**
   * THE invariant: a slot count never renders without its cohort's hour accounting beside it. An
   * incomplete board trivially uses fewer slots — which is how the engine's abandoned hours once read
   * as a "better" slot count.
   */
  it("renders the completeness annotation beneath the slot counts of an incomplete cohort", () => {
    render(<PlanComparisonPage data={cleanPair} allPlans={OPTIONS} />);

    // The scoreboard carries "Occupied slots"…
    expect(screen.getByRole("rowheader", { name: "Occupied slots" })).toBeTruthy();
    // …and the sentence that makes it readable sits beside it. The annotation is per plan-COHORT,
    // never one summary: both plans share the catalog, and each has an incomplete dp1 (Maths) and an
    // incomplete dp2 (History) — so all four are named.
    const notes = screen.getAllByText(/is INCOMPLETE — its slot count is flattered/);
    expect(notes).toHaveLength(4);

    // Named by SUBJECT, not by UUID — this is a sentence a timetabler reads.
    const dp1Notes = notes.filter((note) => note.textContent.includes("dp1"));
    expect(dp1Notes).toHaveLength(2);
    for (const note of dp1Notes) expect(note.textContent).toContain("Maths HL −2h");
  });

  it("renders the worst teacher and worst student as NAMES, never UUIDs", () => {
    render(<PlanComparisonPage data={cleanPair} allPlans={OPTIONS} />);

    const worstTeacher = screen.getAllByText(/Teacher \(gaps\):/)[0];
    expect(worstTeacher.textContent).toContain("Ada Byron");
    expect(worstTeacher.textContent).not.toMatch(/base-t-|cln-t-/);
  });

  it("names a plan that could not be loaded instead of silently comparing fewer plans", async () => {
    const partial = await buildComparisonData([buildLoadedPlan(baselineSpec)], "base-plan", ["dead-plan-id"]);

    render(<PlanComparisonPage data={partial} allPlans={OPTIONS} />);

    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/dead-plan-id/)).toBeTruthy();
  });

  it("says so when the requested baseline could not be loaded and a survivor took its place", async () => {
    const fallback = await buildComparisonData([buildLoadedPlan(cloneSpec)], "base-plan", ["base-plan"]);

    render(<PlanComparisonPage data={fallback} allPlans={OPTIONS} />);

    expect(screen.getByText(/requested baseline could not be loaded/)).toBeTruthy();
  });

  it("shows the picker's empty state, not an error, when no plans are selected", () => {
    render(<PlanComparisonPage data={null} allPlans={OPTIONS} />);

    expect(screen.getByText(/Pick two or more plans to compare/)).toBeTruthy();
  });
});
