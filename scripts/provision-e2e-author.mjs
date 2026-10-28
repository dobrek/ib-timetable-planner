#!/usr/bin/env node
// Provisions the e2e author programmatically so `pnpm test:e2e` can sign in, and gives it the
// `author` role. Runs automatically via the `pretest:e2e` hook (locally and in CI). Idempotent:
// a re-run against an existing author is a success, not an error, and re-asserts the role.
//
// The app has no self-service signup (`enable_signup = false`); the admin API
// (`auth.admin.createUser`) bypasses that gate. Locally `enable_confirmations =
// false`, so `email_confirm: true` makes the user immediately sign-in-ready.
//
// The role is assigned here because the author is created after the migrations ran, so S-403's
// backfill never sees it. It is upserted on both paths, created and `email_exists`, so a stack
// whose author predates the role still gets one.
//
// Loopback only. The author's password is a public literal (e2e/author-credentials.mjs), and the
// role gives it data access, so any non-local SUPABASE_URL is refused before a request is sent: a
// mis-pointed URL must never mint a hosted account that anyone can sign in as.
//
// Runs in Node on the host (CI runner or dev machine) — workerd constraints do
// not apply, so `@supabase/supabase-js` + `node:fs` are fine.
import { createClient } from "@supabase/supabase-js";
import { authorEmail, authorPassword } from "../e2e/author-credentials.mjs";
import { findUserIdByEmail } from "./lib/find-user-id-by-email.mjs";
import { isLoopbackUrl } from "./lib/is-loopback-url.mjs";
import { loadTestEnvFallback } from "./lib/load-test-env-fallback.mjs";

const ROLE = "author";

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
  fail(`Refusing ${url}: the e2e author's password is a public literal, so it exists on the local stack only.`);
}

const supabase = createClient(url, serviceRoleKey);

const created = await supabase.auth.admin.createUser({
  email: authorEmail,
  password: authorPassword,
  email_confirm: true,
});

// Idempotent: an already-registered author is the steady state, not a failure.
// GoTrue's stable `email_exists` code is the contract — don't match on message text.
if (created.error && created.error.code !== "email_exists") {
  fail(`Failed to create author: ${created.error.message}`);
}

const userId = created.error
  ? await findUserIdByEmail(supabase, authorEmail).catch((error) => fail(error.message))
  : created.data.user.id;
if (!userId) fail(`Author ${authorEmail} reports as existing but could not be found.`);

const { error: roleError } = await supabase
  .from("user_roles")
  .upsert({ user_id: userId, role: ROLE }, { onConflict: "user_id" });
if (roleError) fail(`Failed to give ${authorEmail} the ${ROLE} role: ${roleError.message}`);

const outcome = created.error ? "already exists" : "created";
process.stderr.write(`[provision-e2e-author] Author ${authorEmail} ${outcome}; holds ${ROLE}.\n`);
process.exit(0);
