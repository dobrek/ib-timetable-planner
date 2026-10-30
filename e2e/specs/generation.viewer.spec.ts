import { expect, test, type Locator, type Page } from "@playwright/test";
import { display } from "../support/board";
import { createCourse, createStudent } from "../support/catalog";
import { createPlan, createTeacher, deletePlan, gotoStable, shortId } from "../support/planner";

/**
 * A finished proposal waits for an author (S-405, Open Question 1 decided as "wait for an author"),
 * end to end against the real CP-SAT solver — the same native service `generation.spec.ts` needs.
 *
 * **What it proves.** Delivery writes the board, so only an editor's request can land it. A viewer who
 * opens a finished, undelivered proposal sees "Finished — waiting for an author", and nothing the
 * viewer's page does (its render, its poll) delivers it. Once an author opens the proposal, the
 * viewer's page — untouched — turns itself into the board on its next poll, read-only.
 *
 * **Why the author's page must not deliver first.** An editor's read of the job is `checkPlan`, which
 * delivers a finished board as a side effect, and the source board makes one such read right after
 * Generate (to show the strip). The fixture solves in under a second, so that read could land after
 * the solve and deliver before the viewer ever looks — and the waiting state this spec exists for
 * would be a race. So the author's source page has that one read pointed at `readPlanJob`, the
 * write-free twin that returns the same view: the strip still shows the proposal link. The page is
 * closed as soon as the link is read, so no author page is open while the viewer waits, and nothing
 * else delivers: the solver writes only the job row, and the hub's poll (another spec's author may
 * have the hub open) is status-only. The board lands when step 3 opens the proposal, on purpose.
 *
 * Runs in `chromium-viewer`, so the default `page` is the viewer's; the author works in a second
 * context on its storageState. Like `generation.spec.ts`, the waits are generous `toBeVisible`s on
 * DOM state, never sleeps, and `SOLVER_URL` must be in `.dev.vars` before the build.
 */
const AUTHOR_STATE = "e2e/.auth/user.json";

// The pending page polls every `DEFAULT_POLL_INTERVAL_MS` (5 s, `@/shared/lib/polling-store`), then
// reloads into the board: one interval, the read, and the reload's render, with headroom for a
// loaded runner.
const FLIP_TIMEOUT_MS = 20_000;

test.describe("generation, as a viewer", () => {
  // Catalog authoring on three pages, a solve, and two pages that wait on it.
  test.describe.configure({ timeout: 180_000 });

  test("a finished proposal waits for an author, then turns into a read-only board on the viewer's page", async ({
    page,
    browser,
  }) => {
    const suffix = shortId();
    const teacher = `GV-${suffix}`;
    const dp1Course = `GenV DP1 ${suffix}`;
    const dp2Course = `GenV DP2 ${suffix}`;
    // A placed chip: scoped to the grid's cells, so an author's palette chip of the same name never
    // stands in for it.
    const dp1Chip = (target: Page) =>
      target
        .getByRole("gridcell")
        .getByRole("button", { name: new RegExp(`^${display(dp1Course)}`) })
        .first();

    const author = await browser.newContext({ storageState: AUTHOR_STATE });

    try {
      // --- 1. The author generates, reads the proposal's URL, and closes the page ---------------
      // Same fixture as generation.spec.ts: one course and one student per cohort, about a second.
      const source = await author.newPage();
      const plan = await createPlan(source, "viewer-generation");
      await createTeacher(source, plan.id, teacher);
      await createCourse(source, plan.id, { name: dp1Course, cohort: "DP1", teacher });
      await createStudent(source, plan.id, { name: `GenV S1 ${suffix}`, cohort: "DP1", course: dp1Course });
      await createCourse(source, plan.id, { name: dp2Course, cohort: "DP2", teacher });
      await createStudent(source, plan.id, { name: `GenV S2 ${suffix}`, cohort: "DP2", course: dp2Course });

      await gotoStable(source, `/plans/${plan.id}`);
      // Page-scoped, so step 3's page in the same context still delivers. See the docblock.
      await source.route("**/_actions/checkPlan", (route) =>
        route.continue({ url: route.request().url().replace("/_actions/checkPlan", "/_actions/readPlanJob") }),
      );
      const generate = source.getByRole("button", { name: "Generate plan" });
      await expect(generate).toBeEnabled();
      await generate.click();
      await source
        .getByRole("alertdialog")
        .getByRole("button", { name: /^Generate — / })
        .click();
      const openProposal = source.getByRole("link", { name: /Open proposal/ });
      await expect(openProposal).toBeVisible();
      const proposalPath = (await openProposal.getAttribute("href")) ?? "";
      expect(proposalPath).toMatch(/^\/plans\/[0-9a-f-]{36}$/);
      await source.close();

      const proposalName = `Proposal — ${plan.name}`;

      try {
        // --- 2. The viewer opens the proposal: finished, and waiting for an author ---------------
        await page.goto(proposalPath);
        await expect(page.getByRole("heading", { name: proposalName, level: 1 })).toBeVisible();
        // `role="status"` takes no name from its content, so the text is matched with `hasText`. The
        // timeout covers a solve still running when the page loads: the poll reports it finished.
        await expect(page.getByRole("status").filter({ hasText: "Finished — waiting for an author" })).toBeVisible({
          timeout: 120_000,
        });
        await expect(
          page.getByText("This proposal has finished. Its board appears here once an author or admin opens it."),
        ).toBeVisible();
        // Stopping is an editor's act ("Stop & keep", or "Stop anyway" with nothing to keep).
        await expect(page.getByRole("button", { name: /^Stop/ })).toHaveCount(0);

        // --- 3. An author opens the proposal, which delivers it --------------------------------
        const deliverer = await author.newPage();
        await gotoStable(deliverer, proposalPath);
        await expect(dp1Chip(deliverer)).toBeVisible({ timeout: 60_000 });
        // The author's board carries every write control the viewer's must not, by these locators.
        for (const control of boardWriteControls(deliverer)) await expect(control).toBeVisible();
        await deliverer.close();

        // --- 4. The viewer's page, untouched, turns into the board -----------------------------
        await expect(dp1Chip(page)).toBeVisible({ timeout: FLIP_TIMEOUT_MS });
        await expect(page.getByRole("heading", { name: proposalName, level: 1 })).toBeVisible();
        // Read-only: the chip does not drag (dnd-kit mirrors `disabled` onto `aria-disabled`), and the
        // board's write controls are absent while its read controls render.
        await expect(dp1Chip(page)).toHaveAttribute("aria-disabled", "true");
        await expect(page.getByRole("button", { name: "Export plan" })).toBeVisible();
        for (const control of boardWriteControls(page)) await expect(control).toHaveCount(0);
      } finally {
        // Teardown, as the author: the proposal first, because deleting the source while its job row
        // is alive is exactly what `assertNoActiveJob` refuses.
        const cleanup = await author.newPage();
        await deletePlan(cleanup, proposalName);
        await deletePlan(cleanup, plan.name);
      }
    } finally {
      await author.close();
    }
  });
});

/**
 * Generate, undo, the palette's toggle, the shelf and a chip's "⋯" menu (every placed chip carries one,
 * hence `first`): an author's board shows each, a viewer's none.
 */
const boardWriteControls = (page: Page): Locator[] => [
  page.getByRole("button", { name: "Generate plan" }),
  page.getByRole("button", { name: /^Undo/ }),
  page.getByRole("button", { name: /^(Open|Collapse) palette/ }),
  page.getByRole("complementary", { name: "Shelf" }),
  page
    .getByRole("gridcell")
    .getByRole("button", { name: /^Actions for / })
    .first(),
];
