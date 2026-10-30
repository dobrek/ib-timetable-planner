import { expect, test, type Locator, type Page } from "@playwright/test";
import { cell, chipMenuTrigger, computeGroupings, display, placeFromPalette, placedChip } from "../support/board";
import { createCourse, createStudent, selectFromCombobox } from "../support/catalog";
import {
  clickToReveal,
  clonePlan,
  createPlan,
  createTeacher,
  deletePlan,
  gotoStable,
  shortId,
} from "../support/planner";

// The viewer tripwire (S-405, FR-409): walk every gated page as the provisioned viewer and assert
// that the read controls are there and the edit controls are not. It is the cheap guard against a
// FUTURE control that forgets to ask `canEdit` — the unit suites prove each gate exists, but only a
// walk of the real pages notices a new button nobody gated.
//
// Runs in `chromium-viewer`, so the default `page` is the viewer's. A viewer can create nothing, so the
// data is arranged — and torn down — in a second context on the author's storageState, through the
// same UI helpers the author specs use.
//
// **Absences are paired with the same locator present for the author.** The board's write controls
// are asserted visible on the author's board before the viewer looks for them, and most catalog
// write controls are ones the author's arrangement presses (the New buttons, "Course actions",
// "Edit availability", the overlap's remove and the availability cyclers). So a locator that drifted
// from the UI fails on the author's side, instead of letting the viewer's `toHaveCount(0)` pass on a
// control that never matched anything. Locators are role-based only (e2e/CLAUDE.md).
//
// Read-only on purpose: nothing here signs the viewer out or touches its account (e2e/CLAUDE.md).

const AUTHOR_STATE = "e2e/.auth/user.json";
const SLOT = "Wed, P5";

