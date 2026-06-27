import { expect, test, type Page } from "@playwright/test";
import {
  combinedCell,
  combinedChip,
  computeGroupings,
  display,
  groupingBox,
  parkedCard,
  placeBackOnto,
  shelf,
  steppedDrag,
} from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Combined two-cohort view (S-06) — park a palette grouping straight onto the shelf (combined-view-park-gap).
//
// What this proves that the router unit tests and the single-board shelf spec cannot: in the
// /plans/[id]/combined route, dragging a palette GROUPING (never placed on the board) onto the
// cell-less shelf PARKS it under the palette's active cohort (DP1), and the parked card — tagged
// DP1 — places back into the DP1 column. If the card were mis-tagged (or the park branch reverted),
// the place-back onto a DP1 cell would be rejected by the cross-cohort guard and never land — so the
// landing IS the proof of correct cohort routing. Server durability is already covered by
// shelf-durability.spec.ts over the identical parkMembers → Action → Supabase path, so this spec
// omits the reload leg. Authenticated `chromium` project; teardown by deleting the plan.
// Conventions: e2e/CLAUDE.md; shared board plumbing in ../support/board.ts.

test.describe("combined view — park a palette grouping to the shelf", () => {
  // Builds catalog, computes groupings, then drives the combined board — past the default 30s.
  test.describe.configure({ timeout: 120_000 });

  test("parks a DP1 palette grouping onto the shelf and places it back into the DP1 column", async ({ page }) => {
    const id = shortId();
    const alphaCourse = `Alpha ${id}`;
    const bravoCourse = `Bravo ${id}`;
    const alpha = display(alphaCourse);
    const bravo = display(bravoCourse);
    const target = "Mon, P2";

    const plan = await createPlan(page, "combined-shelf-park");
    await provisionCourses(page, plan.id, id, [alphaCourse, bravoCourse]);

    // Compute the DP1 grouping on the single board first (the reliable seed), then enter the combined view.
    await gotoStable(page, `/plans/${plan.id}`);
    await computeGroupings(page, groupingBox(page, 2));

    await gotoStable(page, `/plans/${plan.id}/combined`);

    // The combined palette defaults collapsed — expand it (DP1 is the default active cohort) so the
    // grouping box becomes draggable.
    await page.getByRole("button", { name: /^Open palette/ }).click();
    await expect(groupingBox(page, 2)).toBeVisible();

    // Park the DP1 grouping straight from the palette onto the shelf → it auto-collapses showing 1 parked.
    await parkGroupingToCombinedShelf(page, 2);

    // Open + pin the drawer so it stays expanded across the place-back drop (stable target, no auto-collapse).
    await page.getByRole("button", { name: "Open shelf (1 parked)" }).click();
    await shelf(page).getByRole("button", { name: "Pin shelf open" }).click();
    await expect(parkedCard(page)).toHaveCount(1);
    // The parked card is tagged with the cohort it was parked under (DP1).
    await expect(parkedCard(page).getByTitle("Parked from DP1")).toBeVisible();

    // Place the parked card back into a DP1 cell → both members land in the DP1 column and the shelf empties.
    await placeBackOnto(page, combinedCell(page, "DP1", target), alpha);
    await expect(combinedChip(page, "DP1", target, alpha)).toBeVisible();
    await expect(combinedChip(page, "DP1", target, bravo)).toBeVisible();
    await expect(parkedCard(page)).toHaveCount(0);

    await deletePlan(page, plan.name);
  });
});

/**
 * Drag a `count`-member palette grouping box onto the combined shelf and wait for the park to land.
 * Idempotent + retried like the other board verbs — skip once the shelf's collapsed tab reports the
 * parked bundle. The combined view has no summary-bar badge, so the post-park signal is the shelf's
 * own collapsed tab (`"Open shelf (1 parked)"`) after `parkMembers` auto-collapses the drawer.
 */
async function parkGroupingToCombinedShelf(page: Page, count: number): Promise<void> {
  const parkedTab = page.getByRole("button", { name: "Open shelf (1 parked)" });
  await expect(async () => {
    if ((await parkedTab.count()) > 0) return; // already parked
    await steppedDrag(page, groupingBox(page, count), shelf(page));
    await expect(parkedTab).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Provision one DP1 course per name, each with its own teacher (so they never collide when
 * co-located) and a single-choice student (so each course is placeable) — mutually co-runnable, so
 * the grouping algorithm yields one multi-member grouping for the park. Local + test-specific
 * (catalog authoring), per e2e/CLAUDE.md.
 */
async function provisionCourses(page: Page, planId: string, id: string, courses: string[]): Promise<void> {
  for (const [i, course] of courses.entries()) {
    const teacher = `T${i + 1}${id}`;
    await createTeacher(page, planId, teacher);
    await createCourse(page, planId, { name: course, cohort: "DP1", teacher });
    await createStudent(page, planId, { name: `Stu ${course} ${id}`, cohort: "DP1", course });
  }
}
