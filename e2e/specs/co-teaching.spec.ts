import { test, expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Co-teaching teacher sets — browser-level coverage (plan Phase 7).
//
// Risks protected (context/foundation/test-plan.md, PRD S-02 co-teaching):
//   1. The co-teaching authoring round-trip — a course authored with a *set* of
//      teachers must render every co-teacher as a chip and survive a real SSR
//      reload (the junction write + junction-sourced read across auth→action→DB→UI).
//   2. The sole-teacher delete-guard — deleting the only teacher of a course would
//      orphan it to zero teachers; the app-enforced ≥1 invariant must block that at
//      the UI and name the orphaned course, while a co-teacher deletion still drops
//      the link.
//
// Authenticated `chromium` project (reuses storageState from auth.setup). Modeled on
// e2e/specs/seed.spec.ts; conventions in e2e/CLAUDE.md. Each test owns a uniquely
// named plan and tears it down by deleting the plan (cascades to every child entity).

test.describe("co-teaching teacher sets", () => {
  // These flows build state across several pages (plan → teachers → course → guard),
  // so they need more than the 30s default.
  test.describe.configure({ timeout: 90_000 });

  test("co-taught course renders teacher chips and persists the set across reload and edit", async ({ page }) => {
    const plan = await createPlan(page);
    const teacherA = `TA-${shortId()}`;
    const teacherB = `TB-${shortId()}`;
    const courseName = `Co-taught ${shortId()}`;

    // Two teachers exist in the plan…
    await createTeacher(page, plan.id, teacherA);
    await createTeacher(page, plan.id, teacherB);

    // …and a course is authored co-taught by both, via the multi-select.
    const row = await createCourse(page, plan.id, { name: courseName, hours: "2", teacherCodes: [teacherA, teacherB] });

    // Both co-teachers render as chips in the table.
    await expect(row.getByText(teacherA, { exact: true })).toBeVisible();
    await expect(row.getByText(teacherB, { exact: true })).toBeVisible();

    // The teacher set survives a real SSR reload (junction persistence, not just in-memory).
    await page.reload();
    const reloaded = courseRow(page, courseName);
    await expect(reloaded.getByText(teacherA, { exact: true })).toBeVisible();
    await expect(reloaded.getByText(teacherB, { exact: true })).toBeVisible();

    // Editing the course to drop one co-teacher persists the smaller set.
    await clickToReveal(reloaded.getByRole("button", { name: "Course actions" }), page.getByRole("menuitem"));
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog.getByRole("heading", { name: "Edit course" })).toBeVisible();
    await editDialog.getByRole("button", { name: `Remove ${teacherB}` }).click();
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).toBeHidden();

    const edited = courseRow(page, courseName);
    await expect(edited.getByText(teacherA, { exact: true })).toBeVisible();
    await expect(edited.getByText(teacherB, { exact: true })).toHaveCount(0);

    await deletePlan(page, plan.name);
  });

  test("deleting a sole teacher is blocked and names the orphaned course; a co-teacher deletes cleanly", async ({
    page,
  }) => {
    const plan = await createPlan(page);
    const soleTeacher = `TA-${shortId()}`;
    const coTeacher = `TB-${shortId()}`;
    const courseName = `Solo ${shortId()}`;

    await createTeacher(page, plan.id, soleTeacher);
    await createTeacher(page, plan.id, coTeacher);
    // A course taught by `soleTeacher` ONLY.
    await createCourse(page, plan.id, { name: courseName, hours: "2", teacherCodes: [soleTeacher] });

    // Confirming deletion of the sole teacher is blocked, and the guard names the orphaned course.
    await confirmTeacherDelete(page, plan.id, soleTeacher);
    const blockedToast = page.getByText(/Only teacher on 1 course/);
    await expect(blockedToast).toBeVisible();
    await expect(blockedToast).toContainText(courseName);
    // The guard blocked: the confirm dialog stays open and the teacher is still listed.
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
    await expect(teacherRow(page, soleTeacher)).toBeVisible();

    // Add a co-teacher so the course no longer depends solely on `soleTeacher`.
    await page.goto(`/plans/${plan.id}/courses`);
    await clickToReveal(
      courseRow(page, courseName).getByRole("button", { name: "Course actions" }),
      page.getByRole("menuitem"),
    );
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog.getByRole("heading", { name: "Edit course" })).toBeVisible();
    await editDialog.getByRole("button", { name: "1 selected" }).click();
    await page.getByRole("option", { name: coTeacher, exact: true }).click();
    await page.keyboard.press("Escape");
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).toBeHidden();

    // Now `soleTeacher` is one of two co-teachers — deleting it just drops the link, leaving the row gone.
    await confirmTeacherDelete(page, plan.id, soleTeacher);
    await expect(teacherRow(page, soleTeacher)).toHaveCount(0);

    await deletePlan(page, plan.name);
  });
});

