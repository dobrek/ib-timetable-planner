import { test } from "@playwright/test";
import { expectUsersPageHidden } from "../support/users";

// Runs in `chromium-viewer` (S-406): a viewer reads every plan, but managing users is an admin's
// only, so the Users page does not exist for them. Read-only: nothing here touches the viewer's
// account (e2e/CLAUDE.md).

test("a viewer has no Users entry, and /users is not found", async ({ page, browser }) => {
  await expectUsersPageHidden(page, browser);
});
