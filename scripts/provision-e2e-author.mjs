#!/usr/bin/env node
// Provisions the e2e accounts programmatically so `pnpm test:e2e` can sign in as them: the author,
// which holds the `author` role, and the no-role account, which holds none (S-403, FR-410). Runs
// automatically via the `pretest:e2e` hook (locally and in CI). Idempotent: a re-run against an
// existing account is a success, not an error, and re-asserts its role.
//
// The app has no self-service signup (`enable_signup = false`); the admin API
// (`auth.admin.createUser`) bypasses that gate. Locally `enable_confirmations =
// false`, so `email_confirm: true` makes the user immediately sign-in-ready.
//
// Roles are set here because both accounts are created after the migrations ran, so S-403's
// backfill never sees them. Both paths, created and `email_exists`, set the role, so a stack whose
// author predates the role still gets one. The no-role account's role row is DELETED on every run:
// a stale grant must never let `no-access.no-role.spec.ts` pass as someone with access.
//
// Loopback only. Both passwords are public literals (e2e/author-credentials.mjs,
// e2e/no-role-credentials.mjs), and the author role gives data access, so any non-local
// SUPABASE_URL is refused before a request is sent: a mis-pointed URL must never mint a hosted
// account that anyone can sign in as.
//
// Runs in Node on the host (CI runner or dev machine) — workerd constraints do
// not apply, so `@supabase/supabase-js` + `node:fs` are fine.
import { createClient } from "@supabase/supabase-js";
import { authorEmail, authorPassword } from "../e2e/author-credentials.mjs";
import { noRoleEmail, noRolePassword } from "../e2e/no-role-credentials.mjs";
import { findUserIdByEmail } from "./lib/find-user-id-by-email.mjs";
import { isLoopbackUrl } from "./lib/is-loopback-url.mjs";
import { loadTestEnvFallback } from "./lib/load-test-env-fallback.mjs";

// `role: null` means the account must hold no role at all.
const ACCOUNTS = [
  { email: authorEmail, password: authorPassword, role: "author" },
  { email: noRoleEmail, password: noRolePassword, role: null },
];

function fail(message) {
  process.stderr.write(`[provision-e2e-author] ${message}\n`);
  process.exit(1);
}

// Zero-config local DX: SUPABASE_URL and the service-role key fall back to .env.test.local.
loadTestEnvFallback();

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  const missing = [!url && "SUPABASE_URL", !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ");
  fail(
    `Missing ${missing}. Start the local Supabase stack and ensure ` +
      `.env.test.local has SUPABASE_SERVICE_ROLE_KEY (or export the vars, as CI does).`,
  );
}

if (!isLoopbackUrl(url)) {
  fail(`Refusing ${url}: the e2e accounts' passwords are public literals, so they exist on the local stack only.`);
}

const supabase = createClient(url, serviceRoleKey);

for (const account of ACCOUNTS) {
  const { userId, outcome } = await ensureUser(account);
  await setRole(userId, account);
  const holds = account.role ?? "no role";
  process.stderr.write(`[provision-e2e-author] ${account.email} ${outcome}; holds ${holds}.\n`);
}
process.exit(0);

/** Create the account, or find it when it already exists, and return its id. */
async function ensureUser({ email, password }) {
  const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });

  // Idempotent: an already-registered account is the steady state, not a failure.
  // GoTrue's stable `email_exists` code is the contract — don't match on message text.
  if (created.error && created.error.code !== "email_exists") {
    fail(`Failed to create ${email}: ${created.error.message}`);
  }

  const userId = created.error
    ? await findUserIdByEmail(supabase, email).catch((error) => fail(error.message))
    : created.data.user.id;
  if (!userId) fail(`${email} reports as existing but could not be found.`);
  return { userId, outcome: created.error ? "already exists" : "created" };
}

/** Upsert the account's role, or delete any role row when it must hold none. */
async function setRole(userId, { email, role }) {
  const { error } = role
    ? await supabase.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id" })
    : await supabase.from("user_roles").delete().eq("user_id", userId);
  if (error) fail(`Failed to set ${email}'s role to ${role ?? "none"}: ${error.message}`);
}
