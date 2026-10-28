// Single source of truth for the e2e account that never holds a role (S-403, FR-410), imported by
// BOTH the provisioning script (scripts/provision-e2e-author.mjs) and the Playwright setup
// (e2e/no-role.setup.ts) — the same pattern as author-credentials.mjs, beside it.
//
// Fixed, with no env override: the provisioner deletes any role row for exactly this address on every
// run, so the `chromium-no-role` project can only ever sign in as a role-less user. The password is a
// public literal, so the account exists on the local stack only (the provisioner is loopback-only).
export const noRoleEmail = "e2e-no-role@example.test";
export const noRolePassword = "e2e-no-role-password";
