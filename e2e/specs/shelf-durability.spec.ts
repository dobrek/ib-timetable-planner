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
  steppedDrag,
} from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Bundle holding container ("shelf") — the headline Secondary Success Criterion end-to-end
// (plan Phase 4 §8; manual smoke steps 1–3): lift a placed bundle to the shelf, RELOAD the page
// (the parked bundle is server-durable, not localStorage), and drag the parked card back onto an
// empty slot. What the unit/hook tests and the RPC integration test can't prove: that the gesture
// survives a real round-trip — auth → SSR → hydration → optimistic park → Astro Action → Supabase
// shelve_bundle → page reload re-reads shelf_bundles → drag-back → unshelve_bundle → re-render.
//
// Merge / cohort-scope / drawer-collapse stay covered by integration + manual (plan Testing
// Strategy). Each spec owns a uniquely named plan and tears it down by deleting it. Conventions:
// e2e/CLAUDE.md; shared board plumbing in ../support/board.ts.

test.describe("bundle holding container (shelf)", () => {
  // Builds catalog across pages, computes groupings, places a bundle, lifts + reloads + places back.
  test.describe.configure({ timeout: 120_000 });

  test("a lifted bundle survives a reload and drags back onto a slot", async ({ page }) => {
    const id = shortId();
    const alphaCourse = `Alpha ${id}`;
    const bravoCourse = `Bravo ${id}`;
    const alpha = display(alphaCourse);
    const bravo = display(bravoCourse);
    const source = "Mon, P1";
    const target = "Mon, P2";

    const plan = await createPlan(page, "shelf-durability");
    await provisionCourses(page, plan.id, id, [alphaCourse, bravoCourse]);

    await gotoStable(page, `/plans/${plan.id}`);
    // Mutually co-runnable courses → one grouping box; wait for it as the compute landmark.
    await computeGroupings(page, groupingBox(page, 2));

    await placeGrouping(page, [alpha, bravo], source);
    await expectBundled(page, source);
    await expectOccupants(page, source, [alpha, bravo]);

    // Lift the whole bundle to the shelf via the cell's "Lift to shelf" control.
    await liftToShelf(page, source);
    await expectEmpty(page, source);
    await expect(parkedBadge(page)).toHaveText(/1\s+parked/);

    // RELOAD — the parked bundle is server-durable, so it must still be there after a hard reload.
    await gotoStable(page, `/plans/${plan.id}`);
    await expect(parkedBadge(page)).toHaveText(/1\s+parked/);

    // Open the drawer and confirm the parked card persisted.
    await parkedBadge(page).click();
    await expect(parkedCard(page)).toBeVisible();

    // Drag the parked card back onto an empty slot → it places and the shelf empties.
    await placeBackOnto(page, target, alpha);
    await expectOccupants(page, target, [alpha, bravo]);
    await expect(parkedBadge(page)).toHaveCount(0);

    await deletePlan(page, plan.name);
  });
});

// --- Shelf locators + gestures (local to this first shelf spec; promote on a second consumer) ---

/** The cell's "Lift to shelf" control. `force` for the same dnd-kit aria-disabled inheritance reason as duplicateInto. */
async function liftToShelf(page: Page, slot: string): Promise<void> {
  await cell(page, slot).getByRole("button", { name: "Lift to shelf", exact: true }).click({ force: true });
}

/** The always-visible "N parked" summary-bar cue (also the expand affordance). Absent when nothing is parked. */
const parkedBadge = (page: Page) => page.getByRole("button", { name: /\d+ parked/ });

/** The expanded shelf drawer is a named complementary landmark; the parked card carries its roledescription. */
const parkedCard = (page: Page) =>
  page.getByRole("complementary", { name: "Shelf" }).locator('[aria-roledescription="parked bundle"]');

/**
 * Drag the parked card onto `toSlot` and wait for it to land. Idempotent + retried like the board
 * drag helpers: skip if a member already landed (so a missed drop retries without double-placing).
 */
async function placeBackOnto(page: Page, toSlot: string, member: string): Promise<void> {
  const landed = cell(page, toSlot).getByRole("button", { name: new RegExp(`^${member}`) });
  await expect(async () => {
    if ((await landed.count()) > 0) return;
    await steppedDrag(page, parkedCard(page), cell(page, toSlot));
    await expect(landed).toBeVisible({ timeout: 2_000 });
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
