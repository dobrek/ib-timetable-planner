import { test, expect } from "@playwright/test";
import { computeGroupings, display, placeFromPalette } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Teacher plan view — browser-level coverage (plan Phase 4, context/changes/teacher-plan-view/plan.md).
//
// Locks the page's role-based contract end to end: the teachers-table entry point navigates to
// the teacher's stable URL, the static grid (`role="grid"`) shows the teacher's placed course,
// the course list below carries the occurrence line and the always-visible roster, and the
// header switcher navigates to a sibling teacher whose (empty) view still renders the full grid.
//
// Authenticated `chromium` project (reuses storageState from auth.setup). Modeled on
// cohort-switching.spec.ts; conventions in e2e/CLAUDE.md — role-based locators only, state-based
// waits, teardown by deleting the plan (cascades to every child entity).

test.describe("teacher plan view", () => {
  // Catalog authoring spans four pages plus a grouping compute and a board drag.
  test.describe.configure({ timeout: 120_000 });

  test("teachers-table link opens the teacher's view; grid + course list render; switcher navigates", async ({
    page,
  }) => {
    const id = shortId();
    const teacher = `TPV${id}`;
    const otherTeacher = `EMP${id}`;
    const course = `History ${id}`;
    const student = `Stu ${id}`;
    const courseDisplay = display(course);
    const slot = "Wed, P5";

    const plan = await createPlan(page, "teacher-plan-view");
    await createTeacher(page, plan.id, teacher);
    await createTeacher(page, plan.id, otherTeacher);
    await createCourse(page, plan.id, { name: course, cohort: "DP1", teacher });
    await createStudent(page, plan.id, { name: student, cohort: "DP1", course });

    // Place the course on the board (choice-driven groupings make it placeable).
    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, courseDisplay);
    await placeFromPalette(page, courseDisplay, slot);

    // Entry point: the teacher's code cell links straight to the view.
    await gotoStable(page, `/plans/${plan.id}/teachers`);
    await page.getByRole("link", { name: teacher, exact: true }).click();
    await page.waitForURL(/\/teachers\/[0-9a-f-]{36}$/);

    // The static grid shows the placed course chip; the cell registers under the grid role tree.
    const grid = page.getByRole("grid", { name: `${teacher} timetable` });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole("gridcell", { name: slot })).toContainText(courseDisplay);

    // The course list resolves the course with its occurrence line and always-visible roster.
    // (Form-created courses default to level "none", so the badge title is the raw name.)
    const card = page.getByRole("article", { name: course });
    await expect(card.getByRole("list", { name: "Occurrences" })).toContainText("Wed P5");
    await expect(card.getByRole("list", { name: `Students of ${course}` })).toContainText(student);

    // Switcher: navigate to the sibling teacher; their empty view still renders the full grid.
    await page.getByRole("button", { name: "Switch teacher" }).click();
    await page.getByRole("menuitem", { name: otherTeacher }).click();
    await page.waitForURL(/\/teachers\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("grid", { name: `${otherTeacher} timetable` })).toBeVisible();
    await expect(page.getByText("This teacher conducts no courses in this plan.")).toBeVisible();

    await deletePlan(page, plan.name);
  });
});
