import { test, expect, type Locator, type Page } from "@playwright/test";
import { collisionBadge, computeGroupings, display, placeFromPalette, placedChip } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Cohort switching + cross-cohort teacher occupancy — browser-level coverage (plan Phase 3,
// context/changes/cohort-switching/plan.md).
//
// Risk protected (context/foundation/test-plan.md Risk #6, roadmap S-04): the enriched
// cross-cohort symmetric teacher-occupancy class could mark a placement *valid* that the
// richer rule should reject. The same teacher placed in BOTH cohorts at the same slot in an
// overlapping week is a real, blocking collision. This is browser-level because it only
// materialises when auth → routing (the `?cohort=` switch) → SSR sibling-occupancy projection
// → the rendered, interactive board integrate: the validator is *aware of* the other cohort
// only through the server-projected index, and the switcher remounts the island onto it.
//
// What this spec proves that the unit parity guards (collision-parity.test.ts) cannot:
//   1. The DP1/DP2 switcher navigates and remounts the board onto the other cohort (real SSR).
//   2. A real committed placement of a shared teacher in both cohorts surfaces the blocking
//      flag (destructive chip + collision dialog) — and does so SYMMETRICALLY, on whichever
//      cohort you view — while a cohort with no sibling occupancy stays clean (over-rejection
//      guard built into the flow: DP1 is neutral until the DP2 placement exists).
//
// Authenticated `chromium` project (reuses storageState from auth.setup). Modeled on
// e2e/specs/co-teaching.spec.ts; conventions in e2e/CLAUDE.md. The plan owns a uniquely named
// plan and tears it down by deleting the plan (cascades to every child entity).
//
// Concrete shared teacher/course pair the spec provisions (the plan's seed prerequisite):
//   teacher `SHR…`  teaches  `Maths DP1` (cohort dp1)  AND  `Maths DP2` (cohort dp2).
// Both courses are week-agnostic ("Every week"), so a same-slot placement overlaps every week —
// the blocking case. The plan edits one cohort at a time (the board shows a single cohort).

test.describe("cohort switching + cross-cohort teacher occupancy", () => {
  // This flow builds catalog across four pages in two cohorts, computes groupings twice, and
  // drags onto the board — well past the 30s default.
  test.describe.configure({ timeout: 120_000 });

  test("a shared teacher placed in both cohorts at the same slot flags blocking on both, symmetrically", async ({
    page,
  }) => {
    const id = shortId();
    const teacher = `SHR${id}`;
    const dp1Course = `Maths DP1 ${id}`;
    const dp2Course = `Maths DP2 ${id}`;
    const dp1Display = display(dp1Course);
    const dp2Display = display(dp2Course);
    const slot = "Wed, P5";

    const plan = await createPlan(page, "cohort-switching");

    // One teacher, teaching a placeable course in EACH cohort. A course is placeable only once a
    // student in its cohort chooses it (the grouping catalog is choice-driven), so each course
    // gets a single-choice student.
    await createTeacher(page, plan.id, teacher);
    await createCourse(page, plan.id, { name: dp1Course, cohort: "DP1", teacher });
    await createCourse(page, plan.id, { name: dp2Course, cohort: "DP2", teacher });
    await createStudent(page, plan.id, { name: `Stu DP1 ${id}`, cohort: "DP1", course: dp1Course });
    await createStudent(page, plan.id, { name: `Stu DP2 ${id}`, cohort: "DP2", course: dp2Course });

    // --- DP1: place the shared teacher's course; with no DP2 sibling yet, it is NOT a collision.
    await gotoStable(page, `/plans/${plan.id}`);
    await computeGroupings(page, dp1Display);
    await placeFromPalette(page, dp1Display, slot);
    await expect(collisionBadge(page, slot)).toHaveCount(0); // over-rejection guard: clean until a sibling exists

    // --- DP2: place the same teacher's DP2 course at the SAME slot — now the cross-cohort
    //         occupancy is real, so DP2 flags blocking and names DP1 as the other cohort.
    await switchCohort(page, "DP2");
    await computeGroupings(page, dp2Display);
    await placeFromPalette(page, dp2Display, slot);
    await expect(placedChip(page, slot, dp2Display)).toHaveAttribute("aria-invalid", "true");
    await openCollisionDialog(page, slot);
    await expect(otherCohortViolation(page)).toContainText(`${teacher} is also teaching in DP1 at this time`);
    await closeDialog(page);

    // --- Symmetry: switch back to DP1 — the very same clash now reads blocking there too, naming DP2.
    await switchCohort(page, "DP1");
    await expect(placedChip(page, slot, dp1Display)).toHaveAttribute("aria-invalid", "true");
    await openCollisionDialog(page, slot);
    await expect(otherCohortViolation(page)).toContainText(`${teacher} is also teaching in DP2 at this time`);
    await closeDialog(page);

    await deletePlan(page, plan.name);
  });
});

/** The "Other cohort" cross-cohort violation line inside the open collision dialog. */
const otherCohortViolation = (page: Page): Locator =>
  page.getByRole("dialog").getByRole("listitem").filter({ hasText: "is also teaching in" });

// --- Spec-specific flow helpers (shared board/catalog plumbing lives in ../support) -----------

/**
 * Switch the active cohort via the switcher `Tabs` control (full SSR remount). Asserts the remount
 * landed on `cohort` (its tab is now selected, the sibling's is not). This holds whether the target
 * board is populated or still on its compute-groupings empty state, so it is the stable proof of the
 * remount; the cohort-correct *board* is then proven by what follows.
 */
async function switchCohort(page: Page, cohort: "DP1" | "DP2"): Promise<void> {
  const sibling = cohort === "DP1" ? "DP2" : "DP1";
  const switcher = page.getByRole("tablist", { name: "Board view" });
  await switcher.getByRole("tab", { name: cohort }).click();
  await page.waitForURL(new RegExp(`cohort=${cohort.toLowerCase()}`));
  await expect(switcher.getByRole("tab", { name: cohort, selected: true })).toBeVisible(); // landed on it
  await expect(switcher.getByRole("tab", { name: sibling, selected: false })).toBeVisible(); // sibling is not
}

/** Open the collision details dialog for `slot` and wait for it to render. */
async function openCollisionDialog(page: Page, slot: string): Promise<void> {
  await collisionBadge(page, slot).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: /^Collisions —/ })).toBeVisible();
}

/** Close the open dialog (the dialog modally aria-hides the board, so reads need it closed). */
async function closeDialog(page: Page): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}
