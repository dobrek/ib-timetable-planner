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
import { createClient } from "@supabase/supabase-js";
import { findUserIdByEmail } from "./lib/find-user-id-by-email.mjs";
import { loadTestEnvFallback } from "./lib/load-test-env-fallback.mjs";

const MACHINE_ROLE = "solver_job_writer";
const DEFAULT_EMAIL = "solver@ib-timetable-planner.dev";

function fail(message) {
  process.stderr.write(`[provision-solver-user] ${message}\n`);
  process.exit(1);
}

// Zero-config local DX: SUPABASE_URL and the service-role key fall back to .env.test.local.
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

const userId = await findUserIdByEmail(supabase, email).catch((error) => fail(error.message));
if (!userId) fail(`${email} reports as existing but could not be found — resolve it in the dashboard.`);

const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
  password,
  app_metadata: { machine_role: MACHINE_ROLE },
});
if (updateError) fail(`Failed to rotate ${email}: ${updateError.message}`);

// A machine user never holds a human role (S-403). An existing account turned into one here drops any
// role row it held as a human, so a misfiring token hook leaves it no data rather than its old access.
const { data: dropped, error: roleError } = await supabase
  .from("user_roles")
  .delete()
  .eq("user_id", userId)
  .select("role");
if (roleError) fail(`Failed to clear ${email}'s human role: ${roleError.message}`);
const cleared = dropped.length > 0 ? `; human role ${dropped[0].role} removed` : "";

process.stderr.write(`[provision-solver-user] Rotated ${email} (password + machine_role re-asserted${cleared}).\n`);
process.exit(0);
