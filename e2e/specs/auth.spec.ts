import { test, expect } from "@playwright/test";
import { authorEmail } from "../author-credentials.mjs";

// Runs in the `chromium` project, which is authenticated via the storageState the
// setup spec persists. The positive control: navigating to a protected page
// rehydrates the saved session and renders the dashboard — proving session reuse
// (no fresh sign-in, no bounce to /auth/signin). The matching email also confirms
// the rehydrated session is the provisioned author's, not some stale fixture.
test("authenticated author lands on the protected dashboard", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/dashboard$/);

  // Scope the "Signed in as <email>" assertion to the page header so it can't
  // collide with the same email rendered in the sidebar.
  const header = page.locator("header");
  await expect(header.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(header.getByText("Signed in as")).toBeVisible();
  await expect(header.getByText(authorEmail)).toBeVisible();

  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});
