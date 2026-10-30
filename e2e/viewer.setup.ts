import path from "node:path";
import { test as setup } from "@playwright/test";
import { viewerEmail, viewerPassword } from "./viewer-credentials.mjs";
import { signInThroughUi } from "./support/sign-in";

// Sign in once as the provisioned viewer (S-405, FR-409), for the `chromium-viewer` project. Same
// credentials module as the provisioner, which re-asserts the `viewer` role for this account on every
// run — so this session can only ever be one that reads and never edits.
const authFile = path.join(import.meta.dirname, ".auth/viewer.json");

setup("authenticate as a viewer", async ({ page }) => {
  await signInThroughUi(page, viewerEmail, viewerPassword);
  await page.context().storageState({ path: authFile });
});
