import { test, expect } from "@playwright/test";
import { computeGroupings, display, placeFromPalette, placedChip } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

// Drag → validate → feedback loop — browser-level coverage (plan Phase 3,
// context/changes/testing-drag-validate-feedback/plan.md; test-plan.md Risk #2, §5 gate).
//
// What this proves that the hook test (use-placements.test.tsx) and the unit parity guards
// cannot: that a real collision, derived client-side from committed placement state, is *visibly
// rendered* in a real browser — "the validator returned blocking" is not the same as "the user
// saw the chip flagged". The verdict path under test is `deriveCellViolations` → `aria-invalid`
// on the placed chip (PlacedChip.tsx:54-66), reached only after auth → SSR board → hydration →
// the dnd-kit drag integrate.
//
// Over-rejection guard built into the one flow: the first (single) drop reads valid
// (aria-invalid="false") before the conflicting second drop onto the SAME slot reads
// aria-invalid="true". A test that only checks the reject could pass by flagging everything.
//
// Authenticated `chromium` project (reuses storageState from auth.setup). Owns a uniquely named
// plan and tears it down by deleting it (cascades to every child entity). Conventions: e2e/CLAUDE.md.
//
// Collision provisioned (single cohort DP1): one teacher teaches TWO courses, each made placeable
// by a student choosing it. Both week-agnostic, so dropping them on the same slot overlaps every
// week — a real, blocking teacher collision.

test.describe("drag → validate → feedback", () => {
  // Builds catalog across courses/students pages and computes groupings — past the 30s default.
  test.describe.configure({ timeout: 120_000 });

  test("a clean drop reads valid; a conflicting drop on the same slot renders aria-invalid", async ({ page }) => {
    const id = shortId();
    const teacher = `SHR${id}`;
    const alphaCourse = `Alpha ${id}`;
    const bravoCourse = `Bravo ${id}`;
    const alpha = display(alphaCourse);
    const bravo = display(bravoCourse);
    const slot = "Wed, P5";

    const plan = await createPlan(page, "drag-validate-feedback");

    // One teacher teaching two DP1 courses; a single-choice student per course makes each placeable.
    await createTeacher(page, plan.id, teacher);
    await createCourse(page, plan.id, { name: alphaCourse, cohort: "DP1", teacher });
    await createCourse(page, plan.id, { name: bravoCourse, cohort: "DP1", teacher });
    await createStudent(page, plan.id, { name: `Stu A ${id}`, cohort: "DP1", course: alphaCourse });
    await createStudent(page, plan.id, { name: `Stu B ${id}`, cohort: "DP1", course: bravoCourse });

    await gotoStable(page, `/plans/${plan.id}`);
    await computeGroupings(page, alpha);

    // --- Clean drop: Alpha alone in the slot is a valid placement (over-rejection guard).
    await placeFromPalette(page, alpha, slot);
    await expect(placedChip(page, slot, alpha)).toHaveAttribute("aria-invalid", "false");

    // --- Conflicting drop: Bravo (same teacher) onto the SAME slot → blocking teacher collision.
    await placeFromPalette(page, bravo, slot);
    await expect(placedChip(page, slot, bravo)).toHaveAttribute("aria-invalid", "true");
    // The verdict recomputes over both occupants, so Alpha now reads blocking too.
    await expect(placedChip(page, slot, alpha)).toHaveAttribute("aria-invalid", "true");

    await deletePlan(page, plan.name);
  });
});
