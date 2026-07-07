import { test, expect, type Page } from "@playwright/test";
import {
  chipMenuSelect,
  computeGroupings,
  display,
  expectBundled,
  groupingBox,
  placedChip,
  placeGrouping,
  ungroupCell,
} from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { clickToReveal, createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Optional subject in bundle (optional-subject-in-bundle plan Phase 4 #5) — the one browser-level
// guard for the flagship flow: ungroup a placed bundle, mark a member optional through its "⋯"
// menu, see the durable cue on the chip (`data-optional`) AND the review checklist in the
// courses-left popover ("Optional" section, per-course count), then accept it back and see both
// clear. What the unit/integration layers cannot prove: the real gesture chain (menu → Astro
// Action → Supabase column → re-derived render) and the popover wiring over live island state.
// Conventions: e2e/CLAUDE.md; shared board plumbing in ../support/board.ts.

test.describe("optional subject in bundle", () => {
  // Catalog authoring + grouping compute + several menu/popover round-trips — past the 30s default.
  test.describe.configure({ timeout: 120_000 });

  test("mark via the chip menu shows the chip cue + popover section; accept clears both", async ({ page }) => {
    const id = shortId();
    const alphaCourse = `Alpha ${id}`;
    const bravoCourse = `Bravo ${id}`;
    const alpha = display(alphaCourse);
    const bravo = display(bravoCourse);
    const slot = "Tue, P4";

    const plan = await createPlan(page, "optional-subject");
    await provisionCourses(page, plan.id, id, [alphaCourse, bravoCourse]);

    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, groupingBox(page, 2));

    // Build the bundle and expose the per-member verbs (the menu gates on ungrouped, like remove).
    await placeGrouping(page, [alpha, bravo], slot);
    await expectBundled(page, slot);
    await ungroupCell(page, slot);

    // --- Mark one member optional through its "⋯" menu; the chip carries the durable cue.
    // Retried like the other board verbs: the row may still be optimistically pending right after
    // the place, in which case the menu trigger is disabled and a single attempt would be dropped.
    const bravoChip = placedChip(page, slot, bravo);
    await expect(async () => {
      if ((await bravoChip.getAttribute("data-optional")) === "true") return;
      await chipMenuSelect(page, slot, bravo, "Mark as optional");
      await expect(bravoChip).toHaveAttribute("data-optional", "true", { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(placedChip(page, slot, alpha)).not.toHaveAttribute("data-optional", "true");

    // --- The popover gains the "Optional" review section with the course + its count.
    const trigger = page.getByRole("button", { name: /show breakdown/ });
    const popover = page.getByRole("dialog");
    await clickToReveal(trigger, popover);
    await expect(popover.getByText("Optional", { exact: true })).toBeVisible();
    const optionalRow = popover.locator('[data-slot="optional-course-row"]');
    await expect(optionalRow).toHaveCount(1);
    await expect(optionalRow).toContainText(bravo);
    await expect(optionalRow).toContainText("1 optional");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);

    // --- Accept through the same menu: the chip cue clears…
    await expect(async () => {
      if ((await bravoChip.getAttribute("data-optional")) !== "true") return;
      await chipMenuSelect(page, slot, bravo, "Accept");
      await expect(bravoChip).not.toHaveAttribute("data-optional", "true", { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    // --- …and the popover section disappears with the last pending decision.
    await clickToReveal(trigger, popover);
    await expect(popover.getByText("Course placement")).toBeVisible();
    await expect(popover.getByText("Optional", { exact: true })).toHaveCount(0);
    await expect(popover.locator('[data-slot="optional-course-row"]')).toHaveCount(0);

    await deletePlan(page, plan.name);
  });
});

/**
 * Provision one DP1 course per name, each with its own teacher (so the pair is co-runnable into
 * one grouping box) and a single-choice student (so each course is placeable) — the same shape
 * bundle-operations uses to build a clean, collision-free bundle.
 */
async function provisionCourses(page: Page, planId: string, id: string, courses: string[]): Promise<void> {
  for (const [i, course] of courses.entries()) {
    const teacher = `T${i + 1}${id}`;
    await createTeacher(page, planId, teacher);
    await createCourse(page, planId, { name: course, cohort: "DP1", teacher });
    await createStudent(page, planId, { name: `Stu ${course} ${id}`, cohort: "DP1", course });
  }
}
