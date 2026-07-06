import { test, expect, type Page } from "@playwright/test";
import { computeGroupings, display, placeFromPalette } from "../support/board";
import { createCourse, createStudent, selectFromCombobox } from "../support/catalog";
import { clickToReveal, createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Student plan view — browser-level coverage (plan Phase 4, context/changes/student-plan-view/plan.md).
//
// Locks the page's role-based contract end to end: the students-table name link navigates to
// the student's stable URL, the static single-cohort grid (`role="grid"`) shows the student's
// placed course, the course list below carries the occurrence line and the Teachers roster,
// and the switcher's cohort tab NAVIGATES — clicking the other cohort's tab jumps straight to
// that cohort's first student (heading, grid, and course list update in one step), mirroring the
// board's `CohortSwitcher`. Where the other cohort has no students, that tab renders disabled.
//
// Authenticated `chromium` project (reuses storageState from auth.setup). Modeled on
// teacher-plan-view.spec.ts; conventions in e2e/CLAUDE.md — role-based locators only,
// state-based waits, teardown by deleting the plan (cascades to every child entity).

test.describe("student plan view", () => {
  // Catalog authoring spans four pages plus a grouping compute and a board drag.
  test.describe.configure({ timeout: 120_000 });

  test("students-table link opens the student's view; grid + course list render; cohort tab navigates to the other cohort's student", async ({
    page,
  }) => {
    const id = shortId();
    const teacher = `SPV${id}`;
    const course = `History ${id}`;
    const student = `Stu ${id}`;
    const dp2Student = `Emp ${id}`;
    const courseDisplay = display(course);
    const slot = "Wed, P5";

    const plan = await createPlan(page, "student-plan-view");
    await createTeacher(page, plan.id, teacher);
    await createCourse(page, plan.id, { name: course, cohort: "DP1", teacher });
    await createStudent(page, plan.id, { name: student, cohort: "DP1", course });
    await createStudentWithoutChoices(page, plan.id, { name: dp2Student, cohort: "DP2" });

    // Place the course on the board (choice-driven groupings make it placeable).
    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, courseDisplay);
    await placeFromPalette(page, courseDisplay, slot);

    // Entry point: the student's name cell links straight to the view.
    await gotoStable(page, `/plans/${plan.id}/students`);
    await page.getByRole("link", { name: student, exact: true }).click();
    await page.waitForURL(/\/students\/[0-9a-f-]{36}$/);

    // The static grid shows the placed course chip; the cell registers under the grid role tree.
    const grid = page.getByRole("grid", { name: `${student} timetable` });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole("gridcell", { name: slot })).toContainText(courseDisplay);

    // The course card resolves the occurrence line and the Teachers roster (code-only teacher
    // resolves to its code). Form-created courses default to level "none" → raw-name title.
    const card = page.getByRole("article", { name: course });
    await expect(card.getByRole("list", { name: "Occurrences" })).toContainText("Wed P5");
    await expect(card.getByRole("list", { name: `Teachers of ${course}` })).toContainText(teacher);

    // The active tab is the current cohort; its dropdown is scoped to that cohort with the current
    // student check-marked (aria-current), and the other cohort's student is absent from the list.
    await expect(page.getByRole("tab", { name: "DP1" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Switch student" }).click();
    await expect(page.getByRole("menuitem", { name: student })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("menuitem", { name: dp2Student })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: student })).toBeHidden();

    // The cohort tab navigates: clicking DP2 jumps straight to that cohort's first student —
    // the whole page updates (heading, grid, course list) in one step, with no dropdown dance.
    // The dp2 student has no choices, so their view renders the full grid and the empty message.
    await page.getByRole("tab", { name: "DP2" }).click();
    await page.waitForURL(/\/students\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("grid", { name: `${dp2Student} timetable` })).toBeVisible();
    await expect(page.getByText("This student has no courses in this plan.")).toBeVisible();

    await deletePlan(page, plan.name);
  });

  test("the other cohort's tab is disabled when that cohort has no students", async ({ page }) => {
    const id = shortId();
    const student = `Solo ${id}`;

    const plan = await createPlan(page, "student-plan-view-empty-cohort");
    await createStudentWithoutChoices(page, plan.id, { name: student, cohort: "DP1" });

    // Open the lone dp1 student's view. dp2 has no students, so its tab has no lead to link to.
    await gotoStable(page, `/plans/${plan.id}/students`);
    await page.getByRole("link", { name: student, exact: true }).click();
    await page.waitForURL(/\/students\/[0-9a-f-]{36}$/);

    const dp2Tab = page.getByRole("tab", { name: "DP2" });
    await expect(dp2Tab).toBeDisabled();

    // A disabled trigger is not an anchor — a forced click cannot navigate anywhere.
    const urlBefore = page.url();
    await dp2Tab.click({ force: true });
    await expect(page).toHaveURL(urlBefore);

    await deletePlan(page, plan.name);
  });
});

/**
 * Author a student with NO course choices (empty choice sets are valid — no min choice
 * count): the cross-cohort probe whose view renders the empty course list, and the lone
 * student in the disabled-tab plan. Local to this spec (the shared `createStudent` always
 * picks one course).
 */
async function createStudentWithoutChoices(
  page: Page,
  planId: string,
  { name, cohort }: { name: string; cohort: "DP1" | "DP2" },
): Promise<void> {
  await gotoStable(page, `/plans/${planId}/students`);
  const dialog = page.getByRole("dialog");
  await clickToReveal(
    page.getByRole("button", { name: "New student" }).first(),
    dialog.getByRole("heading", { name: "New student" }),
  );
  await dialog.getByLabel("Name").fill(name);
  await selectFromCombobox(page, dialog.getByRole("combobox", { name: "Cohort" }), cohort);
  await dialog.getByRole("button", { name: "Create student" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("tab", { name: cohort }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}
