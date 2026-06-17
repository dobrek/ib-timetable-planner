// Single source of truth for the e2e author's credentials, imported by BOTH the
// Node provisioning script (scripts/provision-e2e-author.mjs) and the Playwright
// setup spec (e2e/auth.setup.ts) — so the account that gets provisioned and the
// account that signs in are always the same one. A plain .mjs so the Node script
// and the TypeScript spec can each import it without a transpile step.
//
// Env overrides exist for CI flexibility, but the fixed local defaults make the
// default dev loop zero-config (the local stack is ephemeral, so a hardcoded
// credential is low-risk and there is no secret to rotate).
export const authorEmail = process.env.E2E_AUTHOR_EMAIL ?? "e2e-author@example.test";
export const authorPassword = process.env.E2E_AUTHOR_PASSWORD ?? "e2e-author-password";