test.describe("viewer: every gated page is read-only", () => {
  // Catalog authoring on three pages, availability, an overlap, a grouping compute, a drag and a clone
  // as the author, then ten pages as the viewer.
  test.describe.configure({ timeout: 180_000 });

  test("the hub, board, catalogs, dialogs, comparison and perspective views render with no edit control", async ({
    page,
    browser,
  }) => {
    const id = shortId();
    const teacher = `VW${id}`;
    const placed = `Physics ${id}`;
    const linked = `Chemistry ${id}`;
    const student = `Stu ${id}`;
    const chip = display(placed);

    const author = await browser.newContext({ storageState: AUTHOR_STATE });
    const authorPage = await author.newPage();

    try {
      // --- Arrange, as the author ---------------------------------------------------------------
      const plan = await createPlan(authorPage, "viewer-tripwire");

      try {
        await createTeacher(authorPage, plan.id, teacher);
        await markSoftUnavailable(authorPage, plan.id, teacher);
        // Bi-weekly, so the placed chip carries the A/B toggle the viewer must not get.
        await createCourse(authorPage, plan.id, { name: placed, cohort: "DP1", teacher });
        await makeBiweekly(authorPage, plan.id, placed);
        await createCourse(authorPage, plan.id, { name: linked, cohort: "DP1", teacher });
        await linkOverlap(authorPage, plan.id, linked, placed);
        await createStudent(authorPage, plan.id, { name: student, cohort: "DP1", course: placed });

        // `computeGroupings` presses the focus-mode compute prompt — the control a viewer's focus mode
        // with no groupings must not show (asserted on DP2 below).
        await gotoStable(authorPage, `/plans/${plan.id}?focus=dp1`);
        await computeGroupings(authorPage, chip);
        await placeFromPalette(authorPage, chip, SLOT);
        for (const control of boardWriteControls(authorPage, chip)) await expect(control).toBeVisible();
        await expect(placedChip(authorPage, SLOT, chip)).toHaveAttribute("aria-disabled", "false");

        // A second plan, for the comparison page.
        const clone = await clonePlan(authorPage, plan.name, `${plan.name} clone`);

        try {
          // --- The plans hub ----------------------------------------------------------------------
          await gotoStable(page, "/plans");
          await expect(page.getByRole("link", { name: plan.name, exact: true })).toBeVisible();
          await expect(page.getByText("View only", { exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "New plan" })).toHaveCount(0);
          // Not this plan's alone: no row on the hub may carry a menu.
          await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(0);

          // Compare is a read, so the row checkboxes stay, and the comparison renders. The first tick
          // can land before the hub hydrates (the assertions above need no JavaScript), so it retries
          // until the selection bar answers; the island is live for the second.
          const select = (name: string) => page.getByRole("checkbox", { name: `Select ${name}`, exact: true });
          await clickToReveal(select(plan.name), page.getByText("1 selected"));
          await select(clone.name).click();
          await expect(page.getByText("2 selected")).toBeVisible();
          await page.getByRole("link", { name: "Compare", exact: true }).click();
          await page.waitForURL(/\/plans\/compare\?plans=/);
          await expect(page.getByRole("heading", { name: "Cohort scoreboard" })).toBeVisible();

          // --- The board: combined, and the focus mode that holds the chip ------------------------
          for (const path of [`/plans/${plan.id}`, `/plans/${plan.id}?focus=dp1`]) {
            await gotoStable(page, path);
            await expectReadOnlyBoard(page, chip);
          }

          // A focus mode with no groupings keeps the timetable: the compute prompt is an editor's.
          await gotoStable(page, `/plans/${plan.id}?focus=dp2`);
          await expect(cell(page, SLOT, "DP2")).toBeVisible();
          await expect(page.getByRole("button", { name: "Compute groupings" })).toHaveCount(0);
          for (const control of boardWriteControls(page, chip)) await expect(control).toHaveCount(0);

          // --- Courses, and the overlap dialog ---------------------------------------------------
          await gotoStable(page, `/plans/${plan.id}/courses`);
          const overlapBadge = page.getByRole("button", { name: `View overlaps for ${linked}` });
          await expect(overlapBadge).toBeVisible();
          for (const name of ["New course", "New merge", "Course actions"]) {
            await expect(page.getByRole("button", { name })).toHaveCount(0);
          }
          const overlaps = page.getByRole("dialog");
          await clickToReveal(overlapBadge, overlaps.getByRole("heading", { name: `Overlaps — ${linked}` }));
          await expect(overlaps.getByText(placed, { exact: true })).toBeVisible();
          await expect(overlaps.getByRole("button", { name: `Remove overlap with ${placed}` })).toHaveCount(0);
          await expect(overlaps.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
          await expect(overlaps.getByRole("combobox")).toHaveCount(0);
          await page.keyboard.press("Escape");
          await expect(overlaps).toBeHidden();

          // --- Teachers, the availability dialog, and the teacher's view -------------------------
          await gotoStable(page, `/plans/${plan.id}/teachers`);
          const availabilityBadge = page.getByRole("button", {
            name: `View availability for ${teacher} (1 constrained cells)`,
          });
          await expect(availabilityBadge).toBeVisible();
          await expect(page.getByRole("button", { name: "New teacher" })).toHaveCount(0);
          await expectViewPlanOnly(page, page.getByRole("button", { name: "Teacher actions" }));

          const availability = page.getByRole("dialog");
          const grid = availability.getByRole("grid", { name: `Availability — ${teacher}` });
          await clickToReveal(availabilityBadge, grid);
          await expect(grid.getByRole("gridcell", { name: "Mon P1: soft (prefers not)" })).toBeVisible();
          await expect(availability.getByRole("button", { name: /^Cycle the whole/ })).toHaveCount(0);
          await expect(availability.getByRole("button", { name: /^Mon P1:/ })).toHaveCount(0);
          await page.keyboard.press("Escape");
          await expect(availability).toBeHidden();

          await page.getByRole("link", { name: teacher, exact: true }).click();
          await page.waitForURL(/\/teachers\/[0-9a-f-]{36}$/);
          const teacherGrid = page.getByRole("grid", { name: `${teacher} timetable` });
          await expect(teacherGrid.getByRole("gridcell", { name: SLOT })).toContainText(chip);

          // --- Students, and the student's view --------------------------------------------------
          await gotoStable(page, `/plans/${plan.id}/students`);
          await expect(page.getByRole("link", { name: student, exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "New student" })).toHaveCount(0);
          // Selection exists only to feed the bulk edit: no row checkbox and no select-all.
          await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(0);
          await expectViewPlanOnly(page, page.getByRole("button", { name: "Student actions" }));

          await page.getByRole("link", { name: student, exact: true }).click();
          await page.waitForURL(/\/students\/[0-9a-f-]{36}$/);
          const studentGrid = page.getByRole("grid", { name: `${student} timetable` });
          await expect(studentGrid.getByRole("gridcell", { name: SLOT })).toContainText(chip);
        } finally {
          await deletePlan(authorPage, clone.name);
        }
      } finally {
        await deletePlan(authorPage, plan.name);
      }
    } finally {
      await author.close();
    }
  });
});

/**
 * The board's write controls, for one bi-weekly chip at `SLOT` in DP1: Generate, undo, the palette's
 * toggle (whichever of rail or collapse is showing), the shelf, the chip's "⋯" menu and A/B toggle,
 * and the cell's Duplicate and Lift to shelf. The author's board shows every one; a viewer's none.
 */
const boardWriteControls = (page: Page, chip: string): Locator[] => {
  const slot = cell(page, SLOT);
  return [
    page.getByRole("button", { name: "Generate plan" }),
    page.getByRole("button", { name: /^Undo/ }),
    page.getByRole("button", { name: /^(Open|Collapse) palette/ }),
    page.getByRole("complementary", { name: "Shelf" }),
    chipMenuTrigger(page, SLOT, chip),
    slot.getByRole("radio", { name: "Week A" }),
    slot.getByRole("button", { name: /^Duplicate/ }),
    slot.getByRole("button", { name: "Lift to shelf", exact: true }),
  ];
};

/** The board renders the placed chip, read-only (no drag), and its read controls, and no write control. */
async function expectReadOnlyBoard(page: Page, chip: string): Promise<void> {
  // The chip and the toolbar first, so every absence below is on a board that has rendered.
  await expect(placedChip(page, SLOT, chip)).toBeVisible();
  // dnd-kit mirrors a draggable's `disabled` onto `aria-disabled`: this is the drag itself.
  await expect(placedChip(page, SLOT, chip)).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "Export plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  await expect(page.getByText("View only", { exact: true })).toBeVisible();
  for (const control of boardWriteControls(page, chip)) await expect(control).toHaveCount(0);
}

/** Open a catalog row's kebab and assert "View plan" is its only item, then close it. */
async function expectViewPlanOnly(page: Page, trigger: Locator): Promise<void> {
  const menu = page.getByRole("menu");
  await clickToReveal(trigger, menu.getByRole("menuitem", { name: "View plan" }));
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

// --- Author-side arrangement (local: no other spec authors these) ---------------------------------

/**
 * Mark the teacher's Monday P1 "soft" through the availability dialog, then wait for the row's
 * server-loaded badge to count it. The dialog's cells save optimistically and nothing on screen says
 * when the write has landed, so the page is re-read until the badge appears.
 */
async function markSoftUnavailable(page: Page, planId: string, teacher: string): Promise<void> {
  await gotoStable(page, `/plans/${planId}/teachers`);
  await clickToReveal(
    page.getByRole("button", { name: "Teacher actions" }),
    page.getByRole("menuitem", { name: "Edit availability" }),
  );
  await page.getByRole("menuitem", { name: "Edit availability" }).click();
  const dialog = page.getByRole("dialog");
  // The column and row cyclers the viewer's grid must not have.
  await expect(dialog.getByRole("button", { name: "Cycle the whole Mon column" })).toBeVisible();
  await dialog.getByRole("button", { name: "Mon P1: available" }).click();
  await expect(dialog.getByRole("button", { name: "Mon P1: soft (prefers not)" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  const badge = page.getByRole("button", { name: `Edit availability for ${teacher} (1 constrained cells)` });
  await expect(async () => {
    await gotoStable(page, `/plans/${planId}/teachers`);
    await expect(badge).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Switch a just-created course's schedule to bi-weekly through the catalog editor. The row is matched
 * by text, not by an exact cell name: the badge this adds joins the cell's name.
 */
async function makeBiweekly(page: Page, planId: string, course: string): Promise<void> {
  await gotoStable(page, `/plans/${planId}/courses`);
  const row = page.getByRole("row").filter({ hasText: course });
  await clickToReveal(
    row.getByRole("button", { name: "Course actions" }),
    page.getByRole("menuitem", { name: "Edit" }),
  );
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Edit course" })).toBeVisible();
  await selectFromCombobox(page, dialog.getByRole("combobox", { name: "Schedule" }), "Bi-weekly (A/B)");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText("Bi-weekly", { exact: true })).toBeVisible();
}

/** Link `dependent` to `base` through the overlap manager, and wait for the row's badge. */
async function linkOverlap(page: Page, planId: string, dependent: string, base: string): Promise<void> {
  await gotoStable(page, `/plans/${planId}/courses`);
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: dependent, exact: true }) });
  await clickToReveal(
    row.getByRole("button", { name: "Course actions" }),
    page.getByRole("menuitem", { name: "Manage overlaps" }),
  );
  await page.getByRole("menuitem", { name: "Manage overlaps" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Overlaps — ${dependent}` })).toBeVisible();
  await selectFromCombobox(page, dialog.getByRole("combobox"), base);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  // The remove control the viewer's dialog must not have.
  await expect(dialog.getByRole("button", { name: `Remove overlap with ${base}` })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: `Manage overlaps for ${dependent}` })).toBeVisible();
}
