import { expect, test, type Page } from "@playwright/test";
import { clickToReveal, createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";
import { createCourse, createStudent, selectFromCombobox } from "../support/catalog";

// Bulk course-choice editing — the two behaviors only a browser can verify:
//   1. the happy-path story end-to-end (filter → select-all → add/remove → confirmation
//      counts + drift-hint → apply → badge assertions + bystander untouched + selection cleared);
//   2. WYSIWYG selection-clearing over URL-synced filter state (search + course filter).
// Runs on real workerd against local Supabase, same authenticated project as the other specs.

test.describe("bulk edit course choices", () => {
  test("adds and removes courses across the filtered, selected students (happy-path story)", async ({ page }) => {
    test.slow(); // Setup authors 4 courses + 3 students through the UI before the bulk edit.
    const sfx = shortId();
    const math = `Math ${sfx}`;
    const tok1 = `Tok1 ${sfx}`;
    const tok2 = `Tok2 ${sfx}`;
    const bio = `Bio ${sfx}`;
    const alice = `Alice ${sfx}`; // Math + Tok2
    const bob = `Bob ${sfx}`; // Math only
    const carol = `Carol ${sfx}`; // bystander — neither Math nor Tok2

    const plan = await createPlan(page, "bulk-choices");
    try {
      await createTeacher(page, plan.id, `T${sfx}`);
      for (const name of [math, tok1, tok2, bio]) {
        await createCourse(page, plan.id, { name, cohort: "DP1", teacher: `T${sfx}` });
      }
      await createStudentChoosing(page, plan.id, alice, [math, tok2]);
      await createStudent(page, plan.id, { name: bob, cohort: "DP1", course: math });
      await createStudent(page, plan.id, { name: carol, cohort: "DP1", course: bio });

      // Filter to the Math choosers — Alice + Bob, not the bystander Carol.
      await gotoStable(page, `/plans/${plan.id}/students`);
      await filterByCourse(page, math);
      await expect(page.getByRole("link", { name: alice, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: bob, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: carol, exact: true })).toBeHidden();

      // Select all (2 rows) and open the bulk dialog.
      await page.getByRole("checkbox", { name: "Select all students" }).click();
      await expect(page.getByText("2 selected")).toBeVisible();
      await page.getByRole("button", { name: "Edit choices…" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: `Edit choices for 2 students` })).toBeVisible();
      await pickBulkCourse(page, "Select courses to add…", tok1, 1);
      await pickBulkCourse(page, "Select courses to remove…", tok2, 2);
      await dialog.getByRole("button", { name: "Review…" }).click();

      // Confirmation step: gain/loss counts and the drift hint.
      await expect(dialog.getByText("2 of 2 students will gain it")).toBeVisible();
      await expect(dialog.getByText("1 of 2 students will lose it")).toBeVisible();
      await expect(dialog.getByText(/review them afterwards/i)).toBeVisible();
      // Review must only PREVIEW — regression guard against the phantom-submit bug where the reused
      // footer button node turned "Review…" into a type="submit" in place, applying the edit and
      // closing the dialog on the first click. On confirm we must still be here, Review gone.
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Review…" })).toHaveCount(0);

      // force: the button disables itself on submit (form.isSubmitting) and stays disabled
      // while the slower bulk mutation runs + refreshPage navigates, so a normal click's
      // actionability retry would wait forever for it to re-enable. One forced dispatch is enough.
      await dialog.getByRole("button", { name: "Apply changes" }).click({ force: true });
      await expect(dialog).toBeHidden();

      // Filter persists in the URL across the refresh — Alice + Bob still shown, now updated.
      const aliceRow = rowFor(page, alice);
      await expect(aliceRow.getByText(tok1, { exact: true })).toBeVisible();
      await expect(aliceRow.getByText(tok2, { exact: true })).toBeHidden();
      await expect(rowFor(page, bob).getByText(tok1, { exact: true })).toBeVisible();

      // The full-page refresh remounted the island — the selection bar is gone.
      await expect(page.getByText(/\d+ selected/)).toHaveCount(0);

      // Bystander untouched: Carol still has exactly Bio, never gained Tok1.
      await gotoStable(page, `/plans/${plan.id}/students`);
      const carolRow = rowFor(page, carol);
      await expect(carolRow.getByText(bio, { exact: true })).toBeVisible();
      await expect(carolRow.getByText(tok1, { exact: true })).toBeHidden();
    } finally {
      await deletePlan(page, plan.name);
    }
  });

  test("clears the selection on any filter change (WYSIWYG)", async ({ page }) => {
    const sfx = shortId();
    const math = `Math ${sfx}`;
    const alpha = `Alpha ${sfx}`;
    const beta = `Beta ${sfx}`;

    const plan = await createPlan(page, "bulk-clear");
    try {
      await createTeacher(page, plan.id, `T${sfx}`);
      await createCourse(page, plan.id, { name: math, cohort: "DP1", teacher: `T${sfx}` });
      await createStudent(page, plan.id, { name: alpha, cohort: "DP1", course: math });
      await createStudent(page, plan.id, { name: beta, cohort: "DP1", course: math });

      await gotoStable(page, `/plans/${plan.id}/students`);

      // Select both, then change the search text — the bar disappears (selection cleared).
      await page.getByRole("checkbox", { name: "Select all students" }).click();
      await expect(page.getByText("2 selected")).toBeVisible();
      await page.getByRole("searchbox", { name: "Search students" }).fill("Alpha");
      await expect(page.getByText(/\d+ selected/)).toHaveCount(0);

      // Re-select over the narrowed view, then change the course filter — cleared again.
      await page.getByRole("checkbox", { name: "Select all students" }).click();
      await expect(page.getByText("1 selected")).toBeVisible();
      await filterByCourse(page, math);
      await expect(page.getByText(/\d+ selected/)).toHaveCount(0);
    } finally {
      await deletePlan(page, plan.name);
    }
  });
});

