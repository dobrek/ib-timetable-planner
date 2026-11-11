import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { deleteMessages, messagesTo } from "../../src/test/mailpit";
import { adminEmail } from "../admin-credentials.mjs";
import { waitForAccountHydration } from "../support/account";
import { deleteUserByEmail, strongPassword } from "../support/admin-api";
import { waitForConfirmLink } from "../support/mail";
import { clickToReveal } from "../support/planner";
import { withFreshContext } from "../support/sign-in";
import { rolePicker, userRow } from "../support/users";

// An admin invites a colleague by email, and the colleague accepts (S-410, FR-401, FR-402, US-401),
// in `chromium-admin`, on real workerd and cookie SSR, with the email read from Mailpit.
//
// - **The admin's own role, password and session are never touched.** Each invitation is a
//   throwaway address this spec deletes in a `finally`, with every message sent to it, by id. The
//   invitee is a second, fresh browser context: spending a link replaces the session a context holds.
// - **A mail scanner** is a separate request context with no cookies: it fetches the link with GET
//   and HEAD, and nothing it does may spend it.
// - **No success toast is asserted**: the reload that follows a sent invitation takes it away. The
//   refusals keep the page, so their messages are asserted.

const INVITE_EXPIRED = "This invitation link has expired or was already used. Ask your admin to re-send it.";

test("an admin invites a colleague as Viewer; a scanner spends nothing, the colleague accepts, chooses a password and lands read-only", async ({
  page,
  browser,
  baseURL,
  playwright,
}) => {
  const email = freshAddress("invite");

  try {
    await page.goto("/users");
    await inviteThroughTheDialog(page, email);
    await expect(userRow(page, email).getByText("Invited", { exact: true })).toBeVisible();
    await expect(rolePicker(page, email)).toHaveText("Viewer");

    const invitation = await waitForConfirmLink(email);
    expect(new URL(invitation.link).searchParams.get("type")).toBe("invite");

    // A mail scanner: HEAD and GET, twice each, with no session. None of it may spend the link.
    const scanner = await playwright.request.newContext();
    try {
      for (let pass = 0; pass < 2; pass++) {
        expect((await scanner.head(invitation.link)).status()).toBe(200);
        const fetched = await scanner.get(invitation.link);
        expect(fetched.status()).toBe(200);
        expect(await fetched.text()).toContain(">Continue</button>");
      }
    } finally {
      await scanner.dispose();
    }

    await withFreshContext(browser, baseURL, async (colleague) => {
      await colleague.goto(invitation.link);
      await expect(colleague.getByRole("heading", { level: 1, name: "Accept your invitation" })).toBeVisible();
      await colleague.getByRole("button", { name: "Continue" }).click();

      // Signed in, still fenced: welcomed on /account, and every other page sends them back here.
      await expect(colleague).toHaveURL(/\/account$/);
      await expect(colleague.getByText("Welcome to IB Planner. Choose a password below")).toBeVisible();
      await colleague.goto("/plans");
      await expect(colleague).toHaveURL(/\/account$/);

      const password = strongPassword();
      await waitForAccountHydration(colleague);
      await colleague.getByLabel("New password", { exact: true }).fill(password);
      await colleague.getByLabel("Confirm new password").fill(password);
      await expect(colleague.getByLabel("New password", { exact: true })).toHaveValue(password);
      await colleague.getByRole("button", { name: "Change password" }).click();

      // The first password lands in the app, with the role the admin chose: a viewer edits nothing.
      await expect(colleague).toHaveURL(/\/dashboard$/);
      await expect(colleague.getByText("View only", { exact: true })).toBeVisible();
      await colleague.goto("/plans");
      await expect(colleague).toHaveURL(/\/plans$/);
      await expect(colleague.getByRole("button", { name: "New plan" })).toHaveCount(0);
    });

    // The same control, present for the admin, so the viewer's absence is not a drifted locator.
    await page.goto("/plans");
    await expect(page.getByRole("button", { name: "New plan" })).toBeVisible();

    // And the admin's list agrees: Viewer, Active, and nothing left to re-send or revoke.
    await page.goto("/users");
    await expect(userRow(page, email).getByText("Active", { exact: true })).toBeVisible();
    await expect(rolePicker(page, email)).toHaveText("Viewer");
    await expect(userRow(page, email).getByRole("button", { name: /Re-send|Revoke/ })).toHaveCount(0);
  } finally {
    await cleanUp(email);
  }
});

