import { expect, test } from "@playwright/test";
import { createCourse, createStudent } from "../support/catalog";
import { clonePlan, createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

/**
 * The comparison surface, end to end: route → SSR → scoreboard → the drift detector's headline claim.
 *
 * The load-bearing assertion is the FIRST one: a plan and its clone must produce **no drift banner**.
 * `clone_plan` deep-copies the catalog and re-mints every UUID, so the pre-existing `catalog_hash` —
 * which digests those UUIDs — reports drift on exactly this pair. The natural-key fingerprint is the
 * whole reason this feature can tell "same catalog, different board" from "different catalog", and
 * clone → generate → compare is the analyzer's own validated workflow.
 */
test("compares a plan with its clone (no drift), then names the drift once one side changes", async ({ page }) => {
  const id = shortId();
  const source = await createPlan(page, `compare-${id}`);
  const teacher = `T${id.slice(0, 3)}`;
  const course = `Maths ${id}`;

  try {
    await createTeacher(page, source.id, teacher);
    await createCourse(page, source.id, { name: course, cohort: "DP1", teacher });
    await createStudent(page, source.id, { name: `Student ${id}`, cohort: "DP1", course });

    const clone = await clonePlan(page, source.name, `E2E clone ${id}`);

    try {
      // 1. Identical catalogs, every UUID re-minted → the scoreboard renders and NOTHING drifts.
      await gotoStable(page, `/plans/compare?plans=${source.id},${clone.id}&baseline=${source.id}`);

      await expect(page.getByRole("heading", { name: "Cohort scoreboard" })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Board-wide/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Rule verdict" })).toBeVisible();
      // The old catalog_hash would light this up. The natural-key fingerprint must not.
      await expect(page.locator("[data-tier]")).toHaveCount(0);

      // 2. Enrol a second student on the clone only → the catalogs genuinely diverge.
      await createStudent(page, clone.id, { name: `Extra ${id}`, cohort: "DP1", course });

      await gotoStable(page, `/plans/compare?plans=${source.id},${clone.id}&baseline=${source.id}`);

      const banner = page.locator('[data-tier="catalog-drift"]');
      await expect(banner).toBeVisible();
      // It must NAME the drift, not merely announce it: one added student, and the choice they made.
      await expect(banner).toContainText("1 student added");
      await expect(banner).toContainText("1 choice added");
    } finally {
      await deletePlan(page, clone.name);
    }
  } finally {
    await deletePlan(page, source.name);
  }
});
