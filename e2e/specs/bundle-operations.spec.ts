import { test, expect, type Page } from "@playwright/test";
import {
  cell,
  computeGroupings,
  display,
  dragChip,
  expectBundled,
  expectEmpty,
  expectNotBundled,
  expectOccupants,
  groupCell,
  groupingBox,
  moveBundle,
  placeGrouping,
  removeBundle,
  ungroupCell,
} from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// First-class bundle operations — browser-level coverage (plan Phase 5,
// context/changes/first-class-bundle-operations/plan.md §2; manual smoke steps 1–6).
//
// What these specs prove that the unit transitions (placement-transitions.test.ts) and the RPC
// integration tests (move/remove_bundle_members) cannot: that the whole-cell bundle gestures —
// place-a-grouping, relocate, merge, bulk-remove, and the ephemeral ungroup toggle with per-chip
// drag — work through a REAL board (auth → SSR → hydration → dnd-kit drag → Astro Action →
// Supabase RPC → re-derived render). The unit layer proves the state transition; only this proves
// the user can perform the gesture and see the result. Each spec owns a uniquely named plan and
// tears it down by deleting it (cascades to every child entity). Conventions: e2e/CLAUDE.md;
// shared board plumbing in ../support/board.ts.
//
// A bundle is a cell with >=2 occupants. We build one the way an author does: each course gets its
// own teacher and a single-choice student, so the courses are mutually co-runnable and the
// grouping algorithm yields ONE multi-member grouping box. Dragging that box onto a cell fans one
// placement per member in → a clean, collision-free bundle (the bundle chrome, not a collision
// badge, is what the assertions read).

test.describe("first-class bundle operations", () => {
  // Each flow builds catalog across courses/students pages, computes groupings, and drives several
  // drags — well past the 30s default.
  test.describe.configure({ timeout: 120_000 });

  test("a grouping placed as a bundle relocates into an empty cell, then bulk-removes", async ({ page }) => {
    const id = shortId();
    const alphaCourse = `Alpha ${id}`;
    const bravoCourse = `Bravo ${id}`;
    const alpha = display(alphaCourse);
    const bravo = display(bravoCourse);
    const origin = "Wed, P5";
    const empty = "Wed, P6";

    const plan = await createPlan(page, "bundle-ops-move-remove");
    await provisionCourses(page, plan.id, id, [alphaCourse, bravoCourse]);

    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    // Mutually co-runnable courses → one grouping box; wait for it as the compute landmark.
    await computeGroupings(page, groupingBox(page, 2));

    // --- Place a grouping as a bundle: one gesture drops both members into the cell.
    await placeGrouping(page, [alpha, bravo], origin);
    await expectBundled(page, origin);
    await expectOccupants(page, origin, [alpha, bravo]);

    // --- Relocate: drag the whole bundle onto an empty cell. Identity-preserving move — both
    //     members land together, the source empties, no transient duplicate flag.
    await moveBundle(page, origin, empty, alpha);
    await expectOccupants(page, empty, [alpha, bravo]);
    await expectBundled(page, empty);
    await expectEmpty(page, origin);

    // --- Bulk remove: the trash empties the whole bundle in one action (no orphan left behind).
    await removeBundle(page, empty);
    await expectEmpty(page, empty);

    await deletePlan(page, plan.name);
  });

  test("ungroup explodes a bundle for per-chip ops; a chip drags out, and the remainder merges onto it", async ({
    page,
  }) => {
    const id = shortId();
    const alphaCourse = `Alpha ${id}`;
    const bravoCourse = `Bravo ${id}`;
    const charlieCourse = `Charlie ${id}`;
    const alpha = display(alphaCourse);
    const bravo = display(bravoCourse);
    const charlie = display(charlieCourse);
    const origin = "Wed, P5";
    const target = "Thu, P3";

    const plan = await createPlan(page, "bundle-ops-ungroup-merge");
    await provisionCourses(page, plan.id, id, [alphaCourse, bravoCourse, charlieCourse]);

    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, groupingBox(page, 3));

    // Build a three-course bundle from the grouping box.
    await placeGrouping(page, [alpha, bravo, charlie], origin);
    await expectBundled(page, origin);
    await expectOccupants(page, origin, [alpha, bravo, charlie]);

    // While grouped, per-chip affordances are inert — the slot moves as one unit (FR-010).
    const removeCharlie = cell(page, origin).getByRole("button", {
      name: `Remove ${charlie}`,
      exact: true,
    });
    await expect(removeCharlie).toHaveCount(0);

    // --- Ungroup: a pure in-session presentation flip (no server write). The chips become
    //     individually operable — the per-chip remove appears.
    await ungroupCell(page, origin);
    await expect(removeCharlie).toBeVisible();

    // --- A loose chip drags out on its own: it leaves the source bundle and lands alone, so the
    //     target reads as a single (non-bundled) occupant and the source drops to two.
    await dragChip(page, charlie, origin, target);
    await expectOccupants(page, target, [charlie]);
    await expectNotBundled(page, target);
    await expectOccupants(page, origin, [alpha, bravo]);

    // --- Merge: re-collapse the remainder, then drop it onto the occupied target. The movers join
    //     the destination's bundle → one merged three-member bundle; the source empties.
    await groupCell(page, origin);
    await moveBundle(page, origin, target, alpha);
    await expectOccupants(page, target, [alpha, bravo, charlie]);
    await expectBundled(page, target);
    await expectEmpty(page, origin);

    await deletePlan(page, plan.name);
  });
});

/**
 * Provision one DP1 course per name, each with its own teacher (so the courses never collide when
 * co-located) and a single-choice student (so each course is placeable). Mutually co-runnable, so
 * the grouping algorithm yields one multi-member grouping the bundle specs drag as a unit.
 */
async function provisionCourses(page: Page, planId: string, id: string, courses: string[]): Promise<void> {
  for (const [i, course] of courses.entries()) {
    const teacher = `T${i + 1}${id}`;
    await createTeacher(page, planId, teacher);
    await createCourse(page, planId, { name: course, cohort: "DP1", teacher });
    await createStudent(page, planId, { name: `Stu ${course} ${id}`, cohort: "DP1", course });
  }
}
