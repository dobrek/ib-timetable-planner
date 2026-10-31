// Single source of truth for the e2e account that holds the `viewer` role (S-405, FR-409), imported by
// BOTH the provisioning script (scripts/provision-e2e-author.mjs) and the Playwright setup
// (e2e/viewer.setup.ts) — the same pattern as no-role-credentials.mjs, beside it.
//
// Fixed, with no env override: the provisioner re-asserts `viewer` for exactly this address on every
// run, so the `chromium-viewer` project can only ever sign in as a user who reads and never edits. The
// password is a public literal, so the account exists on the local stack only (the provisioner is
// loopback-only).
export const viewerEmail = "e2e-viewer@example.test";
export const viewerPassword = "e2e-viewer-password";
