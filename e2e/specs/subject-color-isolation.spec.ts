import { test, expect, type Locator, type Page } from "@playwright/test";
import { computeGroupings, display, paletteChip } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { clickToReveal, createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Subject-color isolation — browser-level capstone (plan Phase 4,
// context/changes/subject-colors/plan.md §5).
//
// Risk protected: subject color is display-only and must never enter the staleness path. The unit
// tests prove `color` is absent from `GroupingCourse`/the catalog hash, and the integration test
// proves a color-only edit leaves `isGroupingStale` false through the real hash compare. Neither
// exercises the one seam that only materialises end-to-end: the SSR load-path hash (loadPlannerData
// hashes the live catalog on every board render). If a future change leaked `color` into the hashed
// projection, a freshly colored course would render the board as permanently stale on reload — and
// only a real-workerd SSR round-trip surfaces that. This spec is the mirror-negative of
// grouping-staleness.spec.ts: there, a catalog edit MUST make the palette stale; here, a color-only
// edit must NOT. Asserting the Recompute panel is ABSENT after a color edit fails loudly on a leak.
//
// Authenticated `chromium` project (reuses storageState from auth.setup). The spec owns a uniquely
// named plan and tears it down by deleting it (cascades to every child entity). Per e2e/CLAUDE.md,
// chip color itself is unit-tested and never selected on — the business outcome here is the staleness
// ABSENCE (Recompute absent, palette chip present), proven via roles, not pixels.

test.describe("subject-color isolation", () => {
  // Builds catalog across pages, computes groupings, then edits + reloads — well past the 30s default.
  test.describe.configure({ timeout: 120_000 });

  test("a color-only edit does not make the palette go stale", async ({ page }) => {
    const id = shortId();
    const teacher = `CLR${id}`;
    const course = `Physics DP1 ${id}`;
    const courseDisplay = display(course);

    const plan = await createPlan(page, "subject-color-isolation");

    // One DP1 course, made placeable by a single DP1 student choosing it (the grouping catalog is
    // choice-driven).
    await createTeacher(page, plan.id, teacher);
    await createCourse(page, plan.id, { name: course, cohort: "DP1", teacher });
    await createStudent(page, plan.id, { name: `Stu A ${id}`, cohort: "DP1", course });

    // Compute the palette; the course's chip lands and (the staleness precondition) it is NOT stale.
    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, courseDisplay);
    await expect(recomputeButton(page)).toHaveCount(0);

    // Edit ONLY the course's color — the catalog's 5 hashed fields are untouched, so the stored
    // grouping hash must still match the SSR load-path hash.
    await editCourseColor(page, plan.id, course, "Emerald");

    // Reload the board — SSR re-hashes the (color-changed) catalog. If color leaked into the hash,
    // the recompute panel would replace the palette here.
    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);

    // The isolation assertion: not stale. The palette chip is still present and the Recompute panel
    // never appeared (color is out of the hash through real SSR).
    await expect(paletteChip(page, courseDisplay)).toBeVisible();
    await expect(recomputeButton(page)).toHaveCount(0);

    await deletePlan(page, plan.name);
  });
});

/** The stale-palette panel's Recompute control (idle name only — "Recomputing…" is the busy label). */
const recomputeButton = (page: Page): Locator => page.getByRole("button", { name: "Recompute", exact: true });

/**
 * Set `course`'s subject color to the swatch named `colorLabel` (e.g. "Emerald") via the catalog
 * editor — the only catalog field this spec mutates. Opens the row's kebab → Edit, picks the swatch
 * (a `radio` in the single-select ToggleGroup, named by its `aria-label`), and saves. Local to this
 * spec until a second consumer needs it (e2e/CLAUDE.md "promote on the 2nd consumer").
 */
async function editCourseColor(page: Page, planId: string, course: string, colorLabel: string): Promise<void> {
  await gotoStable(page, `/plans/${planId}/courses`);
  await page.getByRole("tab", { name: "DP1" }).click();
  const dialog = page.getByRole("dialog");
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: course, exact: true }) });
  await clickToReveal(
    row.getByRole("button", { name: "Course actions" }),
    page.getByRole("menuitem", { name: "Edit" }),
  );
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(dialog.getByRole("heading", { name: "Edit course" })).toBeVisible();
  await dialog.getByRole("radio", { name: colorLabel, exact: true }).click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();
}
