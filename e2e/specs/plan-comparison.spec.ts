import { expect, test, type Page } from "@playwright/test";
import { createCourse, createStudent } from "../support/catalog";
import { clonePlan, createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

/**
 * The comparison surface, end to end: hub selection → route → SSR → scoreboard → the drift detector's
 * headline claim.
 *
 * Two things are load-bearing here, and neither can be caught below e2e.
 *
 * 1. **A plan and its clone must produce NO drift banner.** `clone_plan` deep-copies the catalog and
 *    re-mints every UUID, so the pre-existing `catalog_hash` — which digests those UUIDs — reports drift
 *    on exactly this pair. The natural-key fingerprint is the whole reason this feature can tell "same
 *    catalog, different board" from "different catalog", and clone → generate → compare is the analyzer's
 *    own validated workflow.
 *
 * 2. **The hub builds the URL the compare page parses.** The two live in different `_pages` slices and
 *    steiger forbids the hub from importing the codec, so the query-string shape is an unenforced
 *    contract between them. Driving the real checkboxes (rather than navigating to a hand-built URL) is
 *    what makes a divergence fail.
 */
test("selects two plans on the hub, compares a plan with its clone (no drift), then names the drift once one side changes", async ({
  page,
}) => {
  const id = shortId();
  const source = await createPlan(page, `compare-${id}`);
  const teacher = `T${id.slice(0, 3)}`;
  const course = `Maths ${id}`;

  try {
    await createTeacher(page, source.id, teacher);
    await createCourse(page, source.id, { name: course, cohort: "DP1", teacher });
    await createStudent(page, source.id, { name: `Student ${id}`, cohort: "DP1", course });

    // Named to sort AFTER its source: the hub lists plans by name, the URL follows that order, and the
    // drift wording is relative to whichever plan comes first. Direction is presentation, not precedence
    // — but a spec asserting "1 student added" has to know which way it is pointing.
    const clone = await clonePlan(page, source.name, `${source.name} clone`);

    try {
      // 1. Pick the pair the way an author does — tick the rows, press Compare.
      await compareFromHub(page, [source.name, clone.name]);

      // Identical catalogs, every UUID re-minted → the scoreboard renders and NOTHING drifts.
      await expect(page.getByRole("heading", { name: "Cohort scoreboard" })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Board-wide/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Rule verdict" })).toBeVisible();
      // The old catalog_hash would light this up. The natural-key fingerprint must not.
      await expect(page.locator("[data-tier]")).toHaveCount(0);
      // The page names what it is showing — in the hub's row order, which is by name, so the clone leads
      // here. Order is presentation, never precedence: no column is measured against another.
      const subtitle = page.getByText(/a feature vector per plan, never a score/);
      await expect(subtitle).toContainText(source.name);
      await expect(subtitle).toContainText(clone.name);
      // The only way to change the selection is back to the hub — the page has no picker to disagree
      // with the numbers it renders.
      await expect(page.getByRole("link", { name: "Change selection" })).toHaveAttribute("href", "/plans");

      // 2. Enrol a second student on the clone only → the catalogs genuinely diverge.
      await createStudent(page, clone.id, { name: `Extra ${id}`, cohort: "DP1", course });

      await compareFromHub(page, [source.name, clone.name]);

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

/** Ticks the named plans on the hub and presses Compare — the author's actual path to this page. */
const compareFromHub = async (page: Page, planNames: string[]): Promise<void> => {
  await gotoStable(page, "/plans");

  for (const name of planNames) {
    // `exact`, because the clone's name has its source's as a prefix.
    await page.getByRole("checkbox", { name: `Select ${name}`, exact: true }).click();
  }

  // The bar appears only once something is selected, and Compare unlocks only at two.
  await expect(page.getByText(`${planNames.length} selected`)).toBeVisible();
  // `exact`, because the plans this spec creates have "compare" in their names.
  await page.getByRole("link", { name: "Compare", exact: true }).click();
  await page.waitForURL(/\/plans\/compare\?plans=/);
};
