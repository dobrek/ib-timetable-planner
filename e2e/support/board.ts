import { expect, type Locator, type Page } from "@playwright/test";

// Shared planner-board E2E helpers — role-based locators, the grouping-compute step, the
// dnd-kit stepped-pointer drag, and the bundle operations (move/merge/remove/ungroup) layered on
// top of it. Promoted out of cohort-switching.spec.ts once a second spec needed the solved drag
// instead of copy-pasting it; the bundle-operations spec is the third consumer, so the whole-cell
// drag + bundle affordances live here too (see e2e/CLAUDE.md "Reuse shared plumbing"). Pure board
// interaction with no test-specific meaning. Not a `*.spec.ts`/`*.setup.ts` file, so Playwright's
// testMatch does not collect it as a test.

/** The board's display name for a course: spaces collapse to underscores (no level/group here). */
export const display = (name: string): string => name.replaceAll(/ /g, "_");

/** Escape a string for safe embedding in a RegExp locator name. */
const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- Board locators (role-based; see e2e/CLAUDE.md "Role + ARIA as the grid contract") -------

/**
 * A timetable cell by its accessible name, e.g. "Wed, P5". A bundled cell keeps `role="gridcell"`
 * (its explicit role is not overridden when dnd-kit makes it the whole-slot drag surface), so this
 * resolves the cell whether it is empty, single-occupant, or a bundle.
 */
export const cell = (page: Page, name: string): Locator => page.getByRole("gridcell", { name, exact: true });

/** The palette source chip for `display` (named "<display> <placed>/<required>"); never the placed chip. */
export const paletteChip = (page: Page, displayName: string): Locator =>
  page.getByRole("button", { name: new RegExp(`^${escapeRegExp(displayName)}\\s+\\d+/\\d+$`) });

/**
 * The palette grouping box for a co-runnable set of `count` courses (named "<count> courses
 * <n> students …members…"). A multi-member grouping is one draggable box — dragging it fans one
 * placement per member into the target cell, the intended "place a grouping" gesture. (A 1-member
 * grouping renders as a single `paletteChip` instead.)
 */
export const groupingBox = (page: Page, count: number): Locator =>
  page.getByRole("button", { name: new RegExp(`^${count} courses `) });

/** The placed chip in `slot` for `display` (a draggable with role=button, name starts with the course). */
export const placedChip = (page: Page, slot: string, displayName: string): Locator =>
  cell(page, slot).getByRole("button", { name: new RegExp(`^${escapeRegExp(displayName)}`) });

/** The chip's collision badge — present only when the cell is in a blocking violation. */
export const collisionBadge = (page: Page, slot: string): Locator =>
  cell(page, slot).getByRole("button", { name: "Show collision details", exact: true });

/** The group/ungroup toggle on a cell's bundle header (label flips with the explode state). */
const bundleToggle = (page: Page, slot: string, label: "Ungroup slot" | "Group slot"): Locator =>
  cell(page, slot).getByRole("button", { name: label, exact: true });

// --- Board flow helpers ------------------------------------------------------------------------

/**
 * From the empty-state board, compute the grouping palette and wait for it to land. `ready` is the
 * post-reload landmark: a course display name (waits for its singleton `paletteChip`, for specs
 * whose courses can't co-run) or an explicit `Locator` (e.g. a multi-member `groupingBox`).
 */
export async function computeGroupings(page: Page, ready: string | Locator): Promise<void> {
  const landmark = typeof ready === "string" ? paletteChip(page, ready) : ready;
  await page.getByRole("button", { name: "Compute groupings" }).click();
  // The action persists groupings then `location.reload()`s; the palette landmark appears post-reload.
  await expect(landmark).toBeVisible({ timeout: 20_000 });
}

/**
 * The dnd-kit stepped-pointer drag from `source`'s center to `target`'s center. dnd-kit's pointer
 * sensor is NOT driven by Playwright's high-level `dragTo` (a single move misses the activation +
 * collision pass), so we issue the sequence by hand: press, nudge past the activation threshold,
 * traverse in steps, settle for collision detection, release. The single primitive every board
 * drag is built on — palette place, whole-bundle move, loose-chip move.
 */
export async function steppedDrag(page: Page, source: Locator, target: Locator): Promise<void> {
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
}

/**
 * Drag the palette chip for `display` onto `slot`. Wrapped in `toPass` and made idempotent (skip if
 * the chip is already in the cell) so a rare missed drop retries without double-placing.
 */
