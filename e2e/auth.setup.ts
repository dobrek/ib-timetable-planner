import path from "node:path";
import { test as setup, expect } from "@playwright/test";
import { authorEmail, authorPassword } from "./author-credentials.mjs";

// Sign in once through the real UI and persist the session so the authenticated
// `chromium` project rehydrates it instead of logging in per test. This spec is
// also the empirical probe for the env-to-worker wiring: if it goes green against
// `pnpm preview`, the worker picked up SUPABASE_URL/SUPABASE_KEY from `.dev.vars`
// (otherwise `createClient` is null and sign-in fails with "Supabase is not
// configured."). Credentials come from the shared module — the SAME source the
// provisioning script reads, so the signed-in account always matches the
// provisioned one.
const authFile = path.join(import.meta.dirname, ".auth/user.json");

setup("authenticate", async ({ page }) => {
  await page.goto("/auth/signin");

  // SignInForm is a controlled React island (`client:load`): its inputs are bound to
  // useState(""), so a value typed BEFORE hydration is discarded the instant React
  // mounts and re-binds the input to its empty state. On a cold-start preview this
  // surfaces as a flake — the email fill is lost, the form submits empty, and
  // "Email is required" blocks the POST. Gate on hydration first: the show/hide
  // password toggle is React-only behaviour, so retry-clicking it until the control
  // flips proves the island is interactive; after that, fills register in React
  // state and survive to submit.
  const showPassword = page.getByRole("button", { name: "Show password" });
  const hidePassword = page.getByRole("button", { name: "Hide password" });
  await expect(async () => {
    if (await hidePassword.isVisible()) return; // already toggled → island is hydrated
    await showPassword.click();
    await expect(hidePassword).toBeVisible({ timeout: 1_000 });
  }).toPass();

  const email = page.getByLabel("Email");
  // `exact` so "Password" doesn't also match the "Show/Hide password" toggle's aria-label.
  const password = page.getByLabel("Password", { exact: true });
  await email.fill(authorEmail);
  await password.fill(authorPassword);
  // Confirm both values registered in React state before submitting.
  await expect(email).toHaveValue(authorEmail);
  await expect(password).toHaveValue(authorPassword);

  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for the post-login redirect BEFORE saving, or storageState captures a
  // pre-auth (cookie-less) context. Playwright's storageState captures all context
  // cookies, including the chunked `sb-<ref>-auth-token.0/.1` Supabase SSR cookies.
  await page.waitForURL("**/dashboard");
  await page.context().storageState({ path: authFile });
});
