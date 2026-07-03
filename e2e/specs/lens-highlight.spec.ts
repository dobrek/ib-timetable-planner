import { test, expect, type Page } from "@playwright/test";
import { computeGroupings, display, placeFromPalette } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Highlight/discovery lens — browser-level coverage of the user-visible contract: the fake-input
// trigger and ⌘K open the same picker; checking a course/teacher builds an OR-union whose criteria
// show in the active-lens bar with per-criterion counts and the union total; per-chip × removes;
// Esc with the picker closed clears the lens. Visual dimming/ring is unit-tested model logic and is
// deliberately NOT asserted here — the bar text and counts are the e2e-assertable outcome.
//
// Fixture: a fresh plan with one 2h course (one teacher, one student) and ONE placement, so the
// course criterion and the teacher criterion both count 1 and their union total stays "1 placement"
// (overlap counts once). Authenticated `chromium` project. Conventions in e2e/CLAUDE.md.

test.describe("board highlight lens", () => {
  // Full catalog authoring + grouping compute + placement + picker flows — past the default 30s.
  test.describe.configure({ timeout: 120_000 });

  test("builds an OR-union via trigger and ⌘K, shows bar counts, removes, and Esc-clears", async ({ page }) => {
    const id = shortId();
    const teacher = `LH${id}`;
    const course = `Optics ${id}`;
    const courseDisplay = display(course);

    const plan = await createPlan(page, "lens-highlight");
    await createTeacher(page, plan.id, teacher);
    await createCourse(page, plan.id, { name: course, cohort: "DP1", teacher });
    await createStudent(page, plan.id, { name: `Stu ${id}`, cohort: "DP1", course });

    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, courseDisplay);
    await placeFromPalette(page, courseDisplay, "Mon, P1");

    // --- Trigger opens the picker; searching + checking the course lights the lens.
    const trigger = page.getByRole("button", { name: "Highlight courses, teachers, students" });
    await trigger.click();
    await expect(pickerSearch(page)).toBeVisible();
    await pickerSearch(page).fill(courseDisplay);
    await page.getByRole("option", { name: courseDisplay }).click();

    const courseChip = page.getByRole("button", { name: `Edit lens criterion ${courseDisplay}` });
    await expect(courseChip).toContainText("·1");
    await expect(page.getByText("1 placement", { exact: true })).toBeVisible();

    // --- First Esc closes the picker only; the committed criterion stays. Wait for the popover to
    // fully unmount (exit animation done): while it is animating out, its Radix layer still owns
    // Escape, so a next Esc pressed into that window is (deliberately) inert.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(courseChip).toBeVisible();

    // --- ⌘K reopens the same picker; adding the teacher grows the union (overlap counts once).
    await page.keyboard.press("ControlOrMeta+k");
    await expect(pickerSearch(page)).toBeVisible();
    await pickerSearch(page).fill(teacher);
    await page.getByRole("option", { name: teacher, exact: true }).click();

    const teacherChip = page.getByRole("button", { name: `Edit lens criterion ${teacher}` });
    await expect(teacherChip).toContainText("·1");
    await expect(page.getByText("1 placement", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0); // fully unmounted — see above

    // --- Per-chip × removes just that criterion.
    await page.getByRole("button", { name: `Remove ${teacher} from lens` }).click();
    await expect(teacherChip).toHaveCount(0);
    await expect(courseChip).toBeVisible();

    // --- Esc with the picker closed clears the whole lens; the bar unmounts.
    await page.keyboard.press("Escape");
    await expect(courseChip).toHaveCount(0);
    await expect(page.getByText("1 placement", { exact: true })).toHaveCount(0);

    await deletePlan(page, plan.name);
  });
});

/** The picker's cmdk search input — the only combobox inside the lens popover (a Radix dialog). */
const pickerSearch = (page: Page) => page.getByRole("dialog").getByRole("combobox");
