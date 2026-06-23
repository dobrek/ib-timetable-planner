import { expect, type Locator, type Page } from "@playwright/test";

// Shared planner-board E2E helpers — role-based locators, the grouping-compute step, and the
// dnd-kit stepped-pointer drag. Promoted out of cohort-switching.spec.ts once a second spec
// (drag-validate-feedback) needed the solved drag instead of copy-pasting it. Pure board
// interaction with no test-specific meaning (see e2e/CLAUDE.md "Reuse shared plumbing").
// Not a `*.spec.ts`/`*.setup.ts` file, so Playwright's testMatch does not collect it as a test.

/** The board's display name for a course: spaces collapse to underscores (no level/group here). */
export const display = (name: string): string => name.replaceAll(/ /g, "_");

/** Escape a string for safe embedding in a RegExp locator name. */
const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- Board locators (role-based; see e2e/CLAUDE.md "Role + ARIA as the grid contract") -------

/** A timetable cell by its accessible name, e.g. "Wed, P5". */
export const cell = (page: Page, name: string): Locator => page.getByRole("gridcell", { name, exact: true });

/** The palette source chip for `display` (named "<display> <placed>/<required>"); never the placed chip. */
export const paletteChip = (page: Page, displayName: string): Locator =>
  page.getByRole("button", { name: new RegExp(`^${escapeRegExp(displayName)}\\s+\\d+/\\d+$`) });

/** The placed chip in `slot` for `display` (a draggable with role=button, name starts with the course). */
export const placedChip = (page: Page, slot: string, displayName: string): Locator =>
  cell(page, slot).getByRole("button", { name: new RegExp(`^${escapeRegExp(displayName)}`) });

/** The chip's collision badge — present only when the cell is in a blocking violation. */
export const collisionBadge = (page: Page, slot: string): Locator =>
  cell(page, slot).getByRole("button", { name: "Show collision details", exact: true });

// --- Board flow helpers ------------------------------------------------------------------------

/** From the empty-state board, compute the grouping palette and wait for `display`'s chip to land. */
export async function computeGroupings(page: Page, displayName: string): Promise<void> {
  await page.getByRole("button", { name: "Compute groupings" }).click();
  // The action persists groupings then `location.reload()`s; the palette chip appears post-reload.
  await expect(paletteChip(page, displayName)).toBeVisible({ timeout: 20_000 });
}

/**
 * Drag the palette chip for `display` onto `slot`. dnd-kit's pointer sensor is NOT driven by
 * Playwright's high-level `dragTo` (a single move misses the activation + collision pass), so we
 * issue a stepped pointer sequence by hand: press, nudge past the threshold, traverse in steps,
 * settle for collision detection, release. Wrapped in `toPass` and made idempotent (skip if the
 * chip is already in the cell) so a rare missed drop retries without double-placing.
 */
export async function placeFromPalette(page: Page, displayName: string, slot: string): Promise<void> {
  const landed = placedChip(page, slot, displayName);
  await expect(async () => {
    if ((await landed.count()) > 0) return; // already placed on a previous attempt
    const source = paletteChip(page, displayName);
    const target = cell(page, slot);
    const a = await source.boundingBox();
    const b = await target.boundingBox();
    if (!a || !b) throw new Error("drag source or target not visible");
    const sx = a.x + a.width / 2;
    const sy = a.y + a.height / 2;
    const tx = b.x + b.width / 2;
    const ty = b.y + b.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 6, sy + 6, { steps: 3 }); // cross the activation distance
    await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 10 });
    await page.mouse.move(tx, ty, { steps: 10 });
    await page.mouse.move(tx, ty, { steps: 3 }); // settle so the cell wins collision detection
    await page.mouse.up();
    await expect(landed).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