/** Author a DP1 student choosing several courses (the single-course `createStudent` can't). */
async function createStudentChoosing(page: Page, planId: string, name: string, courseNames: string[]): Promise<void> {
  await gotoStable(page, `/plans/${planId}/students`);
  const dialog = page.getByRole("dialog");
  await clickToReveal(
    page.getByRole("button", { name: "New student" }).first(),
    dialog.getByRole("heading", { name: "New student" }),
  );
  await dialog.getByLabel("Name").fill(name);
  await selectFromCombobox(page, dialog.getByRole("combobox", { name: "Cohort" }), "DP1");
  await dialog.getByRole("button", { name: "Select courses…" }).click();
  for (const courseName of courseNames) {
    await page.getByRole("option", { name: courseName, exact: true }).click();
  }
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("button", { name: `${courseNames.length} selected` })).toBeVisible();
  await dialog.getByRole("button", { name: "Create student" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

/** Apply the page-level course filter (not modal — no dialog scope). */
async function filterByCourse(page: Page, courseName: string): Promise<void> {
  await page.getByRole("button", { name: "Course" }).click();
  await page.getByRole("option", { name: courseName, exact: true }).click();
  await page.keyboard.press("Escape");
}

/**
 * Pick one course in a bulk-dialog (modal) picker, identified by its placeholder trigger.
 * `expectSelectedTriggers` is how many pickers should read "1 selected" afterwards — both
 * pickers share that label, so a plain visibility check would be strict-mode ambiguous.
 */
async function pickBulkCourse(
  page: Page,
  triggerName: string,
  courseName: string,
  expectSelectedTriggers: number,
): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: triggerName }).click();
  await page.getByRole("option", { name: courseName, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("button", { name: "1 selected" })).toHaveCount(expectSelectedTriggers);
}

/** The table row containing a student's name link — the scope for per-row badge assertions. */
function rowFor(page: Page, studentName: string) {
  return page.getByRole("row").filter({ has: page.getByRole("link", { name: studentName, exact: true }) });
}