test("re-inviting a pending address at once is refused with the wait-a-minute message", async ({ page }) => {
  const email = freshAddress("reinvite");

  try {
    await page.goto("/users");
    await inviteThroughTheDialog(page, email);
    await expect(userRow(page, email).getByText("Invited", { exact: true })).toBeVisible();
    await waitForConfirmLink(email);

    await inviteThroughTheDialog(page, email);

    await expect(
      page.getByText("An invitation was sent less than a minute ago. Wait a minute, then re-send."),
    ).toBeVisible();
  } finally {
    await cleanUp(email);
  }
});

test("a revoked invitation disappears, and its emailed link asks the colleague to have it re-sent", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = freshAddress("revoke");

  try {
    await page.goto("/users");
    await inviteThroughTheDialog(page, email);
    await expect(userRow(page, email).getByText("Invited", { exact: true })).toBeVisible();
    const invitation = await waitForConfirmLink(email);

    await userRow(page, email)
      .getByRole("button", { name: `Revoke invitation for ${email}` })
      .click();
    const confirm = page.getByRole("alertdialog", { name: `Revoke the invitation for ${email}?` });
    await confirm.getByRole("button", { name: "Revoke invitation" }).click();
    // The open dialog hides the page from the accessibility tree, so the row reads as gone until it
    // closes: wait for that first, then for the reload a successful revoke triggers.
    await expect(confirm).toBeHidden();
    await expect(rolePicker(page, email)).toHaveCount(0);

    await withFreshContext(browser, baseURL, async (colleague) => {
      await colleague.goto(invitation.link);
      await colleague.getByRole("button", { name: "Continue" }).click();
      await expect(colleague).toHaveURL(/\/auth\/confirm\?error=invite-expired$/);
      await expect(colleague.getByText(INVITE_EXPIRED)).toBeVisible();
      await expect(colleague.getByRole("link", { name: "Already set your password? Sign in" })).toBeVisible();
    });
  } finally {
    await cleanUp(email);
  }
});

test("inviting an address that already has an account is refused in the dialog, and nothing is sent", async ({
  page,
}) => {
  await page.goto("/users");
  const mailBefore = (await messagesTo(adminEmail)).length;

  await inviteThroughTheDialog(page, adminEmail);

  await expect(page.getByRole("dialog").getByText("An account with this email already exists.")).toBeVisible();
  // The refusal is the function's answer, given before any send: nothing can still be on its way.
  expect((await messagesTo(adminEmail)).length).toBe(mailBefore);
});

test("an admin opening an invite link in their own browser is warned before Continue switches their session", async ({
  page,
}) => {
  const email = freshAddress("warned");

  try {
    await page.goto("/users");
    await inviteThroughTheDialog(page, email);
    await expect(userRow(page, email).getByText("Invited", { exact: true })).toBeVisible();
    const invitation = await waitForConfirmLink(email);

    // Continue is never pressed: the admin's session must survive this spec (e2e/CLAUDE.md).
    await page.goto(invitation.link);

    await expect(
      page.getByText(`You're signed in as ${adminEmail}. Continuing signs you in as the person this link was sent to.`),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  } finally {
    await cleanUp(email);
  }
});

const freshAddress = (label: string): string => `${label}-${randomUUID()}@example.test`;

/** Open the dialog (waiting out hydration), type the address, and send with the default role, Viewer. */
async function inviteThroughTheDialog(page: Page, email: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Invite a colleague" });
  await clickToReveal(page.getByRole("button", { name: "Invite", exact: true }), dialog);
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(email);
  await dialog.getByRole("button", { name: "Send invitation" }).click();
}

/** Delete the throwaway account, if a revoke has not, and every message sent to its unique address. */
async function cleanUp(email: string): Promise<void> {
  try {
    await deleteUserByEmail(email);
  } finally {
    const ids = (await messagesTo(email)).map((message) => message.ID);
    if (ids.length > 0) await deleteMessages(ids);
  }
}
