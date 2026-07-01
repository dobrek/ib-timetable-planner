import { test, expect } from "@playwright/test";
import { computeGroupings, display, placeFromPalette, placedChip } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Coarse drop-accuracy tripwire for board zoom — the single E2E gate for `plan-board-zoom` (Phase 4).
//
// What it protects: CSS `zoom` on the grid subtree relies on Chromium keeping `getBoundingClientRect`
// and pointer coords in the SAME scaled space, so dnd-kit's pointer-vs-rect hit-test still maps the
// cursor to the addressed cell. This is verified by hand across the full 25–150% matrix; this spec is
// the automated backstop that turns a *silent* regression — a dnd-kit bump, a Chromium `zoom` change,
// or a grid CSS edit that breaks drop mapping under scale — into a red CI.
//
// Deliberately COARSE: it asserts the resulting placement's cell identity (`(day, period)`), NOT pixel
// coordinates. Exact-coordinate hit-testing under `zoom` is flaky, which is why the full matrix stays
// manual and this proves only "a chip dropped at ~50% zoom lands on the right cell".
//
// Authenticated `chromium` project (reuses storageState). Owns a uniquely named plan and tears it down
// by deleting it (cascades to every child entity). Conventions: e2e/CLAUDE.md.

test.describe("drop accuracy under board zoom", () => {
  // Builds catalog across courses/students pages and computes groupings — past the 30s default.
  test.describe.configure({ timeout: 120_000 });

  test("a palette chip dropped at ~50% zoom lands on the expected (day, period) cell", async ({ page }) => {
    const id = shortId();
    const teacher = `ZM${id}`;
    const courseName = `Zoomy ${id}`;
    const course = display(courseName);
    const slot = "Wed, P5";

    const plan = await createPlan(page, "zoom-drop-accuracy");
    await createTeacher(page, plan.id, teacher);
    await createCourse(page, plan.id, { name: courseName, cohort: "DP1", teacher });
    await createStudent(page, plan.id, { name: `Stu ${id}`, cohort: "DP1", course: courseName });

    await gotoStable(page, `/plans/${plan.id}?focus=dp1`);
    await computeGroupings(page, course);

    // Zoom the board to ~50% through the real control: gear → Board settings popover → slider.
    // The slider is the only one on the page; drive it by keyboard (10 × ArrowLeft = 1.0 → 0.5 at a
    // 0.05 step) so we don't depend on pixel geometry to *set* the zoom we're about to test.
    await page.getByRole("button", { name: "Board settings" }).click();
    const slider = page.getByRole("slider", { name: "Zoom level" });
    await slider.focus();
    for (let i = 0; i < 10; i++) await slider.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", "0.5");
    await page.keyboard.press("Escape"); // close the popover so it can't intercept the drag

    // The make-or-break assertion: `placeFromPalette` drags the palette chip onto the addressed cell
    // and asserts the placed chip appears *inside that cell*. Under a broken zoom↔pointer mapping the
    // chip would miss and this times out red.
    await placeFromPalette(page, course, slot);
    await expect(placedChip(page, slot, course)).toBeVisible();

    await deletePlan(page, plan.name);
  });
});