/** Short unique suffix for collision-free parallel test data. */
const shortId = () => randomUUID().slice(0, 8);

/** A table row located by the text it contains (the header row never matches entity text). */
const courseRow = (page: Page, name: string): Locator => page.getByRole("row").filter({ hasText: name });
const teacherRow = (page: Page, code: string): Locator => page.getByRole("row").filter({ hasText: code });

/**
 * Click `opener` until `revealed` appears. Survives the cold-start hydration race: an Astro
 * `client:load` island renders its trigger via SSR, so the button is clickable *before* React
 * attaches the handler — a too-early click is silently dropped. Retrying the click (the same
 * idiom as auth.setup.ts) is deterministic where a bare click is timing-dependent.
 */
async function clickToReveal(opener: Locator, revealed: Locator): Promise<void> {
  await expect(async () => {
    await opener.click();
    await expect(revealed.first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** Create a uniquely named plan; returns its id (from the board URL) and name (for teardown). */
async function createPlan(page: Page): Promise<{ id: string; name: string }> {
  const name = `E2E co-teaching ${randomUUID()}`;
  await page.goto("/plans");
  const dialog = page.getByRole("dialog");
  await clickToReveal(
    page.getByRole("button", { name: "New plan" }),
    dialog.getByRole("heading", { name: "New plan" }),
  );
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await dialog.getByRole("button", { name: "Create plan" }).click();
  // Creating a plan navigates into its (empty) board at /plans/<uuid>.
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/);
  return { id: new URL(page.url()).pathname.split("/")[2], name };
}

/** Add a teacher (code only → its display label is the code) and confirm the row landed. */
async function createTeacher(page: Page, planId: string, code: string): Promise<void> {
  await page.goto(`/plans/${planId}/teachers`);
  const dialog = page.getByRole("dialog");
  // On an empty plan the header and the empty-state both offer "New teacher"; the header is first.
  await clickToReveal(
    page.getByRole("button", { name: "New teacher" }).first(),
    dialog.getByRole("heading", { name: "New teacher" }),
  );
  await dialog.getByLabel("Code").fill(code);
  await dialog.getByRole("button", { name: "Create teacher" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("cell", { name: code, exact: true })).toBeVisible();
}

/** Author a course co-taught by `teacherCodes` via the multi-select; returns its table row. */
async function createCourse(
  page: Page,
  planId: string,
  { name, hours, teacherCodes }: { name: string; hours: string; teacherCodes: string[] },
): Promise<Locator> {
  await page.goto(`/plans/${planId}/courses`);
  const dialog = page.getByRole("dialog");
  await clickToReveal(
    page.getByRole("button", { name: "New course" }),
    dialog.getByRole("heading", { name: "New course" }),
  );
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Weekly hours").fill(hours);

  // The teacher multi-select is a portalled popover (its options live outside the dialog
  // subtree). It is `modal`, so the option list must be dismissed before the footer is
  // interactive again — Escape closes the popover only, leaving the dialog open.
  await dialog.getByRole("button", { name: "Select teachers…" }).click();
  for (const code of teacherCodes) {
    await page.getByRole("option", { name: code, exact: true }).click();
  }
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("button", { name: `${teacherCodes.length} selected` })).toBeVisible();

  await dialog.getByRole("button", { name: "Create course" }).click();
  await expect(dialog).toBeHidden();
  const row = courseRow(page, name);
  await expect(row).toBeVisible();
  return row;
}

/** Open the teacher's confirm-delete dialog and click its Delete button (the actual attempt). */
async function confirmTeacherDelete(page: Page, planId: string, code: string): Promise<void> {
  await page.goto(`/plans/${planId}/teachers`);
  await clickToReveal(
    teacherRow(page, code).getByRole("button", { name: "Teacher actions" }),
    page.getByRole("menuitem"),
  );
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: `Delete ${code}?` })).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();
}

/** Tear down: deleting the plan cascades to its courses, teachers, and junction rows. */
async function deletePlan(page: Page, planName: string): Promise<void> {
  await page.goto("/plans");
  await clickToReveal(page.getByRole("button", { name: `Actions for ${planName}` }), page.getByRole("menuitem"));
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: `Delete ${planName}?` })).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: planName })).toHaveCount(0);
}
