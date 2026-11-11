import { expect, type Browser, type Page } from "@playwright/test";

const ADMIN_STATE = "e2e/.auth/admin.json";

/** A Users-page row's role picker, named for the person's email (a person with no display name). */
export const rolePicker = (page: Page, email: string) => page.getByRole("combobox", { name: `Role for ${email}` });

/** The Users-page row for `email`, found by its picker so another row's "Changed by" cannot match. */
export const userRow = (page: Page, email: string) => page.getByRole("row").filter({ has: rolePicker(page, email) });

/** Every link named exactly "Users": on the dashboard, the sidebar item and the tile. */
export const usersLinks = (page: Page) => page.getByRole("link", { name: "Users", exact: true });

/**
 * The Users page does not exist for this page's account (S-406): no link to it on the dashboard,
 * and `/users` answers 404 with the not-found body. Each absence is paired with the admin's
 * presence first, in a second context on the admin's storageState, so a drifted locator fails
 * rather than passing a `toHaveCount(0)` on nothing (e2e/CLAUDE.md).
 */
export async function expectUsersPageHidden(page: Page, browser: Browser): Promise<void> {
  await expectUsersPageShownToAdmin(browser);

  await page.goto("/dashboard");
  // Plans proves the sidebar rendered, so the missing Users link is not a missing sidebar.
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Plans" })).toBeVisible();
  await expect(usersLinks(page)).toHaveCount(0);

  const response = await page.goto("/users");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
}

async function expectUsersPageShownToAdmin(browser: Browser): Promise<void> {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  try {
    const page = await context.newPage();
    await page.goto("/dashboard");
    await expect(usersLinks(page)).toHaveCount(2);

    const response = await page.goto("/users");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    await expect(page.getByRole("combobox").first()).toBeVisible();
  } finally {
    await context.close();
  }
}
