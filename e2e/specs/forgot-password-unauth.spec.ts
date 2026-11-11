import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { deleteMessages, waitForMessageTo } from "../../src/test/mailpit";
import { readPublishableKey } from "../../src/test/publishable-key";
import { waitForAccountHydration } from "../support/account";
import { adminClient, loopbackUrl, strongPassword } from "../support/admin-api";
import { waitForConfirmLink } from "../support/mail";

// S-402 (FR-412) end to end, signed out, in `chromium-guard`: request a link, let a simulated mail
// scanner fetch it, spend it with Continue, set a new password, and get told it changed.
//
// - **Its own throwaway user**, created and deleted here through the admin API. The flow changes a
//   password, and the shared author's must never change (e2e/CLAUDE.md). The service-role client
//   (`support/admin-api.ts`) refuses any non-loopback SUPABASE_URL: it must never create users on
//   hosted.
// - **Mail through Mailpit's API** (`src/test/mailpit.ts`, loopback-only), deleting only this
//   test's own messages, by id.
// - **Turnstile runs for real** with Cloudflare's always-pass test keys, which the app accepts only
//   on loopback; the widget loads from challenges.cloudflare.com.

const SENT_NOTICE =
  "If an account exists for that address, we've sent a link. It works once, for 24 hours. Only the newest email " +
  "works. Didn't get it? Check Junk, then request again after 5 minutes.";

test("a forgotten password is reset from the email link, which a mail scanner cannot spend", async ({
  page,
  request,
}) => {
  const admin = adminClient();
  const email = `reset-${randomUUID()}@example.test`;
  const oldPassword = strongPassword();
  const created = await admin.auth.admin.createUser({ email, password: oldPassword, email_confirm: true });
  if (created.error) throw new Error(`createUser: ${created.error.message}`);
  const ownMail: string[] = [];

  try {
    await requestResetFor(page, email);
    await expect(page).toHaveURL(/\/auth\/forgot\?status=sent$/);
    await expect(page.getByRole("status")).toHaveText(SENT_NOTICE);

    const recovery = await waitForConfirmLink(email);
    ownMail.push(recovery.id);
    const { link } = recovery;

    // A mail scanner: HEAD and GET, twice each. None of it may spend the link.
    for (let pass = 0; pass < 2; pass++) {
      expect((await request.head(link)).status()).toBe(200);
      const fetched = await request.get(link);
      expect(fetched.status()).toBe(200);
      expect(await fetched.text()).toContain(">Continue</button>");
    }

    await page.goto(link);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/account\?notice=recovery$/);
    await expect(page.getByText("You're signed in from a password-reset link.")).toBeVisible();

    const newPassword = strongPassword();
    await waitForAccountHydration(page);
    const form = page.getByRole("form", { name: "Change password" });
    await form.getByLabel("New password", { exact: true }).fill(newPassword);
    await form.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
    await expect(form.getByLabel("New password", { exact: true })).toHaveValue(newPassword);
    await form.getByRole("button", { name: "Change password" }).click();
    // Reported above the forms, like a name save; the reload also drops the reset-link banner.
    await expect(page).toHaveURL(/\/account\?saved=password$/);
    await expect(page.getByRole("status").filter({ hasText: "Password changed." })).toBeVisible();
    await expect(page.getByText("You're signed in from a password-reset link.")).toHaveCount(0);

    expect((await signIn(email, newPassword)).error).toBeNull();
    expect((await signIn(email, oldPassword)).error?.code).toBe("invalid_credentials");

    const notice = await waitForMessageTo(email, { after: recovery.created, timeoutMs: 15_000 });
    ownMail.push(notice.ID);
    expect(notice.Subject).toBe("Your IB Planner password was changed");

    // The used link, opened again, is spent: back to the request form with the reason.
    await page.goto(link);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/auth\/forgot\?error=link-expired$/);
    await expect(page.getByText("This link has expired or was already used.")).toBeVisible();
  } finally {
    await admin.auth.admin.deleteUser(created.data.user.id);
    if (ownMail.length > 0) await deleteMessages(ownMail);
  }
});

test("an unknown address gets exactly the answer a real one does", async ({ page }) => {
  await requestResetFor(page, `unknown-${randomUUID()}@example.test`);

  await expect(page).toHaveURL(/\/auth\/forgot\?status=sent$/);
  await expect(page.getByRole("status")).toHaveText(SENT_NOTICE);
});

/** Open the request form, wait for the bot check to finish, and send a reset for `email`. */
async function requestResetFor(page: Page, email: string): Promise<void> {
  await page.goto("/auth/forgot");
  // The widget's hidden response field has no accessible name, so this is the spec's one
  // documented non-role locator. It holds a value once the check has passed.
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 15_000 });
  const field = page.getByLabel("Email");
  await field.fill(email);
  await expect(field).toHaveValue(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
}

function signIn(email: string, password: string) {
  const key = readPublishableKey();
  if (!key) throw new Error("no publishable key (SUPABASE_KEY, .dev.vars or .env.local)");
  const client = createClient(loopbackUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client.auth.signInWithPassword({ email, password });
}
