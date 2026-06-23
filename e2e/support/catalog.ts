import { expect, type Locator, type Page } from "@playwright/test";
import { clickToReveal, gotoStable } from "./planner";

// Shared catalog-authoring E2E helpers — course/student form drivers + the shadcn/Radix
// combobox + multi-select pickers they depend on. Promoted out of cohort-switching.spec.ts
// once drag-validate-feedback became the second consumer (the trigger to share, per
// e2e/CLAUDE.md). Not a `*.spec.ts`/`*.setup.ts` file, so Playwright does not collect it.

/** Author a single-teacher course in `cohort` (DP1|DP2); returns once its catalog row is visible. */
export async function createCourse(
  page: Page,
  planId: string,
  { name, cohort, teacher }: { name: string; cohort: "DP1" | "DP2"; teacher: string },
): Promise<void> {
  await gotoStable(page, `/plans/${planId}/courses`);
  const dialog = page.getByRole("dialog");
  await clickToReveal(
    page.getByRole("button", { name: "New course" }),
    dialog.getByRole("heading", { name: "New course" }),
  );
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Weekly hours").fill("2");
  await selectFromCombobox(page, dialog.getByRole("combobox", { name: "Cohort" }), cohort);
  await pickInMultiSelect(page, dialog.getByRole("button", { name: "Select teachers…" }), teacher, "1 selected");
  await dialog.getByRole("button", { name: "Create course" }).click();
  await expect(dialog).toBeHidden();
  // Courses land under the active cohort tab; select it so the row is on-screen before asserting.
  await page.getByRole("tab", { name: cohort }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

/** Author a student in `cohort` choosing exactly `course` (makes that course placeable). */
export async function createStudent(
  page: Page,
  planId: string,
  { name, cohort, course }: { name: string; cohort: "DP1" | "DP2"; course: string },
): Promise<void> {
  await gotoStable(page, `/plans/${planId}/students`);
  const dialog = page.getByRole("dialog");
  await clickToReveal(
    page.getByRole("button", { name: "New student" }).first(),
    dialog.getByRole("heading", { name: "New student" }),
  );
  await dialog.getByLabel("Name").fill(name);
  // Cohort must be set BEFORE choosing courses — choices are filtered to the selected cohort.
  await selectFromCombobox(page, dialog.getByRole("combobox", { name: "Cohort" }), cohort);
  await pickInMultiSelect(page, dialog.getByRole("button", { name: "Select courses…" }), course, "1 selected");
  await dialog.getByRole("button", { name: "Create student" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("tab", { name: cohort }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

/** Pick `option` in a shadcn/Radix Select (the visible listbox option, not the hidden native one). */
export async function selectFromCombobox(page: Page, trigger: Locator, option: string): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(trigger).toContainText(option);
}

/**
 * Choose `option` in a portalled multi-select popover and confirm the trigger's count label.
 * The popover is modal and lives outside the dialog subtree, so Escape (closing only the popover,
 * not the form dialog) must dismiss it before the footer is interactive again.
 */
export async function pickInMultiSelect(
  page: Page,
  trigger: Locator,
  option: string,
  expectLabel: string,
): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: expectLabel })).toBeVisible();
}
