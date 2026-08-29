import { expect, test } from "@playwright/test";
import { display } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

/**
 * Generate, end to end, against a real CP-SAT solver — the coverage the Known-gaps list carried as
 * "Generate has no E2E coverage" until S-306.
 *
 * **What only this lane can prove.** The integration suites drive `startGeneration` and `checkPlan`
 * as functions, with the solver faked at the transport seam or its terminal row written by hand. The
 * one thing neither can reach is the chain as the AUTHOR meets it: a click on a real button, an Astro
 * Action over the wire, a real 202 to a real service, a proposal row that appears on the hub, a page
 * that turns itself into a board, and a source plan that is still empty afterwards. Every one of
 * those seams has been wrong at least once in this slice family, and each was found by hand.
 *
 * **The fixture is small on purpose, and specifically shaped.** One course and one student per cohort
 * mirrors `src/test/generation-proposal.integration.test.ts`, which solves in about a second. A
 * one-cohort plan would be smaller still and is an untested solver input for the full chain, so both
 * cohorts get a course even though only one of them is asserted on.
 *
 * **Timing is expressed as a generous `toBeVisible`, never a `waitForTimeout`.** The proposal page
 * polls itself and navigates when the board lands, so the wait is for a DOM condition that will
 * arrive when it arrives — a sleep would be either flaky on a loaded runner or slower than it needs
 * to be on an idle one.
 *
 * **`SOLVER_URL` must be in `.dev.vars` before the build.** `astro build` snapshots that file into
 * `dist/server/`, and the preview reads the copy — so exporting it into the shell would leave the
 * Worker with no transport and every dispatch refused as "not configured". CI writes it in the `e2e`
 * job before `pnpm test:e2e`; locally `.envs/local.vars` already carries it. Without a solver running
 * this spec fails at the Generate click, loudly, which is the honest outcome.
 */
test.describe("generation", () => {
  test("Generate produces a pending proposal that delivers itself into a board", async ({ page }) => {
    const suffix = shortId();
    const teacher = `GEN-${suffix}`;
    const dp1Course = `Gen DP1 ${suffix}`;
    const dp2Course = `Gen DP2 ${suffix}`;

    const plan = await createPlan(page, "generation");
    await createTeacher(page, plan.id, teacher);
    await createCourse(page, plan.id, { name: dp1Course, cohort: "DP1", teacher });
    await createStudent(page, plan.id, { name: `Gen S1 ${suffix}`, cohort: "DP1", course: dp1Course });
    await createCourse(page, plan.id, { name: dp2Course, cohort: "DP2", teacher });
    await createStudent(page, plan.id, { name: `Gen S2 ${suffix}`, cohort: "DP2", course: dp2Course });

    // --- 1. Generate, from the source plan's toolbar ------------------------------------------
    await gotoStable(page, `/plans/${plan.id}`);
    const generate = page.getByRole("button", { name: "Generate plan" });
    await expect(generate).toBeEnabled();
    await generate.click();

    // FR-308's advisory, and the proposal link that S-306 added to it: the clone is openable from
    // its first second, so the advisory is a route rather than a dead sentence.
    const strip = page.locator("[data-slot='generation-status-strip']");
    await expect(strip).toContainText("Generating a proposal from the");
    await expect(strip.getByRole("link", { name: /Open proposal/ })).toBeVisible();
    // The server enforces one active job per plan with a partial unique index; the button agrees
    // BEFORE the author spends a click discovering it.
    await expect(generate).toBeDisabled();

    // --- 2. The hub lists the proposal, with a live badge -------------------------------------
    const proposalName = `Proposal — ${plan.name}`;
    await gotoStable(page, "/plans");
    const proposalRow = page.getByRole("row", {
      name: new RegExp(proposalName.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    });
    await expect(proposalRow).toBeVisible();
    // `role="status"` is the badge's live region, and it rides on the ACTIVE badge whether or not it
    // links — which is worth asserting here because S-306 gave that badge an href for the first time.
    await expect(proposalRow.getByRole("status")).toBeVisible();

    // --- 3. Open the proposal: progress, not a board ------------------------------------------
    // A ready proposal delivers on the visit, so this may already be the board by the time the click
    // lands — the assertion is therefore "one of the two honest states", not "pending".
    const dp1Chip = page.getByRole("button", { name: new RegExp(`^${display(dp1Course)}`) });
    await proposalRow.getByRole("link", { name: proposalName }).click();
    await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: proposalName, level: 1 })).toBeVisible();
    // Whichever of the two honest states is on screen: the pending panel's live status, or — when
    // the click lost the race to a ~1 s solve — the delivered board. Asserts the panel whenever it
    // exists, which a bare heading check never did. (`role="status"` takes no name from its content,
    // so the text is matched with `hasText`, not `name`; the timeout is the board's headroom.)
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Generating/ })
        .or(dp1Chip.first()),
    ).toBeVisible({ timeout: 120_000 });

    // --- 4. It becomes the board on its own ---------------------------------------------------
    // The pending page polls `checkPlan` and navigates when a board lands; the fixture solves in
    // ~1 s, so the generous timeout is headroom for a loaded runner, not an expectation.
    await expect(dp1Chip.first()).toBeVisible({ timeout: 120_000 });

    // The provenance strip: what this board came from, which is the proposal's whole identity.
    await expect(page.locator("[data-slot='generation-status-strip']")).toContainText(`Generated from ${plan.name}`);

    // --- 5. The source plan was never written to ----------------------------------------------
    // The invariant the entire slice exists to hold (FR-307). Its board still has everything left to
    // place, and its strip says nothing at all now that the result lives elsewhere.
    await gotoStable(page, `/plans/${plan.id}`);
    await expect(page.getByRole("button", { name: /hours left to place/ })).toBeVisible();
    await expect(page.locator("[data-slot='generation-status-strip']")).toHaveCount(0);

    // Teardown: the proposal first, because deleting the source while its job row is alive is
    // exactly what `assertNoActiveJob` refuses.
    await deletePlan(page, proposalName);
    await deletePlan(page, plan.name);
  });
});
