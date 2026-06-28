import { expect, test, type Page } from "@playwright/test";
import {
  cell,
  computeGroupings,
  display,
  expectBundled,
  expectEmpty,
  expectOccupants,
  groupingBox,
  parkedCard,
  placeBackOnto,
  placeGrouping,
  shelf,
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

    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
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
    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await expect(parkedBadge(page)).toHaveText(/1\s+parked/);

    // Open the drawer and confirm the parked card persisted.
    await parkedBadge(page).click();
    await expect(parkedCard(page)).toBeVisible();

    // Drag the parked card back onto an empty slot → it places and the shelf empties.
    await placeBackOnto(page, cell(page, target), alpha);
    await expectOccupants(page, target, [alpha, bravo]);
    await expect(parkedBadge(page)).toHaveCount(0);

    await deletePlan(page, plan.name);
  });

  test("a palette grouping parks directly onto the shelf; re-dropping it parks a second copy", async ({ page }) => {
    const id = shortId();
    const alphaCourse = `Alpha ${id}`;
    const bravoCourse = `Bravo ${id}`;

    const plan = await createPlan(page, "shelf-park-grouping");
    await provisionCourses(page, plan.id, id, [alphaCourse, bravoCourse]);

    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, groupingBox(page, 2));

    // Park the grouping straight from the palette (never placed on the board) onto the shelf.
    await parkGroupingFromPalette(page, 2);
    await expect(parkedBadge(page)).toHaveText(/1\s+parked/);

    // Open + pin the drawer so it stays expanded across the next drop (stable target, no auto-collapse).
    await parkedBadge(page).click();
    await shelf(page).getByRole("button", { name: "Pin shelf open" }).click();
    await expect(parkedCard(page)).toHaveCount(1);

    // Re-drop the SAME grouping → parks a SECOND copy (duplicating is intentional, by author decision).
    // Guard the retry on the card count so a missed drop retries without ever over-parking.
    await expect(async () => {
      if ((await parkedCard(page).count()) >= 2) return;
      await steppedDrag(page, groupingBox(page, 2), shelf(page));
      await expect(parkedCard(page)).toHaveCount(2, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(parkedBadge(page)).toHaveText(/2\s+parked/);

    await deletePlan(page, plan.name);
  });
});

// --- Shelf locators + gestures (local to this first shelf spec; promote on a second consumer) ---

/**
 * Lift the bundle at `slot` to the shelf via its header control, then wait for the cell to empty.
 * Idempotent + retried like the other board verbs: `shelveBundle` is a no-op while the just-placed
 * occupants are still optimistically `pending`, so retry the click until the source clears, skipping
 * once it is already empty (no header → no lift button). `force` for the same dnd-kit aria-disabled
 * inheritance reason as `duplicateInto`.
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
 * The always-visible "N parked" summary-bar cue (also the expand affordance). Absent when nothing
 * is parked. Anchored at the start (`"1 parked — open shelf"`) so it never matches the collapsed
 * drawer tab (`"Open shelf (1 parked)"`). Single-board only — the combined view has no summary bar.
 */
const parkedBadge = (page: Page) => page.getByRole("button", { name: /^\d+ parked/ });

/**
 * Drag a `count`-member palette grouping box onto the shelf to park it directly. Idempotent +
 * retried like the other board verbs — skip once the badge shows a parked bundle.
 */
async function parkGroupingFromPalette(page: Page, count: number): Promise<void> {
  await expect(async () => {
    if ((await parkedBadge(page).count()) > 0) return; // already parked
    await steppedDrag(page, groupingBox(page, count), shelf(page));
    await expect(parkedBadge(page)).toBeVisible({ timeout: 2_000 });
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
