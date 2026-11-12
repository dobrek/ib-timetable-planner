import { expect, type Browser, type Page } from "@playwright/test";

/**
 * Sign in through the real UI and wait for the post-login redirect. Only the setup files call this
 * (`auth.setup.ts`, `no-role.setup.ts`): every spec starts signed in from their storageState. Two
 * sanctioned exceptions, each for a throwaway account in a fresh context (e2e/CLAUDE.md):
 * `create-account.admin.spec.ts` (S-409), the account an admin just created, whose first sign-in IS
 * the behaviour under test (it passes `landsOn`, because a user on a temporary password is sent on
 * from /dashboard to /account); and `deactivate.admin.spec.ts` (S-408), a throwaway author whose
 * live session meeting the deactivation IS the behaviour under test.
 */
export async function signInThroughUi(
  page: Page,
  email: string,
  password: string,
  landsOn = "**/dashboard",
): Promise<void> {
  await fillSignInForm(page, email, password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for the post-login redirect BEFORE the caller saves, or storageState captures a pre-auth
  // (cookie-less) context. An account lands on /dashboard (a role-less one sees the notice there),
  // except one on a temporary password, which lands on /account: hence `landsOn`.
  await page.waitForURL(landsOn);
}

/**
 * Open /auth/signin and fill it once the form is live, without submitting. A spec that submits a
 * sign-in it expects to be REFUSED (`create-account.admin.spec.ts`'s dead password) uses this
 * directly; `signInThroughUi` builds on it.
 *
 * SignInForm is a controlled React island (`client:load`): its inputs are bound to useState(""), so
 * a value typed BEFORE hydration is discarded the instant React mounts and re-binds the input to its
 * empty state. On a cold-start preview this surfaces as a flake — the email fill is lost, the form
 * submits empty, and "Email is required" blocks the POST. Gate on hydration first: the show/hide
 * password toggle is React-only behaviour, so retry-clicking it until the control flips proves the
 * island is interactive; after that, fills register in React state and survive to submit.
 */
export async function fillSignInForm(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/auth/signin");

  const showPassword = page.getByRole("button", { name: "Show password" });
  const hidePassword = page.getByRole("button", { name: "Hide password" });
  await expect(async () => {
    if (await hidePassword.isVisible()) return; // already toggled → island is hydrated
    await showPassword.click();
    await expect(hidePassword).toBeVisible({ timeout: 1_000 });
  }).toPass();

  const emailField = page.getByLabel("Email");
  // `exact` so "Password" doesn't also match the "Show/Hide password" toggle's aria-label.
  const passwordField = page.getByLabel("Password", { exact: true });
  await emailField.fill(email);
  await passwordField.fill(password);
  // Confirm both values registered in React state before submitting.
  await expect(emailField).toHaveValue(email);
  await expect(passwordField).toHaveValue(password);
}

/**
 * A browser context with no stored session: a person who has only what an admin gave them, a
 * password (`create-account.admin.spec.ts`) or an emailed link (`invite.admin.spec.ts`). Its own
 * context, because spending a link or signing in replaces whatever session a context holds.
 */
export async function withFreshContext(
  browser: Browser,
  baseURL: string | undefined,
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ baseURL });
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}
