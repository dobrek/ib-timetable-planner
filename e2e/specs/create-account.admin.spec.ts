import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { adminEmail } from "../admin-credentials.mjs";
import { waitForAccountHydration } from "../support/account";
import { deleteUserByEmail, strongPassword } from "../support/admin-api";
import { clickToReveal } from "../support/planner";
import { fillSignInForm, signInThroughUi, withFreshContext } from "../support/sign-in";
import { rolePicker as picker, userRow as rowFor } from "../support/users";

// An admin creates an account with a temporary password, and the new person's first sign-in
// (S-409, FR-403), in `chromium-admin`, on real workerd and cookie SSR.
//
// - **The admin's own role, password and session are never touched.** The account is a throwaway
//   this spec creates through the Users page and deletes in a `finally`; the person who signs in is
//   a second, fresh browser context (e2e/CLAUDE.md: the sanctioned sign-in exception).
// - **The password is read from the one-time reveal**, the only place the app ever shows it.
// - **No toast is asserted** (users.admin.spec.ts): the reload that follows each save takes it away.

test("an admin creates an account, the person signs in, is held on /account until they choose a password, then reaches the app", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = `create-${randomUUID()}@example.test`;
  const chosenPassword = strongPassword();

  try {
    await page.goto("/users");
    await createAccountThroughTheDialog(page, email);
    const temporaryPassword = await readAndCloseReveal(page);

    // The page reloads when the reveal closes: the row is pending, its role waits, and it can be re-issued.
    const row = rowFor(page, email);
    await expect(row.getByText("Temporary password", { exact: true })).toBeVisible();
    await expect(picker(page, email)).toHaveText("Viewer");
    await expect(row.getByRole("button", { name: `Re-issue password for ${email}` })).toBeVisible();

    await withFreshContext(browser, baseURL, async (person) => {
      // The first sign-in lands on /account, not /dashboard: the middleware sends a pending user there.
      await signInThroughUi(person, email, temporaryPassword, "**/account");
      await expect(person.getByText("An administrator gave you a temporary password.")).toBeVisible();

      // Every gated page sends them back, and the app's pages stay unreachable.
      await person.goto("/plans");
      await expect(person).toHaveURL(/\/account$/);
      await person.goto("/dashboard");
      await expect(person).toHaveURL(/\/account$/);

      await waitForAccountHydration(person);
      await person.getByLabel("New password", { exact: true }).fill(chosenPassword);
      await person.getByLabel("Confirm new password").fill(chosenPassword);
      await expect(person.getByLabel("New password", { exact: true })).toHaveValue(chosenPassword);
      await person.getByRole("button", { name: "Change password" }).click();
      // The first password lands in the app (S-410): the save clears the fence, and the dashboard opens.
      await expect(person).toHaveURL(/\/dashboard$/);
      await expect(person.getByText("An administrator gave you a temporary password.")).toHaveCount(0);

      // The same tab now holds the role the admin chose: /plans opens, and the sidebar says View only, and there is no create control.
      await person.goto("/plans");
      await expect(person).toHaveURL(/\/plans$/);
      await expect(person.getByText("View only", { exact: true })).toBeVisible();
      await expect(person.getByRole("button", { name: "New plan" })).toHaveCount(0);
    });

    // And the admin's list agrees: Active, and nothing left to re-issue.
    await page.goto("/users");
    await expect(rowFor(page, email).getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Re-issue password for ${email}` })).toHaveCount(0);
  } finally {
    await deleteUserByEmail(email);
  }
});

test("a lost password is re-issued once, and the old one stops working", async ({ page, browser, baseURL }) => {
  const email = `reissue-${randomUUID()}@example.test`;

  try {
    await page.goto("/users");
    await createAccountThroughTheDialog(page, email);
    const first = await readAndCloseReveal(page);

    const row = rowFor(page, email);
    await row.getByRole("button", { name: `Re-issue password for ${email}` }).click();
    await page
      .getByRole("alertdialog", { name: `Issue a new password for ${email}?` })
      .getByRole("button", { name: "Issue new password" })
      .click();
    const second = await readAndCloseReveal(page);
    expect(second).not.toBe(first);
    await expect(row.getByText("Temporary password", { exact: true })).toBeVisible();

    // The first password is dead, the second signs in.
    await withFreshContext(browser, baseURL, async (person) => {
      await signInThroughUi(person, email, second, "**/account");
    });
    await withFreshContext(browser, baseURL, async (person) => {
      await fillSignInForm(person, email, first);
      await person.getByRole("button", { name: /sign in/i }).click();
      await expect(person).toHaveURL(/\/auth\/signin/);
      await expect(person.getByText(/invalid login credentials/i)).toBeVisible();
    });
  } finally {
    await deleteUserByEmail(email);
  }
});

test("an existing address is refused in the dialog, and no password is shown", async ({ page }) => {
  await page.goto("/users");

  await createAccountThroughTheDialog(page, adminEmail);

  await expect(page.getByText("An account with this email already exists.")).toBeVisible();
  await expect(page.getByLabel("Password to hand over")).toHaveCount(0);
});

/**
 * Open the dialog (waiting out hydration), type the address twice, and submit with the default role,
 * Viewer. The caller asserts the outcome: the reveal, or the refusal.
 */
async function createAccountThroughTheDialog(page: Page, email: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Create account" });
  await clickToReveal(page.getByRole("button", { name: "Create account" }), dialog);
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Confirm email").fill(email);
  await expect(dialog.getByLabel("Confirm email")).toHaveValue(email);
  await dialog.getByRole("button", { name: "Create account" }).click();
}

/** The password shown in the reveal, read once; then Done, which clears it and reloads the page. */
async function readAndCloseReveal(page: Page): Promise<string> {
  const reveal = page.getByLabel("Password to hand over");
  await expect(reveal).toBeVisible();
  const password = (await reveal.textContent())?.trim() ?? "";
  expect(password).toHaveLength(24);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(reveal).toHaveCount(0);
  return password;
}
