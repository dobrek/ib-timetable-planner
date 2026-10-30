import { expect, test, type Locator, type Page } from "@playwright/test";
import { clickToReveal, createPlan, deletePlan, gotoStable } from "../support/planner";

// The current-plan marker (S-404, FR-420), end to end: an author marks a plan current from the hub's
// row menu, the hub pins it first with a badge, the badge follows the plan onto its board heading,
// its sidebar label and its breadcrumb, Unmark clears it, and deleting the current plan warns first.
//
// The ONLY spec that moves the marker. At most one plan is current, so a second spec doing it would
// take the marker from this one under `fullyParallel`. Everything is asserted relative to this
// spec's own two plans: a developer's local stack may already have a current plan, which marking A
// simply moves. Menu items are matched with `exact: true`, because Playwright matches names by
// substring and "Unmark as current" contains "Mark as current".

const CURRENT = "Current plan";

test.describe("current-plan marker", () => {
  // Two plans, five hub round-trips, a board and a catalog page.
  test.describe.configure({ timeout: 90_000 });

  test("mark, move, show on the plan, unmark, and delete the current plan with a warning", async ({ page }) => {
    const a = await createPlan(page, "current A");

    try {
      const b = await createPlan(page, "current B");

      try {
        // Mark A: it is pinned first, with the badge.
        await gotoStable(page, "/plans");
        await chooseRowAction(page, a.name, "Mark as current");
        await expect(planRow(page, a.name).getByText(CURRENT, { exact: true })).toBeVisible();
        await expect(firstPlanRow(page).getByRole("link", { name: a.name, exact: true })).toBeVisible();

        // Mark B: the marker moves, so B leads and A carries no badge.
        await chooseRowAction(page, b.name, "Mark as current");
        await expect(planRow(page, b.name).getByText(CURRENT, { exact: true })).toBeVisible();
        await expect(firstPlanRow(page).getByRole("link", { name: b.name, exact: true })).toBeVisible();
        await expect(planRow(page, a.name).getByText(CURRENT, { exact: true })).toHaveCount(0);

        // B's board: the heading carries the badge, and so does the sidebar plan label. The board
        // starts with the sidebar collapsed, which hides the label, so it is expanded first. The board
        // also renders a print-only heading with its own badge (S-405), hidden on screen, so the
        // on-screen one is picked by visibility.
        await gotoStable(page, `/plans/${b.id}`);
        await expect(page.getByRole("heading", { level: 1, name: b.name })).toBeVisible();
        await expect(
          page.getByRole("main").getByText(CURRENT, { exact: true }).filter({ visible: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Toggle sidebar" }).click();
        await expect(page.getByRole("complementary").getByText(CURRENT, { exact: true })).toBeVisible();

        // B's courses page: the breadcrumb carries it.
        await gotoStable(page, `/plans/${b.id}/courses`);
        const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
        await expect(breadcrumb).toContainText(b.name);
        await expect(breadcrumb.getByText(CURRENT, { exact: true })).toBeVisible();

        // Unmark B: no plan of this spec's is current any more.
        await gotoStable(page, "/plans");
        await chooseRowAction(page, b.name, "Unmark as current");
        await expect(planRow(page, b.name).getByText(CURRENT, { exact: true })).toHaveCount(0);
        await expect(planRow(page, a.name).getByText(CURRENT, { exact: true })).toHaveCount(0);

        // Mark B again and delete it: the dialog warns, and the delete still goes through.
        await chooseRowAction(page, b.name, "Mark as current");
        await expect(planRow(page, b.name).getByText(CURRENT, { exact: true })).toBeVisible();
        await chooseRowAction(page, b.name, "Delete");
        const dialog = page.getByRole("alertdialog");
        await expect(dialog.getByRole("heading", { name: `Delete ${b.name}?` })).toBeVisible();
        await expect(dialog).toContainText(
          "This is the current plan. After you delete it, no plan is current until someone marks another.",
        );
        await dialog.getByRole("button", { name: "Delete" }).click();
        await expect(page.getByRole("link", { name: b.name })).toHaveCount(0);
      } finally {
        // The flow deletes B itself; only a failure before that step leaves it listed.
        await deletePlanIfListed(page, b.name);
      }
    } finally {
      await deletePlan(page, a.name);
    }
  });
});

/** Open a hub row's Actions menu and choose `item`. The menu is island-driven, hence the retry. */
const chooseRowAction = async (page: Page, planName: string, item: string): Promise<void> => {
  await clickToReveal(page.getByRole("button", { name: `Actions for ${planName}` }), page.getByRole("menuitem"));
  await page.getByRole("menuitem", { name: item, exact: true }).click();
};

/** Cleanup for a plan the flow may already have deleted: delete it only if the hub still lists it. */
const deletePlanIfListed = async (page: Page, planName: string): Promise<void> => {
  await gotoStable(page, "/plans");
  if ((await page.getByRole("link", { name: planName, exact: true }).count()) > 0) await deletePlan(page, planName);
};

/** The hub row whose name link is `planName`. */
const planRow = (page: Page, planName: string): Locator =>
  page.getByRole("row").filter({ has: page.getByRole("link", { name: planName, exact: true }) });

/** The first plan row: the table body is the second row group, after the header's. */
const firstPlanRow = (page: Page): Locator => page.getByRole("rowgroup").last().getByRole("row").first();
