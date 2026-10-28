import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

// Runs in `chromium-no-role`, signed in as the provisioned account that never holds a role
// (S-403, FR-410), on real workerd and cookie SSR. The middleware reads the role live on every gated
// page and every action, so what this account sees is exactly what an admin's "none" means.
//
// Read-only on purpose: no spec here signs out or touches the password form, or the next run's
// `setup` could not sign in as this account (e2e/CLAUDE.md).

const NOTICE = "No access yet — ask your admin";

test("the dashboard shows the no-access notice, and no Plans entry anywhere", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: NOTICE })).toBeVisible();
  await expect(page.getByRole("link", { name: "your account" })).toHaveAttribute("href", "/account");
  // Home proves the sidebar rendered, so the missing Plans link is not a missing sidebar.
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Home" })).toBeVisible();
  // Not exact: any link naming plans, in the tiles or the sidebar, fails this.
  await expect(page.getByRole("link", { name: "Plans" })).toHaveCount(0);
});

// The title stays fixed and the id is drawn inside the test: Playwright matches tests across worker
// processes by title, so a random title would be "not found".
for (const [label, path] of [
  ["the plans hub", () => "/plans"],
  ["a plan URL", () => `/plans/${randomUUID()}`],
] as const) {
  test(`${label} lands on the dashboard notice`, async ({ page }) => {
    await page.goto(path());

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: NOTICE })).toBeVisible();
  });
}

test("the account page stays open, with both of its forms", async ({ page }) => {
  await page.goto("/account");

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Display name" }).getByLabel("Display name")).toBeVisible();
  const passwordForm = page.getByRole("form", { name: "Change password" });
  await expect(passwordForm.getByLabel("New password", { exact: true })).toBeVisible();
});

// The HTTP pattern of action-unauth.spec.ts, but on this account's cookies (`page.request` shares
// the context's storageState), so the session gate passes and the capability guard is what answers.
// Schema-valid bodies, so input validation cannot be what refuses them.
test("an edit action is refused with FORBIDDEN over HTTP", async ({ page }) => {
  const response = await page.request.post("/_actions/createPlan", {
    data: { name: "e2e-no-role-probe", slotGridPreset: "5x10" },
  });

  expect(response.status()).toBe(403);
  expect(((await response.json()) as { code?: string }).code).toBe("FORBIDDEN");
});

// createPlan alone cannot tell the guard from RLS: its INSERT would also raise 42501, which maps to
// the same FORBIDDEN. A DELETE that RLS refuses raises nothing — 0 rows, a silent success — so only
// the guard can make this one a 403. It names a random id, so it could delete nothing either way.
test("a delete RLS would refuse silently is refused with FORBIDDEN by the action guard", async ({ page }) => {
  const response = await page.request.post("/_actions/deletePlan", { data: { id: randomUUID() } });

  expect(response.status()).toBe(403);
  expect(((await response.json()) as { code?: string }).code).toBe("FORBIDDEN");
});
