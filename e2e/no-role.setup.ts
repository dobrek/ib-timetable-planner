import path from "node:path";
import { test as setup } from "@playwright/test";
import { noRoleEmail, noRolePassword } from "./no-role-credentials.mjs";
import { signInThroughUi } from "./support/sign-in";

// Sign in once as the provisioned account that never holds a role (S-403, FR-410), for the
// `chromium-no-role` project. Same credentials module as the provisioner, which deletes any role row
// for this account on every run — so this session can only ever be a role-less one.
const authFile = path.join(import.meta.dirname, ".auth/no-role.json");

setup("authenticate without a role", async ({ page }) => {
  await signInThroughUi(page, noRoleEmail, noRolePassword);
  await page.context().storageState({ path: authFile });
});
