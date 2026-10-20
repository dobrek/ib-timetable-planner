import { test, expect } from "@playwright/test";

// Runs in the `chromium-guard` project (no storageState → no session cookies), so
// the real deny-by-default middleware is what rejects the request. This is the
// first auth layer: an unauthenticated visitor hitting a protected PAGE is
// 302-redirected to the sign-in surface (middleware.ts redirect on !locals.user).
test("unauthenticated visitor is redirected from a protected page", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/auth\/signin/);
});

// /account is an ordinary authenticated route (S-401): the same deny-by-default redirect guards it.
test("unauthenticated visitor is redirected from the account page", async ({ page }) => {
  await page.goto("/account");

  await expect(page).toHaveURL(/\/auth\/signin/);
});

// --- S-402: the password-reset surface ------------------------------------------------------------
// Exactly the decided surface is public, and the endpoint that spends a link cannot be reached by
// a mail scanner's GET or HEAD, nor by another site's form.

test("the forgot-password page is public", async ({ page }) => {
  await page.goto("/auth/forgot");

  await expect(page).toHaveURL(/\/auth\/forgot$/);
  await expect(page.getByRole("heading", { level: 1, name: "Forgot password" })).toBeVisible();
});

test("the confirm page is public, and with no link it says the link is incomplete", async ({ page }) => {
  await page.goto("/auth/confirm");

  await expect(page).toHaveURL(/\/auth\/confirm$/);
  await expect(page.getByText("This link is incomplete.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
});

for (const path of ["/api/auth/confirm", "/api/auth/forgot"]) {
  test(`${path} answers GET and HEAD with 404, so fetching it does nothing`, async ({ request }) => {
    // `maxRedirects: 0`: a middleware redirect would read as a 302 here, not as a follow-through 404.
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(404);
    expect((await request.head(path, { maxRedirects: 0 })).status()).toBe(404);
  });
}

test("a cross-site form POST to the reset request is refused before it runs", async ({ request }) => {
  const response = await request.post("/api/auth/forgot", {
    form: { email: "nobody@example.test" },
    headers: { Origin: "https://evil.example" },
    maxRedirects: 0,
  });

  expect(response.status()).toBe(403);
});

test("the recovery landing still needs a session", async ({ page }) => {
  await page.goto("/account?notice=recovery");

  await expect(page).toHaveURL(/\/auth\/signin/);
});
