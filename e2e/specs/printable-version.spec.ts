import { test, expect } from "@playwright/test";
import { computeGroupings, display, placeFromPalette } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Printable version — print-emulation coverage (context/changes/printable-version/plan.md Phase 5).
//
// Locks the chrome-hidden / content-visible print contract across the three schedule surfaces
// (student, teacher, board) plus a catalog spot-check, and the dark-mode neutralization contract
// (a `.dark` session must print ink-on-white). `page.emulateMedia({ media: "print" })` toggles the
// `@media print` rules on so `toBeHidden()`/`toBeVisible()` reflect the real print styles; it does
// NOT toggle `.dark`, so the dark path is exercised explicitly. If a future chrome change leaks a
// control into the printout — or a newly-added dark token is left out of the print re-declaration —
// this fails.
//
// Authenticated `chromium` project (reuses storageState from auth.setup). Modeled on
// student/teacher-plan-view.spec.ts; conventions in e2e/CLAUDE.md — role-based locators, state-based
// waits, teardown by deleting the plan (cascades to every child entity).

test.describe("printable version", () => {
  // One seeded plan (catalog authoring across four pages + a grouping compute + a board drag) feeds
  // every surface, so a single test walks them under print emulation.
  test.describe.configure({ timeout: 120_000 });

  test("print media hides interactive chrome and keeps real content across surfaces; dark prints ink-on-white", async ({
    page,
  }) => {
    const id = shortId();
    const teacher = `PRT${id}`;
    const course = `History ${id}`;
    const student = `Stu ${id}`;
    const courseDisplay = display(course);
    const slot = "Wed, P5";

    const plan = await createPlan(page, "printable-version");
    await createTeacher(page, plan.id, teacher);
    await createCourse(page, plan.id, { name: course, cohort: "DP1", teacher });
    await createStudent(page, plan.id, { name: student, cohort: "DP1", course });

    // Place the course on the board so every surface has real content to print.
    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, courseDisplay);
    await placeFromPalette(page, courseDisplay, slot);

    const sidebar = page.locator("#app-sidebar");
    const print = () => page.emulateMedia({ media: "print" });
    const screen = () => page.emulateMedia({ media: "screen" });

    // ── Student surface ──────────────────────────────────────────────────────────────────────
    await gotoStable(page, `/plans/${plan.id}/students`);
    await page.getByRole("link", { name: student, exact: true }).click();
    await page.waitForURL(/\/students\/[0-9a-f-]{36}$/);
    const studentGrid = page.getByRole("grid", { name: `${student} timetable` });
    await expect(studentGrid).toBeVisible();

    await print();
    // Chrome gone: sidebar + the header controls (switcher + export + Print).
    await expect(sidebar).toBeHidden();
    await expect(page.getByRole("button", { name: "Switch student" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Export student plan" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
    // Content stays: the grid and the course list.
    await expect(studentGrid).toBeVisible();
    await expect(page.getByRole("region", { name: "Courses" })).toBeVisible();
    await screen();

    // ── Teacher surface ──────────────────────────────────────────────────────────────────────
    await gotoStable(page, `/plans/${plan.id}/teachers`);
    await page.getByRole("link", { name: teacher, exact: true }).click();
    await page.waitForURL(/\/teachers\/[0-9a-f-]{36}$/);
    const teacherGrid = page.getByRole("grid", { name: `${teacher} timetable` });
    await expect(teacherGrid).toBeVisible();

    await print();
    await expect(sidebar).toBeHidden();
    await expect(page.getByRole("button", { name: "Switch teacher" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
    await expect(teacherGrid).toBeVisible();
    await expect(page.getByRole("region", { name: "Courses" })).toBeVisible();
    await screen();

    // ── Board surface ────────────────────────────────────────────────────────────────────────
    await gotoStable(page, `/plans/${plan.id}`);
    const boardGrid = page.locator('[data-slot="planner-grid"]');
    await expect(boardGrid).toBeVisible();

    await print();
    // Editing chrome gone: sidebar, palette, shelf, and the top-bar controls (Print lives there).
    await expect(sidebar).toBeHidden();
    await expect(page.locator('[data-slot="planner-palette"]')).toBeHidden();
    await expect(page.getByRole("complementary", { name: "Shelf" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
    // Grid with its placed chip stays; the print-only plan-name title appears (parity with the
    // perspective pages — the on-screen top-bar title is print-hidden, so only this heading is left).
    await expect(boardGrid).toBeVisible();
    await expect(page.locator('[data-slot="placed-chip"]').first()).toBeVisible();
    await expect(page.getByRole("heading", { name: plan.name })).toBeVisible();
    await screen();

    // ── Catalog spot-check (free-falling pages) ──────────────────────────────────────────────
    await gotoStable(page, `/plans/${plan.id}/teachers`);
    const teacherRow = page.getByRole("cell", { name: teacher, exact: true });
    await expect(teacherRow).toBeVisible();
    await print();
    await expect(sidebar).toBeHidden();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(teacherRow).toBeVisible();
    await screen();

    // ── Dark neutralization (theming gate) ───────────────────────────────────────────────────
    // emulateMedia does not toggle `.dark`, so add it, then emulate print, then read the body's
    // RESOLVED background-color. It must be LIGHT (dark session prints ink-on-white). Normalize the
    // lightness to a 0–1 scale before guarding: Chromium serializes the token as `oklch(...)` here
    // and Lightning CSS may render the lightness as a percentage (`oklch(14.5% 0 0)`), so a naive
    // numeric parse would read "14.5" as light and pass vacuously. Guard for "is light", not an
    // exact color, so token tweaks stay non-brittle.
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    await print();
    const bodyBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const lightness = normalizedLightness(bodyBackground);
    expect(
      lightness,
      `body background under .dark + print was "${bodyBackground}" (expected a light color)`,
    ).toBeGreaterThan(0.5);
    await screen();

    await deletePlan(page, plan.name);
  });
});

/**
 * Normalize a CSS color's lightness to a 0–1 scale so one "is light" threshold works across
 * serializations: `oklch(1 0 0)` / `oklch(100% 0 0)` → 1, `oklch(0.145 0 0)` / `oklch(14.5% 0 0)` →
 * 0.145, and an `rgb(r,g,b)` fallback → channel-average / 255. Returns NaN when unrecognized, so the
 * guard fails loudly rather than passing vacuously.
 */
function normalizedLightness(color: string): number {
  const oklch = /oklch\(\s*([\d.]+)(%?)/.exec(color);
  if (oklch) return Number(oklch[1]) / (oklch[2] === "%" ? 100 : 1);
  const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  if (rgb) return (Number(rgb[1]) + Number(rgb[2]) + Number(rgb[3])) / 3 / 255;
  return NaN;
}
