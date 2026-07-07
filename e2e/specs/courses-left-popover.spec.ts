import { test, expect } from "@playwright/test";
import { computeGroupings, display } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { clickToReveal, createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Courses-left popover (courses-left-info) — browser-level coverage of the end-to-end wiring:
// the top-bar counter reports UNPLACED HOURS (not a course count) and, clicked, opens the
// breakdown popover listing the missing course with its placed/required counter.
//
// A freshly-created plan with one 2h course and no placements is the deterministic "hours left"
// fixture (createCourse fixes Weekly hours = 2). Groupings must be computed first: in focus mode
// the board renders the empty compute-state — and therefore no summary bar — until they exist.
// Authenticated `chromium` project (reuses storageState). Conventions in e2e/CLAUDE.md.

test.describe("courses-left popover", () => {
  // Full catalog authoring + grouping compute + board render — past the default 30s.
  test.describe.configure({ timeout: 120_000 });

  test("counts unplaced hours and opens the breakdown popover listing the missing course", async ({ page }) => {
    const id = shortId();
    const teacher = `CLP${id}`;
    const course = `Maths ${id}`;
    const courseDisplay = display(course);

    const plan = await createPlan(page, "courses-left-popover");
    await createTeacher(page, plan.id, teacher);
    await createCourse(page, plan.id, { name: course, cohort: "DP1", teacher });
    await createStudent(page, plan.id, { name: `Stu ${id}`, cohort: "DP1", course });

    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, courseDisplay);

    // --- The bar reports unplaced HOURS as a Popover trigger (2h course, nothing placed → > 0).
    // The trigger's accessible name spells the hours out ("N hours left to place — show breakdown");
    // the zero state renders a plain "All course hours placed" span instead, so a name matching
    // "hours left to place" is itself the proof the count is positive.
    const trigger = page.getByRole("button", { name: /show breakdown/ });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAccessibleName(/^\d+ hours? left to place/);

    // --- Clicking it opens the breakdown; the Missing section lists the course row with its
    // visible placed/required counter ("0/2").
    const popover = page.getByRole("dialog");
    await clickToReveal(trigger, popover);
    await expect(popover.getByText("Course placement")).toBeVisible();
    await expect(popover.getByText("Missing", { exact: true })).toBeVisible();
    await expect(popover.getByText(/hours? left/)).toBeVisible();
    const missingRow = popover.getByRole("listitem").filter({ hasText: courseDisplay });
    await expect(missingRow).toBeVisible();
    await expect(missingRow).toContainText(/\d+\/\d+/);

    await deletePlan(page, plan.name);
  });
});
