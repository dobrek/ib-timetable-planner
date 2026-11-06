import { expect, test, type Locator, type Page } from "@playwright/test";
import { authorEmail } from "../author-credentials.mjs";
import { creditedTo } from "../support/credit";
import { createPlan, deletePlan, gotoStable } from "../support/planner";

// "Created by" (S-407, FR-415), as the author meets it: a plan they create is credited to them on its
// board's heading and on the hub, and a plan from before the change reads "Unknown".
//
// Every match is on the author's email, never the display name: `account.spec.ts` renames the shared
// author while other specs run (e2e/CLAUDE.md). The email is shown whatever the name is (FR-413).
//
// The seed's plans were inserted with no session, so they name no creator: exactly what a plan that
// predates S-407 looks like. Seed Plan A is read, never written.

const SEED_PLAN = "Seed Plan A";

test.describe("created by", () => {
  test("a new plan is credited to its author on its board and on the hub; a seed plan reads Unknown", async ({
    page,
  }) => {
    const plan = await createPlan(page, "created-by");

    try {
      // `createPlan` lands on the new plan's board, whose heading names the creator in its icon.
      await expect(page.getByRole("button", { name: creditedTo(authorEmail) })).toBeVisible();

      await gotoStable(page, "/plans");
      await expect(planRow(page, plan.name).getByText(authorEmail, { exact: true })).toBeVisible();
      await expect(planRow(page, SEED_PLAN).getByText("Unknown", { exact: true })).toBeVisible();
    } finally {
      await deletePlan(page, plan.name);
    }
  });
});

/** The hub row for the plan named exactly `name`. */
const planRow = (page: Page, name: string): Locator =>
  page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
