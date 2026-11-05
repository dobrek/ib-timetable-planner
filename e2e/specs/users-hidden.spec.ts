import { test } from "@playwright/test";
import { expectUsersPageHidden } from "../support/users";

// Runs in `chromium`, as the provisioned author (S-406): an author edits every plan, but managing
// users is an admin's only, so the Users page does not exist for them.

test("an author has no Users entry, and /users is not found", async ({ page, browser }) => {
  await expectUsersPageHidden(page, browser);
});
