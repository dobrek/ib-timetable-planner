#!/usr/bin/env node
// Creates (or rotates) the solver's MACHINE Auth user — the account the CP-SAT container signs in
// as. Its `app_metadata.machine_role` is what the Custom Access Token Hook reads to swap the token's
// `role` claim from `authenticated` to `solver_job_writer`, so the container reaches exactly one
// table (supabase/migrations/…_solver_job_writer_role.sql).
//
// `app_metadata` is writable ONLY through the service-role admin API — never by the user, never
// through a session. That is precisely why the hook can trust it, and why this script needs the
// service-role key while the container never sees one.
//
// Idempotent, and rotation is the same operation as creation: re-running with a new password
// updates the existing user in place (and re-asserts `machine_role`, so a user whose metadata was
// tampered with is repaired). Mirrors scripts/provision-e2e-author.mjs.
//
// Runs in Node on the host (dev machine or ops shell) — workerd constraints do not apply.
//
//   SOLVER_MACHINE_PASSWORD=<strong-password> node scripts/provision-solver-user.mjs
//   SOLVER_MACHINE_EMAIL=solver@ib-timetable-planner.dev SOLVER_MACHINE_PASSWORD=… node …
//
// See docs/runbooks/solver-credential.md for the full credential story.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const MACHINE_ROLE = "solver_job_writer";
const DEFAULT_EMAIL = "solver@ib-timetable-planner.dev";

// Zero-config local DX: if the service-role key / URL aren't exported, fall back to parsing
// .env.test.local — the same file the integration lane's load-test-env.ts reads.
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

function fail(message) {
  process.stderr.write(`[provision-solver-user] ${message}\n`);
  process.exit(1);
}

/** Page through the admin user list to resolve an email to its id. */
async function findUserIdByEmail(supabase, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`Failed to list users: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

loadTestEnvFallback();

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SOLVER_MACHINE_EMAIL ?? DEFAULT_EMAIL;
const password = process.env.SOLVER_MACHINE_PASSWORD;

if (!url || !serviceRoleKey) {
  const missing = [!url && "SUPABASE_URL", !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ");
  fail(
    `Missing ${missing}. Export them (or put them in .env.test.local for the local stack). ` +
      `On the hosted project use the project URL and its SECRET key — from your shell, never a committed file.`,
  );
}

if (!password) {
  fail(
    "Missing SOLVER_MACHINE_PASSWORD. Generate a strong one, pass it in the environment, and store it " +
      "in the container's config — it is never committed and never reaches the Worker.",
  );
}

const supabase = createClient(url, serviceRoleKey);
const attributes = { email, password, email_confirm: true, app_metadata: { machine_role: MACHINE_ROLE } };

const created = await supabase.auth.admin.createUser(attributes);

if (!created.error) {
  process.stderr.write(`[provision-solver-user] Created ${email} with machine_role=${MACHINE_ROLE}.\n`);
  process.exit(0);
}

// GoTrue's stable `email_exists` code is the contract — never match on message text.
if (created.error.code !== "email_exists") {
  fail(`Failed to create ${email}: ${created.error.message}`);
}

const userId = await findUserIdByEmail(supabase, email);
if (!userId) fail(`${email} reports as existing but could not be found — resolve it in the dashboard.`);

const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
  password,
  app_metadata: { machine_role: MACHINE_ROLE },
});
if (updateError) fail(`Failed to rotate ${email}: ${updateError.message}`);

process.stderr.write(`[provision-solver-user] Rotated ${email} (password + machine_role re-asserted).\n`);
process.exit(0);
