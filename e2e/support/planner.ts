import { expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Shared planner E2E plumbing — entity lifecycle + cold-start race helpers reused across specs.
//
// These are pure infrastructure (navigation retries, the hydration-race click, plan/teacher
// creation, plan teardown) with no test-specific meaning, so they live here rather than being
// copy-pasted into each spec. Course/student authoring + the board drag/locators now have a
// second consumer (drag-validate-feedback.spec.ts), so they are promoted to ../support/catalog.ts
// and ../support/board.ts respectively. Not a `*.spec.ts`/`*.setup.ts` file, so Playwright's
// default testMatch does not collect it as a test (see playwright.config.ts).

/** Short unique suffix for collision-free parallel test data. */
export const shortId = (): string => randomUUID().slice(0, 8);

/**
 * Click `opener` until `revealed` appears. Survives the cold-start hydration race: an Astro
 * `client:load` island renders its trigger via SSR, so the button is clickable *before* React
 * attaches the handler — a too-early click is silently dropped. Retrying the click (the same
 * idiom as auth.setup.ts) is deterministic where a bare click is timing-dependent.
 */
export async function clickToReveal(opener: Locator, revealed: Locator): Promise<void> {
  await expect(async () => {
    await opener.click();
    await expect(revealed.first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Hard-navigate to `path`, retrying past a lost race with an in-flight client navigation.
 * A just-completed action may still be running its post-success refresh (`refreshPage` →
 * an `astro:transitions/client` `navigate()`); a real `page.goto` issued before that soft
 * nav settles is aborted by it (`net::ERR_ABORTED`). Retrying lands once it is done. On a
 * fresh page (no nav in flight) the first attempt succeeds and `toPass` returns at once.
 */
export async function gotoStable(page: Page, path: string): Promise<void> {
  await expect(async () => {
    await page.goto(path);
  }).toPass({ timeout: 20_000 });
}

/**
 * Create a uniquely named plan (named `E2E <label> <uuid>` for traceability); returns its id
 * (from the board URL) and name (for teardown).
 */
export async function createPlan(page: Page, label: string): Promise<{ id: string; name: string }> {
  const name = `E2E ${label} ${randomUUID()}`;
  await gotoStable(page, "/plans");
  const dialog = page.getByRole("dialog");
  await clickToReveal(
    page.getByRole("button", { name: "New plan" }),
    dialog.getByRole("heading", { name: "New plan" }),
  );
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await dialog.getByRole("button", { name: "Create plan" }).click();
  // Creating a plan navigates into its (empty) board at /plans/<uuid>.
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/);
  return { id: new URL(page.url()).pathname.split("/")[2], name };
}

/** Add a teacher (code only → its display label is the code) and confirm the row landed. */
export async function createTeacher(page: Page, planId: string, code: string): Promise<void> {
  await gotoStable(page, `/plans/${planId}/teachers`);
  const dialog = page.getByRole("dialog");
  // On an empty plan the header and the empty-state both offer "New teacher"; the header is first.
  await clickToReveal(
    page.getByRole("button", { name: "New teacher" }).first(),
    dialog.getByRole("heading", { name: "New teacher" }),
  );
  await dialog.getByLabel("Code").fill(code);
  await dialog.getByRole("button", { name: "Create teacher" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("cell", { name: code, exact: true })).toBeVisible();
}

/** Tear down: deleting the plan cascades to its courses, teachers, students, and placements. */
export async function deletePlan(page: Page, planName: string): Promise<void> {
  await gotoStable(page, "/plans");
  await clickToReveal(page.getByRole("button", { name: `Actions for ${planName}` }), page.getByRole("menuitem"));
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: `Delete ${planName}?` })).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: planName })).toHaveCount(0);
}
