import { test, expect, type Page } from "@playwright/test";
import { authorEmail } from "../author-credentials.mjs";
import { gotoStable, shortId } from "../support/planner";

// Runs in `chromium` on the shared author (no account of its own, F5 in the change's plan review).
// The display-name test edits the author's name and restores it in a `finally` through the action
// endpoint, on the page's own cookies — so a failed run leaves no name behind. No other spec may
// assert on the sidebar footer's text (e2e/CLAUDE.md). The password form is only inspected, never
// submitted: changing the shared author's password would break the next run's sign-in, and the
// mechanics are proven at integration level (account-self-service.integration.test.ts).

test("the sidebar footer opens Account, with a display-name form and a change-password form", async ({ page }) => {
  await gotoStable(page, "/dashboard");

  await page.getByRole("link", { name: /^Account/ }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("link", { name: /^Account/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();

  const nameForm = page.getByRole("form", { name: "Display name" });
  await expect(nameForm.getByLabel("Display name")).toBeVisible();
  await expect(nameForm.getByText("Shown beside your email.")).toBeVisible();

  const passwordForm = page.getByRole("form", { name: "Change password" });
  // `exact`, so a label doesn't also match its toggle's "Show …" name.
  await expect(passwordForm.getByLabel("New password", { exact: true })).toBeVisible();
  await expect(passwordForm.getByLabel("Confirm new password", { exact: true })).toBeVisible();
  await expect(passwordForm.getByText("At least 15 characters")).toBeVisible();
  await expect(passwordForm.getByRole("button", { name: "Show new password" })).toBeVisible();
  await expect(passwordForm.getByRole("button", { name: "Show confirmation" })).toBeVisible();
});

test("a saved display name shows in the footer beside the email, and clearing it leaves the email", async ({
  page,
}) => {
  const name = `E2E Name ${shortId()}`;
  const footerLink = page.getByRole("link", { name: /^Account/ });

  try {
    await gotoStable(page, "/account");
    await saveDisplayName(page, name);

    await expect(page.getByRole("status").filter({ hasText: "Display name saved." })).toBeVisible();
    await expect(footerLink).toContainText(name);
    await expect(footerLink).toContainText(authorEmail);

    await saveDisplayName(page, "");

    await expect(footerLink).toContainText(authorEmail);
    await expect(footerLink).not.toContainText(name);
  } finally {
    await page.request.post("/_actions/updateDisplayName", { data: { displayName: "" } });
  }
});

/** Fill and save the display name once the island is live, then wait for the reload it causes. */
async function saveDisplayName(page: Page, value: string): Promise<void> {
  await waitForHydration(page);
  const field = page.getByRole("form", { name: "Display name" }).getByLabel("Display name");
  await field.fill(value);
  await expect(field).toHaveValue(value);
  await page.getByRole("button", { name: "Save name" }).click();
  await page.waitForURL(/\/account\?saved=name$/);
}

// A value typed before React attaches is lost, so gate on React-only behaviour first: the password
// toggle flips its own label only once the island is hydrated (the auth.setup.ts idiom).
async function waitForHydration(page: Page): Promise<void> {
  const show = page.getByRole("button", { name: "Show new password" });
  const hide = page.getByRole("button", { name: "Hide new password" });
  await expect(async () => {
    if (await hide.isVisible()) return;
    await show.click();
    await expect(hide).toBeVisible({ timeout: 1_000 });
  }).toPass();
}
