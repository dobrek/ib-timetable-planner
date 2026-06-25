import { test, type Page } from "@playwright/test";
import {
  computeGroupings,
  display,
  duplicateInto,
  expectBundled,
  expectNotBundled,
  expectOccupants,
  groupingBox,
  placeFromPalette,
  placeGrouping,
} from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Bundle duplication — browser-level coverage (plan Phase 4,
// context/changes/bundle-duplication/plan.md §1; manual smoke steps 1, 3).
//
// What this proves that the unit search (duplicate-target.test.ts), the hook tests
// (use-placements.test.tsx), and the RPC integration test (duplicate-operations) cannot: that the
// duplicate GESTURE works through a REAL board (auth → SSR → hydration → click → conflict-free
// search → optimistic fan-out → Astro Action → Supabase place_course → re-derived render) and lands
// at the deterministic, column-major after-source target while the source is retained (a copy, not
// a move). Each spec owns a uniquely named plan and tears it down by deleting it. Conventions:
// e2e/CLAUDE.md; shared board plumbing in ../support/board.ts.
//
// The target is deterministic by construction: the search scans column-major starting at the cell
// AFTER the source, so duplicating "Mon, P1" lands at "Mon, P2" (next period down the same day) on
// an otherwise-empty board. Co-runnable courses (each its own teacher + single-choice student) keep
// the copy collision-free, so the bundle chrome — not a collision badge — is what the asserts read.

test.describe("bundle duplication", () => {
  // Each flow builds catalog across pages, computes groupings, and drives a place + a duplicate —
  // well past the 30s default.
  test.describe.configure({ timeout: 120_000 });

  test("a placed bundle duplicates into the next free slot below, leaving the source", async ({ page }) => {
    const id = shortId();
    const alphaCourse = `Alpha ${id}`;
    const bravoCourse = `Bravo ${id}`;
    const alpha = display(alphaCourse);
    const bravo = display(bravoCourse);
    const source = "Mon, P1";
    const target = "Mon, P2"; // next column-major cell after the source (down the same day)

    const plan = await createPlan(page, "dup-bundle");
    await provisionCourses(page, plan.id, id, [alphaCourse, bravoCourse]);

    await gotoStable(page, `/plans/${plan.id}`);
    // Mutually co-runnable courses → one grouping box; wait for it as the compute landmark.
    await computeGroupings(page, groupingBox(page, 2));

    await placeGrouping(page, [alpha, bravo], source);
    await expectBundled(page, source);
    await expectOccupants(page, source, [alpha, bravo]);

    // Duplicate the whole cell → the copy lands at the deterministic next-period-down target,
    // forming an independent bundle there.
    await duplicateInto(page, source, target, alpha);
    await expectOccupants(page, target, [alpha, bravo]);
    await expectBundled(page, target);
    // The source still holds its courses — a duplicate, not a move.
    await expectOccupants(page, source, [alpha, bravo]);

    await deletePlan(page, plan.name);
  });

  test("a single-occupant cell duplicates via the always-visible icon", async ({ page }) => {
    const id = shortId();
    const soloCourse = `Solo ${id}`;
    const solo = display(soloCourse);
    const source = "Mon, P1";
    const target = "Mon, P2";

    const plan = await createPlan(page, "dup-single");
    await provisionCourses(page, plan.id, id, [soloCourse]);

    await gotoStable(page, `/plans/${plan.id}`);
    // A single placeable course → a 1-member grouping, rendered as a palette chip.
    await computeGroupings(page, solo);

    await placeFromPalette(page, solo, source);
    await expectOccupants(page, source, [solo]);
    await expectNotBundled(page, source);

    await duplicateInto(page, source, target, solo);
    await expectOccupants(page, target, [solo]);
    await expectNotBundled(page, target);
    await expectOccupants(page, source, [solo]); // source retained

    await deletePlan(page, plan.name);
  });
});

/**
 * Provision one DP1 course per name, each with its own teacher (so the courses never collide when
 * co-located) and a single-choice student (so each course is placeable). Mutually co-runnable, so
 * the grouping algorithm yields one multi-member grouping for the bundle case (or one 1-member
 * grouping for the single-occupant case).
 */
async function provisionCourses(page: Page, planId: string, id: string, courses: string[]): Promise<void> {
  for (const [i, course] of courses.entries()) {
    const teacher = `T${i + 1}${id}`;
    await createTeacher(page, planId, teacher);
    await createCourse(page, planId, { name: course, cohort: "DP1", teacher });
    await createStudent(page, planId, { name: `Stu ${course} ${id}`, cohort: "DP1", course });
  }
}
