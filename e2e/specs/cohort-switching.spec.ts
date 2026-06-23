import { test, expect, type Locator, type Page } from "@playwright/test";
import { clickToReveal, createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

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

/** The board's display name for a course: spaces collapse to underscores (no level/group here). */
const display = (name: string) => name.replaceAll(/ /g, "_");

/** Escape a string for safe embedding in a RegExp locator name. */
const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- Board locators (role-based; see e2e/CLAUDE.md "Role + ARIA as the grid contract") -------

/** A timetable cell by its accessible name, e.g. "Wed, P5". */
const cell = (page: Page, name: string): Locator => page.getByRole("gridcell", { name, exact: true });

/** The palette source chip for `display` (named "<display> <placed>/<required>"); never the placed chip. */
const paletteChip = (page: Page, displayName: string): Locator =>
  page.getByRole("button", { name: new RegExp(`^${escapeRegExp(displayName)}\\s+\\d+/\\d+$`) });

/** The placed chip in `slot` for `display` (a draggable with role=button, name starts with the course). */
const placedChip = (page: Page, slot: string, displayName: string): Locator =>
  cell(page, slot).getByRole("button", { name: new RegExp(`^${escapeRegExp(displayName)}`) });

/** The chip's collision badge — present only when the cell is in a blocking violation. */
const collisionBadge = (page: Page, slot: string): Locator =>
  cell(page, slot).getByRole("button", { name: "Show collision details", exact: true });

/** The "Other cohort" cross-cohort violation line inside the open collision dialog. */
const otherCohortViolation = (page: Page): Locator =>
  page.getByRole("dialog").getByRole("listitem").filter({ hasText: "is also teaching in" });

// --- Flow helpers (shared plumbing lives in ../support/planner) -------------------------------

/** Author a single-teacher course in `cohort` (DP1|DP2); returns once its catalog row is visible. */
async function createCourse(
  page: Page,
  planId: string,
  { name, cohort, teacher }: { name: string; cohort: "DP1" | "DP2"; teacher: string },
): Promise<void> {
  await gotoStable(page, `/plans/${planId}/courses`);
  const dialog = page.getByRole("dialog");
  await clickToReveal(
    page.getByRole("button", { name: "New course" }),
    dialog.getByRole("heading", { name: "New course" }),
  );
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Weekly hours").fill("2");
  await selectFromCombobox(page, dialog.getByRole("combobox", { name: "Cohort" }), cohort);
  await pickInMultiSelect(page, dialog.getByRole("button", { name: "Select teachers…" }), teacher, "1 selected");
  await dialog.getByRole("button", { name: "Create course" }).click();
  await expect(dialog).toBeHidden();
  // Courses land under the active cohort tab; select it so the row is on-screen before asserting.
  await page.getByRole("tab", { name: cohort }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

/** Author a student in `cohort` choosing exactly `course` (makes that course placeable). */
async function createStudent(
  page: Page,
  planId: string,
  { name, cohort, course }: { name: string; cohort: "DP1" | "DP2"; course: string },
): Promise<void> {
  await gotoStable(page, `/plans/${planId}/students`);
  const dialog = page.getByRole("dialog");
  await clickToReveal(
    page.getByRole("button", { name: "New student" }).first(),
    dialog.getByRole("heading", { name: "New student" }),
  );
  await dialog.getByLabel("Name").fill(name);
  // Cohort must be set BEFORE choosing courses — choices are filtered to the selected cohort.
  await selectFromCombobox(page, dialog.getByRole("combobox", { name: "Cohort" }), cohort);
  await pickInMultiSelect(page, dialog.getByRole("button", { name: "Select courses…" }), course, "1 selected");
  await dialog.getByRole("button", { name: "Create student" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("tab", { name: cohort }).click();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

/** Pick `option` in a shadcn/Radix Select (the visible listbox option, not the hidden native one). */
async function selectFromCombobox(page: Page, trigger: Locator, option: string): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(trigger).toContainText(option);
}

/**
 * Choose `option` in a portalled multi-select popover and confirm the trigger's count label.
 * The popover is modal and lives outside the dialog subtree, so Escape (closing only the popover,
 * not the form dialog) must dismiss it before the footer is interactive again.
 */
async function pickInMultiSelect(page: Page, trigger: Locator, option: string, expectLabel: string): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: expectLabel })).toBeVisible();
}

/** From the empty-state board, compute the grouping palette and wait for `display`'s chip to land. */
async function computeGroupings(page: Page, displayName: string): Promise<void> {
  await page.getByRole("button", { name: "Compute groupings" }).click();
  // The action persists groupings then `location.reload()`s; the palette chip appears post-reload.
  await expect(paletteChip(page, displayName)).toBeVisible({ timeout: 20_000 });
}

/**
 * Drag the palette chip for `display` onto `slot`. dnd-kit's pointer sensor is NOT driven by
 * Playwright's high-level `dragTo` (a single move misses the activation + collision pass), so we
 * issue a stepped pointer sequence by hand: press, nudge past the threshold, traverse in steps,
 * settle for collision detection, release. Wrapped in `toPass` and made idempotent (skip if the
 * chip is already in the cell) so a rare missed drop retries without double-placing.
 */
async function placeFromPalette(page: Page, displayName: string, slot: string): Promise<void> {
  const landed = placedChip(page, slot, displayName);
  await expect(async () => {
    if ((await landed.count()) > 0) return; // already placed on a previous attempt
    const source = paletteChip(page, displayName);
    const target = cell(page, slot);
    const a = await source.boundingBox();
    const b = await target.boundingBox();
    if (!a || !b) throw new Error("drag source or target not visible");
    const sx = a.x + a.width / 2;
    const sy = a.y + a.height / 2;
    const tx = b.x + b.width / 2;
    const ty = b.y + b.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 6, sy + 6, { steps: 3 }); // cross the activation distance
    await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 10 });
    await page.mouse.move(tx, ty, { steps: 10 });
    await page.mouse.move(tx, ty, { steps: 3 }); // settle so the cell wins collision detection
    await page.mouse.up();
    await expect(landed).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Switch the active cohort via the switcher control (full SSR remount). Asserts the switcher now
 * marks `cohort` active (its label is no longer a link, and the sibling cohort is). This holds
 * whether the target board is populated or still on its compute-groupings empty state, so it is
 * the stable proof of the remount; the cohort-correct *board* is then proven by what follows.
 */
async function switchCohort(page: Page, cohort: "DP1" | "DP2"): Promise<void> {
  const sibling = cohort === "DP1" ? "DP2" : "DP1";
  const switcher = page.getByRole("group", { name: "Cohort" });
  await switcher.getByRole("link", { name: cohort }).click();
  await page.waitForURL(new RegExp(`cohort=${cohort.toLowerCase()}`));
  await expect(switcher.getByRole("link", { name: sibling })).toBeVisible(); // the other cohort is now the link
  await expect(switcher.getByRole("link", { name: cohort })).toHaveCount(0); // the active one no longer is
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
