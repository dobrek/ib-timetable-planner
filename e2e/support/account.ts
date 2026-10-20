import { expect, type Page } from "@playwright/test";

/**
 * Wait until the account page's island (`AccountSettings`, both forms) is interactive. A value
 * typed before React attaches is lost, so gate on React-only behaviour first: the new-password
 * toggle flips its own label only once the island is hydrated (the `auth.setup.ts` idiom).
 *
 * Shared by `account.spec.ts` and `forgot-password-unauth.spec.ts`, which lands on this page from
 * a reset link.
 */
export async function waitForAccountHydration(page: Page): Promise<void> {
  const show = page.getByRole("button", { name: "Show new password" });
  const hide = page.getByRole("button", { name: "Hide new password" });
  await expect(async () => {
    if (await hide.isVisible()) return;
    await show.click();
    await expect(hide).toBeVisible({ timeout: 1_000 });
  }).toPass();
}
