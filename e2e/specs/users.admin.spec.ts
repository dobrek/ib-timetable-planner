import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { AppRole } from "../../src/shared/config/app-role";
import { adminEmail } from "../admin-credentials.mjs";
import { noRoleEmail } from "../no-role-credentials.mjs";
import { viewerEmail } from "../viewer-credentials.mjs";
import { adminClient, strongPassword } from "../support/admin-api";
import { clickToReveal } from "../support/planner";
import { usersLinks } from "../support/users";

// The Users page end to end (S-406, FR-405/406/413), in `chromium-admin`, signed in as the provisioned
// admin, on real workerd and cookie SSR.
//
// - **The admin's own role is never touched.** Every change lands on a throwaway user this spec
//   creates through the service-role admin API and deletes in a `finally`. `support/admin-api.ts`
//   refuses a non-loopback SUPABASE_URL first (e2e/CLAUDE.md).
// - **No toast is asserted.** A save reloads the page, and the toast goes with the reload while no
//   layout mounts `<ClientRouter />` (context/changes/users-page-roles/change.md). The reloaded row,
//   with its "Changed by" line from the access record, is the evidence the write landed.

test("the dashboard shows an admin the Users item and tile", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Users" })).toBeVisible();
  await expect(usersLinks(page)).toHaveCount(2);
});

test("the list shows each account's role, and the admin's own row as You", async ({ page }) => {
  await page.goto("/users");

  await expect(picker(page, viewerEmail)).toHaveText("Viewer");
  await expect(picker(page, noRoleEmail)).toHaveText("No access");
  await expect(rowFor(page, noRoleEmail).getByText("No access", { exact: true })).toHaveCount(2);
  await expect(rowFor(page, adminEmail).getByText("You", { exact: true })).toBeVisible();
  await expect(rowFor(page, viewerEmail).getByText("You", { exact: true })).toHaveCount(0);
});

test("an admin gives a user a role, then takes it away, and each change is recorded as theirs", async ({ page }) => {
  const admin = adminClient();
  const email = `users-${randomUUID()}@example.test`;
  const created = await admin.auth.admin.createUser({ email, password: strongPassword(), email_confirm: true });
  if (created.error) throw new Error(`createUser: ${created.error.message}`);
  const userId = created.data.user.id;

  try {
    await page.goto("/users");
    const row = rowFor(page, email);
    await expect(picker(page, email)).toHaveText("No access");
    await expect(row.getByText(/Changed by/)).toHaveCount(0);

    // Author saves at once, with no confirmation.
    await choose(page, email, "Author");
    await expect(row.getByText(`Changed by ${adminEmail}`)).toBeVisible();
    await expect(picker(page, email)).toHaveText("Author");
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    expect(await roleOf(userId)).toBe("author");

    // No access asks first.
    await choose(page, email, "No access");
    const dialog = page.getByRole("alertdialog", { name: `Remove access for ${email}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Remove access" }).click();
    // Twice once the page has reloaded: the picker, and the status cell.
    await expect(row.getByText("No access", { exact: true })).toHaveCount(2);
    expect(await roleOf(userId)).toBeNull();
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});

const picker = (page: Page, email: string) => page.getByRole("combobox", { name: `Role for ${email}` });

const rowFor = (page: Page, email: string) => page.getByRole("row").filter({ has: picker(page, email) });

/** Open a row's picker, waiting out hydration, and choose `option`. */
async function choose(page: Page, email: string, option: string): Promise<void> {
  await clickToReveal(picker(page, email), page.getByRole("option", { name: option }));
  await page.getByRole("option", { name: option }).click();
}

/** The role `userId` holds, read as the service role; null when it holds none. */
async function roleOf(userId: string): Promise<AppRole | null> {
  const { data, error } = await adminClient().from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`read-back failed: ${error.message}`);
  return data?.role ?? null;
}
