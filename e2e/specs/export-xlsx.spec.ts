import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { clickToReveal, createPlan, deletePlan } from "../support/planner";

// End-to-end guard for the export wiring: an authenticated author opens a plan, triggers
// Export → Combined, and a real `.xlsx` download fires with the plan-derived filename. Content
// fidelity (headers, fills, spans, rosters) is the transform's unit-test territory
// (`timetable-sheet.test.ts` / `roster-sheet.test.ts`); here we only prove the download happens
// and produces a real workbook byte stream.

/** Mirrors `exportFileName` (unit-tested in `export-file-name.test.ts`) — kept inline so the spec
 *  takes no cross-boundary import into `src/`. */
const expectedFileName = (planName: string, view: string): string => {
  const slug =
    planName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "plan";
  return `${slug}-${view}.xlsx`;
};

test.describe("export to xlsx", () => {
  test("Export → Combined downloads a non-empty .xlsx named for the plan", async ({ page }) => {
    // Combined is the default surface, and its toolbar (Export menu included) renders even on a
    // brand-new empty plan — no groupings/placements needed to exercise the download.
    const plan = await createPlan(page, "export");
    try {
      const combinedItem = page.getByRole("menuitem", { name: "Combined (current)" });
      // Open the dropdown, surviving the cold-start hydration race (retried click until the item shows).
      await clickToReveal(page.getByRole("button", { name: "Export plan" }), combinedItem);

      const [download] = await Promise.all([page.waitForEvent("download"), combinedItem.click()]);

      expect(download.suggestedFilename()).toBe(expectedFileName(plan.name, "combined"));
      const path = await download.path();
      if (!path) throw new Error("download produced no local path");
      const bytes = readFileSync(path);
      expect(bytes.length).toBeGreaterThan(0);
      // A real .xlsx is a ZIP container — its first two bytes are the "PK" local-file signature.
      expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    } finally {
      await deletePlan(page, plan.name);
    }
  });
});
