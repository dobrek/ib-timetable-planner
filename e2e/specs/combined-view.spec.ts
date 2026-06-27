import { test, expect, type Locator, type Page } from "@playwright/test";
import { computeGroupings, display, placeFromPalette, steppedDrag } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Combined two-cohort view (S-06) — browser-level coverage (plan Phase 5 #3, US-01).
//
// What this proves that the single-cohort cross-cohort spec + the unit guards cannot:
//   1. The switcher's "Combined" segment navigates to /plans/[id]/combined (the new route).
//   2. A shared teacher placed at the SAME slot in BOTH cohorts flags the cross-cohort clash on
//      ADJACENT cells SIMULTANEOUSLY — the one dimension the paired-column layout exists to surface.
//   3. The cross-column drag guard (FR-008): dragging a DP1 chip onto the DP2 cell does NOT move it.
//
// Both placements are committed via the single-cohort boards first (the simplest reliable seed),
// then the combined view renders them; the clash + guard are asserted IN the combined view.
// Authenticated `chromium` project (reuses storageState). Conventions in e2e/CLAUDE.md.

const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A combined-view cell, disambiguated by its cohort-prefixed accessible name ("DP1, Wed, P5"). */
const combinedCell = (page: Page, cohort: "DP1" | "DP2", slot: string): Locator =>
  page.getByRole("gridcell", { name: `${cohort}, ${slot}`, exact: true });

/** The placed chip for `displayName` inside a combined-view cohort cell. */
const combinedChip = (page: Page, cohort: "DP1" | "DP2", slot: string, displayName: string): Locator =>
  combinedCell(page, cohort, slot).getByRole("button", { name: new RegExp(`^${escapeRegExp(displayName)}`) });

test.describe("combined two-cohort view", () => {
  // Builds catalog across both cohorts, computes groupings twice, and drives the board — past 30s.
  test.describe.configure({ timeout: 120_000 });

  test("flags a cross-cohort clash on adjacent cells and guards cross-column drags", async ({ page }) => {
    const id = shortId();
    const teacher = `SHR${id}`;
    const dp1Course = `Maths DP1 ${id}`;
    const dp2Course = `Maths DP2 ${id}`;
    const dp1Display = display(dp1Course);
    const dp2Display = display(dp2Course);
    const slot = "Wed, P5";

    const plan = await createPlan(page, "combined-view");

    // One shared teacher, a placeable course in EACH cohort (a single-choice student makes each placeable).
    await createTeacher(page, plan.id, teacher);
    await createCourse(page, plan.id, { name: dp1Course, cohort: "DP1", teacher });
    await createCourse(page, plan.id, { name: dp2Course, cohort: "DP2", teacher });
    await createStudent(page, plan.id, { name: `Stu DP1 ${id}`, cohort: "DP1", course: dp1Course });
    await createStudent(page, plan.id, { name: `Stu DP2 ${id}`, cohort: "DP2", course: dp2Course });

    // Commit both placements via the single boards (same slot, week-agnostic → cross-cohort clash).
    await gotoStable(page, `/plans/${plan.id}?cohort=dp1`);
    await computeGroupings(page, dp1Display);
    await placeFromPalette(page, dp1Display, slot);

    await gotoStable(page, `/plans/${plan.id}?cohort=dp2`);
    await computeGroupings(page, dp2Display);
    await placeFromPalette(page, dp2Display, slot);

    // --- Navigate to the combined view via the switcher's "Combined" segment.
    await page.getByRole("group", { name: "Cohort" }).getByRole("link", { name: "Combined" }).click();
    await page.waitForURL(new RegExp(`/plans/${plan.id}/combined`));

    // --- The clash is flagged on BOTH adjacent cells at once (the paired-column payoff).
    await expect(combinedChip(page, "DP1", slot, dp1Display)).toHaveAttribute("aria-invalid", "true");
    await expect(combinedChip(page, "DP2", slot, dp2Display)).toHaveAttribute("aria-invalid", "true");

    // --- Cross-column guard: drag the DP1 chip onto the DP2 cell → it does NOT move (stays in DP1),
    //     and DP2 still holds ONLY its own course (the drop was rejected, never merged).
    await steppedDrag(page, combinedChip(page, "DP1", slot, dp1Display), combinedCell(page, "DP2", slot));
    await expect(combinedChip(page, "DP1", slot, dp1Display)).toBeVisible();
    await expect(combinedCell(page, "DP2", slot).locator('[aria-roledescription="placement"]')).toHaveCount(1);

    await deletePlan(page, plan.name);
  });
});
