import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { adminEmail } from "../admin-credentials.mjs";
import { adminClient, strongPassword } from "../support/admin-api";
import { clickToReveal } from "../support/planner";
import { signInThroughUi, withFreshContext } from "../support/sign-in";
import { rolePicker as picker, userRow as rowFor } from "../support/users";

// Deactivation end to end (S-408, FR-407), in `chromium-admin`, on real workerd and cookie SSR: an
// admin deactivates a person whose session is already open, the person's next request lands on the
// no-access notice, and reactivating gives the access back with no new sign-in.
//
// - **The admin's own role, password and session are never touched.** The person is a throwaway
//   author this spec creates through the service-role admin API and deletes in a `finally`
//   (`support/admin-api.ts` refuses a non-loopback SUPABASE_URL first).
// - **The person signs in through the UI**, in a second, fresh browser context: a live session
//   meeting the deactivation is the behaviour under test (e2e/CLAUDE.md: the sanctioned sign-in
//   exception).
// - **No toast is asserted** (users.admin.spec.ts): the reload that follows each save takes it away.
//   The reloaded row is the evidence the write landed.

const NOTICE = "No access yet — ask your admin";

test("an admin deactivates a signed-in author, whose next request lands on the notice, and reactivating restores access with no new sign-in", async ({
  page,
  browser,
  baseURL,
}) => {
  const admin = adminClient();
  const email = `deactivate-${randomUUID()}@example.test`;
  const password = strongPassword();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`createUser: ${created.error.message}`);
  const userId = created.data.user.id;

  try {
    const granted = await admin.from("user_roles").insert({ user_id: userId, role: "author" });
    if (granted.error) throw new Error(`grant author: ${granted.error.message}`);

    await withFreshContext(browser, baseURL, async (person) => {
      await signInThroughUi(person, email, password);
      await person.goto("/plans");
      await expect(person).toHaveURL(/\/plans$/);
      await expect(person.getByRole("button", { name: "New plan" })).toBeVisible();

      await page.goto("/users");
      const row = rowFor(page, email);
      const deactivate = row.getByRole("button", { name: `Deactivate ${email}` });
      // The admin's own row offers no Deactivate, checked beside the person's row, which does.
      await expect(deactivate).toBeVisible();
      await expect(rowFor(page, adminEmail).getByRole("button", { name: /^Deactivate/ })).toHaveCount(0);

      const confirm = page.getByRole("alertdialog", { name: `Deactivate ${email}?` });
      await clickToReveal(deactivate, confirm);
      await confirm.getByRole("button", { name: "Deactivate" }).click();
      // The open dialog hides the page from the accessibility tree: wait for it to close, then for the reload.
      await expect(confirm).toBeHidden();
      await expect(row.getByText("Deactivated", { exact: true })).toBeVisible();
      await expect(picker(page, email)).toHaveText("Author");

      // The same session, with the same unexpired token: the next request finds no access.
      await person.goto("/plans");
      await expect(person).toHaveURL(/\/dashboard$/);
      await expect(person.getByRole("heading", { name: NOTICE })).toBeVisible();
      await person.goto("/account");
      await expect(person).toHaveURL(/\/account$/);

      // After the reload the button is server-rendered before it is live: retry until the row reads Active.
      await clickToReveal(
        row.getByRole("button", { name: `Reactivate ${email}` }),
        row.getByText("Active", { exact: true }),
      );
      await expect(picker(page, email)).toHaveText("Author");

      // Back, with no new sign-in: the author's create control is there again.
      await person.goto("/plans");
      await expect(person).toHaveURL(/\/plans$/);
      await expect(person.getByRole("button", { name: "New plan" })).toBeVisible();
    });
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});
