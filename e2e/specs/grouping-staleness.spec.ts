import { test, expect, type Locator, type Page } from "@playwright/test";
import { computeGroupings, display, paletteChip } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Grouping staleness → recompute round-trip — browser-level coverage (plan Phase 3,
// context/changes/grouping-refresh-stale-version/plan.md).
//
// Risk protected: staleness wiring only materialises when auth → SSR load (the server hashes the
// live catalog) → the rendered island branch → a real /_actions/computeGroupings recompute →
// refreshPage re-evaluation integrate. The unit test mocks the Action; the integration test
// exercises isGroupingStale in isolation. Neither proves the end-to-end flow, and — the high-value
// guard — neither proves the load-path hash (loadPlannerData) matches the persist-path hash
// (computeAndPersistGroupings). If those two hash sites drift, a freshly computed palette renders
// as permanently stale; asserting the panel is ABSENT right after compute fails loudly on drift.
//
// Authenticated `chromium` project (reuses storageState from auth.setup). Modeled on
// e2e/specs/cohort-switching.spec.ts; conventions in e2e/CLAUDE.md. The spec owns a uniquely named
// plan and tears it down by deleting it (cascades to every child entity). Per-cohort independence
// is already covered by cohort-switching.spec.ts's remount proof + the Phase 1 integration test's
// per-cohort filter, so this spec keeps to the single high-value lifecycle (no second cohort).

test.describe("grouping staleness + recompute", () => {
  // Builds catalog across pages and computes groupings — well past the 30s default.
  test.describe.configure({ timeout: 120_000 });

  test("a catalog edit makes the palette go stale; recompute restores it (and a fresh palette is not stale)", async ({
    page,
  }) => {
    const id = shortId();
    const teacher = `STL${id}`;
    const course = `Maths DP1 ${id}`;
    const courseDisplay = display(course);

    const plan = await createPlan(page, "grouping-staleness");

    // One DP1 course, made placeable by a single DP1 student choosing it (the grouping catalog is
    // choice-driven).
    await createTeacher(page, plan.id, teacher);
    await createCourse(page, plan.id, { name: course, cohort: "DP1", teacher });
    await createStudent(page, plan.id, { name: `Stu A ${id}`, cohort: "DP1", course });

    // Compute the palette; the course's chip lands.
    await gotoStable(page, `/plans/${plan.id}`);
    await computeGroupings(page, courseDisplay);

    // Over-staleness guard: a freshly computed palette is NOT stale (load-path hash == persist-path
    // hash). If the two hash sites drift, the panel would render here and this fails.
    await expect(recomputeButton(page)).toHaveCount(0);

    // Make the catalog stale: a second DP1 student choosing the same course grows that course's
    // studentKeys, so the catalog hash shifts away from the stored grouping hash.
    await createStudent(page, plan.id, { name: `Stu B ${id}`, cohort: "DP1", course });

    // Reload the board — SSR now hashes the changed catalog and threads stale: true.
    await gotoStable(page, `/plans/${plan.id}`);

    // Stale: the recompute panel replaces the palette (the chip is gone, the Recompute button is up).
    await expect(recomputeButton(page)).toBeVisible();
    await expect(paletteChip(page, courseDisplay)).toHaveCount(0);

    // Recompute: a real /_actions/computeGroupings round-trip on workerd re-persists with the new
    // hash, then refreshPage re-evaluates — the returning palette is the success signal.
    await recomputeButton(page).click();
    await expect(paletteChip(page, courseDisplay)).toBeVisible({ timeout: 20_000 });
    await expect(recomputeButton(page)).toHaveCount(0);

    await deletePlan(page, plan.name);
  });
});

/** The stale-palette panel's Recompute control (idle name only — "Recomputing…" is the busy label). */
const recomputeButton = (page: Page): Locator => page.getByRole("button", { name: "Recompute", exact: true });
