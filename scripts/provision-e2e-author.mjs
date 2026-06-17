#!/usr/bin/env node
// Provisions the e2e author programmatically so `pnpm test:e2e` can sign in.
// Runs automatically via the `pretest:e2e` hook (locally and in CI). Idempotent:
// a re-run against an existing author is a success, not an error.
//
// The app has no self-service signup (`enable_signup = false`); the admin API
// (`auth.admin.createUser`) bypasses that gate. Locally `enable_confirmations =
// false`, so `email_confirm: true` makes the user immediately sign-in-ready.
//
// Runs in Node on the host (CI runner or dev machine) — workerd constraints do
// not apply, so `@supabase/supabase-js` + `node:fs` are fine.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { authorEmail, authorPassword } from "../e2e/author-credentials.mjs";

// Zero-config local DX: if the service-role key / URL aren't already exported
// (CI exports them via `supabase status`), fall back to parsing `.env.test.local`
// — the same file the integration lane's load-test-env.ts reads.
function loadTestEnvFallback() {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.test.local"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No local test env — the absence check below surfaces a clear error.
  }
}

loadTestEnvFallback();

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  const missing = [!url && "SUPABASE_URL", !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ");
  process.stderr.write(
    `[provision-e2e-author] Missing ${missing}. Start the local Supabase stack and ensure ` +
      `.env.test.local has SUPABASE_SERVICE_ROLE_KEY (or export the vars, as CI does).\n`,
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey);

const { error } = await supabase.auth.admin.createUser({
  email: authorEmail,
  password: authorPassword,
  email_confirm: true,
});

if (error) {
  // Idempotent: an already-registered author is the steady state, not a failure.
  const alreadyExists = error.code === "email_exists" || /already.*registered|already.*exists/i.test(error.message);
  if (alreadyExists) {
    process.stderr.write(`[provision-e2e-author] Author ${authorEmail} already exists — ok.\n`);
    process.exit(0);
  }
  process.stderr.write(`[provision-e2e-author] Failed to create author: ${error.message}\n`);
  process.exit(1);
}

process.stderr.write(`[provision-e2e-author] Created author ${authorEmail}.\n`);
process.exit(0);