export async function placeFromPalette(page: Page, displayName: string, slot: string): Promise<void> {
  const landed = placedChip(page, slot, displayName);
  await expect(async () => {
    if ((await landed.count()) > 0) return; // already placed on a previous attempt
    await steppedDrag(page, paletteChip(page, displayName), cell(page, slot));
    await expect(landed).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Drag the palette grouping box of `members` onto `slot`, fanning one placement per member into
 * the cell → a bundle in one gesture. Idempotent + retried (skip if the first member already
 * landed) like `placeFromPalette`. `members` are the display names; `members[0]` is the landmark.
 */
export async function placeGrouping(page: Page, members: string[], slot: string): Promise<void> {
  const landed = placedChip(page, slot, members[0]);
  await expect(async () => {
    if ((await landed.count()) > 0) return; // already placed on a previous attempt
    await steppedDrag(page, groupingBox(page, members.length), cell(page, slot));
    await expect(landed).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Move the whole bundle at `fromSlot` onto `toSlot`. The bundled cell is itself the drag surface
 * (no handle — grabbing the cell body / a loose chip moves the slot as one unit), so we drag the
 * source cell onto the target cell. Drop onto an empty cell relocates; onto an occupied cell
 * merges — the same gesture, the server decides. `mover` is one course known to be in the bundle;
 * the move has settled when it shows up in the target (idempotent + retried like `placeFromPalette`).
 */
export async function moveBundle(page: Page, fromSlot: string, toSlot: string, mover: string): Promise<void> {
  const landed = placedChip(page, toSlot, mover);
  await expect(async () => {
    if ((await landed.count()) > 0) return; // already moved on a previous attempt
    await steppedDrag(page, cell(page, fromSlot), cell(page, toSlot));
    await expect(landed).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Drag a single loose chip for `displayName` from `fromSlot` onto `toSlot`. The cell must be
 * exploded first (`ungroupCell`) so the chip owns its own drag; grouped chips are inert. Idempotent
 * + retried — settles when the chip appears in the target.
 */
export async function dragChip(page: Page, displayName: string, fromSlot: string, toSlot: string): Promise<void> {
  const landed = placedChip(page, toSlot, displayName);
  await expect(async () => {
    if ((await landed.count()) > 0) return; // already moved on a previous attempt
    await steppedDrag(page, placedChip(page, fromSlot, displayName), cell(page, toSlot));
    await expect(landed).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * Click a cell's group/ungroup toggle and wait for the label to flip. `force: true` bypasses
 * Playwright's enabled check on purpose: dnd-kit marks an exploded (non-bundled) cell's draggable
 * `aria-disabled`, which Playwright inherits onto the toggle nested inside it — but the toggle is a
 * real, functional `<button>` (a user clicks it fine), so that actionability gate is a false
 * negative. A click (no movement) can't start a drag, and `stopDrag` stops the pointer-down anyway.
 */
async function clickBundleToggle(page: Page, slot: string, from: "Ungroup slot" | "Group slot"): Promise<void> {
  const to = from === "Ungroup slot" ? "Group slot" : "Ungroup slot";
  await bundleToggle(page, slot, from).click({ force: true });
  await expect(bundleToggle(page, slot, to)).toBeVisible();
}

/** Explode a bundled cell into individual chips (ephemeral in-session UI state — no server write). */
export async function ungroupCell(page: Page, slot: string): Promise<void> {
  await clickBundleToggle(page, slot, "Ungroup slot");
}

/** Re-collapse an exploded cell back into one bundle. */
export async function groupCell(page: Page, slot: string): Promise<void> {
  await clickBundleToggle(page, slot, "Group slot");
}

/** Remove every course in the bundled cell via the bulk-remove trash; the cell goes empty. */
export async function removeBundle(page: Page, slot: string): Promise<void> {
  await cell(page, slot).getByRole("button", { name: "Remove all from slot", exact: true }).click();
}

/**
 * Duplicate the cell at `fromSlot` and wait for the copy to land at `toSlot` (the deterministic
 * next-conflict-free target). The duplicate control is the bundle-header Copy button on a ≥2 cell or
 * the always-visible single-occupant Copy icon — both share the "Duplicate …" accessible-name prefix
 * and each cell exposes exactly one. Idempotent + retried like `moveBundle`/`placeFromPalette`: the
 * verb is a no-op while the source is still optimistically pending, so retry until the copy appears,
 * skipping if it already landed (so no double-copy). `member` is one course known to be in the source.
 * `force: true` for the same reason as `clickBundleToggle`: a non-bundled cell's dnd-kit draggable is
 * `aria-disabled`, which Playwright inherits onto the nested button as a false "disabled".
 */
export async function duplicateInto(page: Page, fromSlot: string, toSlot: string, member: string): Promise<void> {
  const landed = placedChip(page, toSlot, member);
  await expect(async () => {
    if ((await landed.count()) > 0) return; // already duplicated on a previous attempt
    await cell(page, fromSlot)
      .getByRole("button", { name: /^Duplicate\b/ })
      .click({ force: true });
    await expect(landed).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

// --- Board assertions --------------------------------------------------------------------------

/** Assert `slot` renders as a bundle (the group/ungroup toggle is present, reading "Ungroup slot"). */
export async function expectBundled(page: Page, slot: string): Promise<void> {
  await expect(bundleToggle(page, slot, "Ungroup slot")).toBeVisible();
}

/** Assert `slot` is not a bundle: no header toggle at all (fewer than two occupants, or empty). */
export async function expectNotBundled(page: Page, slot: string): Promise<void> {
  await expect(cell(page, slot).getByRole("button", { name: /^(Ungroup|Group) slot$/ })).toHaveCount(0);
}

/** Assert `slot` holds exactly the given course chips (each visible, and no extra placed chips). */
export async function expectOccupants(page: Page, slot: string, displayNames: string[]): Promise<void> {
  for (const name of displayNames) {
    await expect(placedChip(page, slot, name)).toBeVisible();
  }
  // A placed chip exposes `aria-roledescription="placement"`; assert the count so a stray occupant
  // (e.g. a merge that pulled in more than expected) fails the test rather than passing silently.
  await expect(cell(page, slot).locator('[aria-roledescription="placement"]')).toHaveCount(displayNames.length);
}

/**
 * Assert `slot` is empty (e.g. after a whole-bundle move or remove). An empty cell carries no
 * interactive children at all — no chips, no per-chip remove, no bundle header — so zero buttons
 * inside the cell is the role-based proof that nothing is placed.
 */
export async function expectEmpty(page: Page, slot: string): Promise<void> {
  await expect(cell(page, slot).getByRole("button")).toHaveCount(0);
}
