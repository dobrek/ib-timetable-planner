import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("create and delete plan", async ({ page }) => {
  const planName = `Test Plan ${randomUUID()}`;

  // Go to plans list
  await page.goto("/plans");

  // Click new plan button
  await page.getByRole("button", { name: "New plan" }).click();

  // Create plan

  const createPlanDialog = page.getByRole("dialog");
  await expect(createPlanDialog.getByRole("heading", { name: `New plan` })).toBeVisible();
  await createPlanDialog.getByRole("textbox", { name: "Name" }).click();
  await createPlanDialog.getByRole("textbox", { name: "Name" }).fill(planName);
  await createPlanDialog.getByRole("button", { name: "Create plan" }).click();

  // Check plan is created
  await page.getByRole("link", { name: "Plans" }).click();
  await expect(page.getByRole("link", { name: planName })).toBeVisible();

  // Clean up
  await page.getByRole("button", { name: `Actions for ${planName}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();

  const deletePlanDialog = page.getByRole("alertdialog");
  await expect(deletePlanDialog.getByRole("heading", { name: `Delete ${planName}?` })).toBeVisible();
  await deletePlanDialog.getByRole("button", { name: "Delete" }).click();
});
