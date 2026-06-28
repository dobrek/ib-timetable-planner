import { expect, test, type Page } from "@playwright/test";
import {
  cell,
  computeGroupings,
  display,
  expectBundled,
  expectEmpty,
  expectOccupants,
  groupingBox,
  placeGrouping,
} from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Editing undo/redo (S-08, FR-013) end-to-end. What the unit/hook tests and the RPC integration
// round-trip can't prove: that ⌘Z reverses an edit through the REAL stack (optimistic → Astro Action
// → Supabase → re-render), that the reversal is DURABLE (survives a reload because undo wrote
// through), and that the session stack clears on reload (both buttons disabled). Plus the keyboard
// loop + toolbar disabled→enabled transitions + next-step tooltip. Single board (`?focus=dp1`) so the
// PlanSummaryBar with the Undo/Redo controls is present. Conventions: e2e/CLAUDE.md.

test.describe("editing undo / redo", () => {
  test.describe.configure({ timeout: 120_000 });

  test("the durability contract: ⌘Z reverses an edit, the reversal survives reload, the stack clears", async ({
    page,
  }) => {
    const id = shortId();
    const alphaCourse = `Alpha ${id}`;
    const bravoCourse = `Bravo ${id}`;
    const alpha = display(alphaCourse);
    const bravo = display(bravoCourse);
    const source = "Mon, P1";

    const plan = await createPlan(page, "undo-durability");
    await provisionCourses(page, plan.id, id, [alphaCourse, bravoCourse]);

    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, groupingBox(page, 2));

    await placeGrouping(page, [alpha, bravo], source);
    await expectBundled(page, source);
    await expectOccupants(page, source, [alpha, bravo]);

    // The placed-group edit settled → Undo is enabled and its tooltip names the step.
    await expect(undoButton(page)).toBeEnabled();
    await expect(undoButton(page)).toHaveAttribute("aria-label", "Undo: Place group at Mon · P1");

    // ⌘Z reverses the placement on screen (writes through to Supabase).
    await page.keyboard.press("ControlOrMeta+z");
    await expectEmpty(page, source);

    // RELOAD — the reversal is durable (undo wrote through), and the session stack is cleared.
    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await expectEmpty(page, source);
    await expect(undoButton(page)).toBeDisabled();
    await expect(redoButton(page)).toBeDisabled();

    await deletePlan(page, plan.name);
  });

  test("the undo/redo loop: keyboard chords step back and forward, including a lift", async ({ page }) => {
    const id = shortId();
    const alphaCourse = `Alpha ${id}`;
    const bravoCourse = `Bravo ${id}`;
    const alpha = display(alphaCourse);
    const bravo = display(bravoCourse);
    const source = "Mon, P1";

    const plan = await createPlan(page, "undo-loop");
    await provisionCourses(page, plan.id, id, [alphaCourse, bravoCourse]);

    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, groupingBox(page, 2));

    await placeGrouping(page, [alpha, bravo], source);
    await expectBundled(page, source);
    await expect(redoButton(page)).toBeDisabled(); // nothing to redo yet

    // ⌘Z removes the bundle → Undo disables, Redo enables and names the step.
    await expect(undoButton(page)).toBeEnabled();
    await page.keyboard.press("ControlOrMeta+z");
    await expectEmpty(page, source);
    await expect(redoButton(page)).toBeEnabled();
    await expect(redoButton(page)).toHaveAttribute("aria-label", "Redo: Place group at Mon · P1");

    // ⌘⇧Z re-applies the placement.
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expectOccupants(page, source, [alpha, bravo]);

    // Lift the bundle to the shelf, then ⌘Z steps back through the error-prone park workflow.
    await liftToShelf(page, source);
    await expectEmpty(page, source);
    await expect(parkedBadge(page)).toHaveText(/1\s+parked/);
    await expect(undoButton(page)).toHaveAttribute("aria-label", "Undo: Lift bundle at Mon · P1");

    await expect(undoButton(page)).toBeEnabled();
    await page.keyboard.press("ControlOrMeta+z");
    await expectOccupants(page, source, [alpha, bravo]);
    await expect(parkedBadge(page)).toHaveCount(0);

    await deletePlan(page, plan.name);
  });
});

// --- Locators + gestures (local to this spec; promote to support/ on a second consumer) ---

const undoButton = (page: Page) => page.getByRole("button", { name: /^Undo/ });
const redoButton = (page: Page) => page.getByRole("button", { name: /^Redo/ });

/** The always-visible "N parked" summary-bar cue (also the expand affordance). */
const parkedBadge = (page: Page) => page.getByRole("button", { name: /^\d+ parked/ });

/**
 * Lift the bundle at `slot` to the shelf via its header control, retried until the cell empties
 * (the lift is a no-op while the just-placed occupants are optimistically `pending`).
 */
async function liftToShelf(page: Page, slot: string): Promise<void> {
  const liftButton = cell(page, slot).getByRole("button", { name: "Lift to shelf", exact: true });
  await expect(async () => {
    if ((await liftButton.count()) === 0) return; // already lifted → cell empty
    await liftButton.click({ force: true });
    await expect(cell(page, slot).getByRole("button")).toHaveCount(0, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Provision one DP1 course per name, each with its own teacher (so they never collide when
 * co-located) and a single-choice student (so each course is placeable) — mutually co-runnable,
 * so the grouping algorithm yields one multi-member grouping for the bundle.
 */
async function provisionCourses(page: Page, planId: string, id: string, courses: string[]): Promise<void> {
  for (const [i, course] of courses.entries()) {
    const teacher = `T${i + 1}${id}`;
    await createTeacher(page, planId, teacher);
    await createCourse(page, planId, { name: course, cohort: "DP1", teacher });
    await createStudent(page, planId, { name: `Stu ${course} ${id}`, cohort: "DP1", course });
  }
}
