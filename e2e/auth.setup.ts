import path from "node:path";
import { test as setup } from "@playwright/test";
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
  await page.getByLabel("Email").fill(authorEmail);
  // `exact` so "Password" doesn't also match the "Show password" toggle button's aria-label.
  await page.getByLabel("Password", { exact: true }).fill(authorPassword);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for the post-login redirect BEFORE saving, or storageState captures a
  // pre-auth (cookie-less) context. Playwright's storageState captures all context
  // cookies, including the chunked `sb-<ref>-auth-token.0/.1` Supabase SSR cookies.
  await page.waitForURL("**/dashboard");
  await page.context().storageState({ path: authFile });
});
