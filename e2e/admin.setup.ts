import path from "node:path";
import { test as setup } from "@playwright/test";
import { adminEmail, adminPassword } from "./admin-credentials.mjs";
import { signInThroughUi } from "./support/sign-in";

// Sign in once as the provisioned admin (S-406, FR-405), for the `chromium-admin` project, and for the
// other projects' specs that pair an absence with the admin's presence. Same credentials module as the
// provisioner, which re-asserts the `admin` role for this account on every run.
const authFile = path.join(import.meta.dirname, ".auth/admin.json");

setup("authenticate as an admin", async ({ page }) => {
  await signInThroughUi(page, adminEmail, adminPassword);
  await page.context().storageState({ path: authFile });
});
