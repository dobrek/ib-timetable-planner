import { test, expect } from "@playwright/test";

// Runs in the `chromium-guard` project (no storageState → no session cookies), so
// the real deny-by-default middleware is what rejects the request. This is the
// first auth layer: an unauthenticated visitor hitting a protected PAGE is
// 302-redirected to the sign-in surface (middleware.ts redirect on !locals.user).
test("unauthenticated visitor is redirected from a protected page", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/auth\/signin/);
});
