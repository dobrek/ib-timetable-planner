// Single source of truth for the e2e account that holds the `admin` role (S-406, FR-405), imported by
// BOTH the provisioning script (scripts/provision-e2e-author.mjs) and the Playwright setup
// (e2e/admin.setup.ts) — the same pattern as viewer-credentials.mjs, beside it.
//
// Fixed, with no env override: the provisioner re-asserts `admin` for exactly this address on every
// run. The password is a public literal, so the account exists on the local stack only (the
// provisioner is loopback-only). No spec changes this account's role, password or session: an admin
// spec changes the role of a throwaway user it creates (e2e/CLAUDE.md).
export const adminEmail = "e2e-admin@example.test";
export const adminPassword = "e2e-admin-password";
