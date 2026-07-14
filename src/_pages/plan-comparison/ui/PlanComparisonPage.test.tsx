import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { buildComparisonData, type PlanComparisonData } from "../api/load-comparison";
import { buildLoadedPlan, SAMPLE, type PlanSpec } from "../model/__fixtures__/loaded-plan";
import PlanComparisonPage from "./PlanComparisonPage";

/** First plan: Maths (4h) placed twice, so dp1 is INCOMPLETE — the completeness invariant has something
 *  real to say. Second: an identical catalog (a clone) with one extra placement. Neither is a baseline;
 *  the order is only the order the URL named them in. */
const expertSpec: PlanSpec = {
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

const build = (other: PlanSpec) => buildComparisonData([buildLoadedPlan(expertSpec), buildLoadedPlan(other)]);

describe("PlanComparisonPage", () => {
  let cleanPair: PlanComparisonData;

  beforeAll(async () => {
    cleanPair = await build(cloneSpec);
  });

  it("renders all five sections from fixture data", () => {
    render(<PlanComparisonPage data={cleanPair} />);

    expect(screen.getByRole("heading", { name: "Cohort scoreboard" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Golden slots/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Board-wide/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Cross-cohort weave" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Distributions/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rule verdict" })).toBeTruthy();
  });

  it("renders 2N columns for the cohort sections — one per plan per cohort", () => {
    render(<PlanComparisonPage data={cleanPair} />);

    const scoreboard = screen.getByRole("region", { name: "Cohort scoreboard" });
    const headers = within(scoreboard).getAllByRole("columnheader");

    // "Metric" + Expert dp1/dp2 + Engine dp1/dp2.
    expect(headers).toHaveLength(5);
    expect(headers[0].textContent).toBe("Metric");
  });

  /**
   * The page reports; it never judges. No column is a baseline, so no cell may carry a delta, an arrow,
   * a sign or a colour that implies a direction — that is the weighted-scalar tier-bleed lesson wearing
   * a different hat. Every data cell is exactly the string the bench would print.
   */
  it("renders bare values — never a delta, a sign or a better/worse marker", () => {
    render(<PlanComparisonPage data={cleanPair} />);

    const scoreboard = screen.getByRole("region", { name: "Cohort scoreboard" });
    const cells = within(scoreboard).getAllByRole("cell");

    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.textContent).not.toMatch(/[▲▼↑↓+−]/);
      expect(cell.textContent.trim()).toMatch(/^[\d.,\s/%–—:A-Za-z-]*$/);
    }
  });

  it("names the compared plans, and offers the way back to change them", () => {
    render(<PlanComparisonPage data={cleanPair} />);

    expect(screen.getByText(/^Expert · Engine —/)).toBeTruthy();
    // The ONLY way to change the selection: back to the hub. No in-page picker can disagree with the
    // SSR'd numbers, because there is none.
    expect(screen.getByRole("link", { name: "Change selection" }).getAttribute("href")).toBe("/plans");
  });

  // The load-bearing claim of the whole drift model: a plan and its clone (every UUID re-minted)
  // must NOT light up the banner. The old catalog_hash would report drift on this exact pair.
  it("shows NO drift banner for a plan and its catalog-identical clone", () => {
    render(<PlanComparisonPage data={cleanPair} />);

    expect(screen.queryByText(/Catalog drift/)).toBeNull();
    expect(screen.queryByText(/Not comparable/)).toBeNull();
  });

  /**
   * The banner reports that the catalogs are not one-to-one and WHICH METRIC FAMILIES that invalidates.
   * It does not enumerate what moved: per-category counts ("61 students added, 652 choices added") are a
   * wall of numbers that still cannot say *which* student, and a count nobody can act on is noise.
   */
  it("says the catalogs are not identical — and which metrics that spoils — without enumerating the changes", async () => {
    const drifted = await build({
      ...cloneSpec,
      students: [...(SAMPLE.students ?? []), { name: "Katherine Johnson" }],
    });

    render(<PlanComparisonPage data={drifted} />);
    const notice = screen.getByRole("status");

    expect(notice.dataset.tier).toBe("catalog-drift");
    expect(notice.textContent).toMatch(/not identical/);
    // Named relative to the first-listed plan — an ordering, not a claim that Expert is the correct one.
    expect(notice.textContent).toMatch(/Expert/);
    // The actionable half: which numbers stopped meaning what they say, and which still hold.
    expect(notice.textContent).toMatch(/Catalog-dependent metrics/);
    expect(notice.textContent).toMatch(/board shape, daily load, week symmetry, adjacency and spread still compare/);
    // No enumeration, in any direction.
    expect(notice.textContent).not.toMatch(/\d+ (students?|courses?|teachers?|choices?) (added|removed|changed)/);
  });

  it("uses the louder `incomparable` tier — and says so plainly — when the grid differs", async () => {
    const drifted = await build({ ...cloneSpec, periods: 8 });

    render(<PlanComparisonPage data={drifted} />);

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
   * as a "better" slot count. The prose annotation that used to restate this is gone; the accounting
   * itself is not, and it sits ABOVE every slot count in the same table.
   */
  it("puts the hour accounting above the slot counts, in the same table", () => {
    render(<PlanComparisonPage data={cleanPair} />);

    const scoreboard = screen.getByRole("region", { name: "Cohort scoreboard" });
    const labels = within(scoreboard)
      .getAllByRole("rowheader")
      .map((header) => header.textContent);

    expect(labels).toContain("Occupied slots");
    expect(labels.indexOf("UNPLACED HOURS")).toBeLessThan(labels.indexOf("Occupied slots"));
    expect(labels.indexOf("OVER-PLACED HOURS")).toBeLessThan(labels.indexOf("Occupied slots"));
  });

  /**
   * The worst-case rows name a person and link to that person's timetable IN THAT COLUMN'S PLAN — the
   * number says who, the linked timetable says why. They used to print the analyzer's raw UUID.
   */
  it("renders the worst teacher as a NAME linking into that plan, never a UUID", () => {
    render(<PlanComparisonPage data={cleanPair} />);

    const boardWide = screen.getByRole("region", { name: /Board-wide/ });
    const link = within(boardWide).getAllByRole("link", { name: /^Ada Byron: / })[0];

    expect(link.getAttribute("href")).toMatch(/^\/plans\/base-plan\/teachers\/base-t-/);
    expect(link.textContent).not.toMatch(/base-t-|cln-t-/);
  });

  /**
   * The help exists because a figure nobody can interpret is indistinguishable from one nobody should
   * trust. `lateFinishes` is the sharpest case: the analyzer computes `periods − last`, so it counts the
   * periods left AFTER a student's last lesson — 0 means they finish in the final period. Read at face
   * value the name says the opposite of the number, so the popover must state the inversion outright.
   */
  it("explains the per-person spread, including the late-finishes inversion", async () => {
    render(<PlanComparisonPage data={cleanPair} />);

    fireEvent.click(screen.getAllByRole("button", { name: 'What does "Per-person spread" mean?' })[0]);

    const help = await screen.findByRole("dialog");
    expect(help.textContent).toMatch(/0 means they finish in the final period/);
    expect(help.textContent).toMatch(/lessons ÷ their span/);
  });

  it("explains what a mirrored cell is, and what the time-of-day gradient averages", async () => {
    render(<PlanComparisonPage data={cleanPair} />);

    fireEvent.click(screen.getAllByRole("button", { name: 'What does "Mirrored cells" mean?' })[0]);
    expect((await screen.findByRole("dialog")).textContent).toMatch(/both cohorts run the same subject/i);

    fireEvent.click(screen.getAllByRole("button", { name: 'What does "Time-of-day gradient" mean?' })[0]);
    const opened = await screen.findAllByRole("dialog");
    expect(opened.some((help) => /mean period/i.test(help.textContent))).toBe(true);
  });

  /**
   * The cross-cohort section measures what is in neither the objective nor the catalog, and not one of
   * its labels explains itself. The help has to survive the trip the data takes — built server-side,
   * serialized into the island — so this asserts it arrives at the rendered row, not merely that the
   * catalog declares it.
   */
  it("explains every cross-cohort row from an icon beside its label", async () => {
    render(<PlanComparisonPage data={cleanPair} />);

    const weave = screen.getByRole("region", { name: "Cross-cohort weave" });
    const rowCount = within(weave).getAllByRole("rowheader").length;
    expect(within(weave).getAllByRole("button", { name: /^What does/ })).toHaveLength(rowCount);

    fireEvent.click(within(weave).getByRole("button", { name: 'What does "Cohort-pure teacher-days" mean?' }));

    const help = await screen.findByRole("dialog");
    expect(help.textContent).toMatch(/every lesson they teach that day serves the SAME cohort/);
  });

  it("names a plan that could not be loaded instead of silently comparing fewer plans", async () => {
    const partial = await buildComparisonData([buildLoadedPlan(expertSpec)], ["dead-plan-id"]);

    render(<PlanComparisonPage data={partial} />);

    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/dead-plan-id/)).toBeTruthy();
  });

  it("shows an empty state, not an error, when the URL named no loadable plan", () => {
    render(<PlanComparisonPage data={null} />);

    expect(screen.getByText(/Tick two or more plans on the plans list/)).toBeTruthy();
  });
});
