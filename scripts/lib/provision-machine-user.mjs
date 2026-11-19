// Creates (or rotates) a MACHINE Auth user, for the operator scripts that provision one:
// provision-solver-user (the CP-SAT container, `solver_job_writer`) and provision-notifier-user (the
// job-email cron, `job_notifier`). Its `app_metadata.machine_role` is what the Custom Access Token
// Hook reads to swap the token's `role` claim from `authenticated` to that narrow Postgres role.
//
// `app_metadata` is writable ONLY through the service-role admin API — never by the user, never
// through a session. That is precisely why the hook can trust it, and why these scripts need the
// service-role key while the machine principal never sees one.
//
// Idempotent, and rotation is the same operation as creation: re-running with a new password
// updates the existing user in place (and re-asserts `machine_role`, so a user whose metadata was
// tampered with is repaired). It also drops any human role row the account held: a machine user never
// holds one (S-403), so a misfiring token hook leaves it no data rather than its old access.
//
// Runs in Node on the host (dev machine or ops shell) — workerd constraints do not apply. It reports
// through stderr and exits the process, as each script would on its own.
import { createClient } from "@supabase/supabase-js";
import { findUserIdByEmail } from "./find-user-id-by-email.mjs";
import { loadTestEnvFallback } from "./load-test-env-fallback.mjs";

/**
 * Provision the machine user one script names, then exit.
 *
 * @param {object} options
 * @param {string} options.tag the script's name, prefixed to every line it prints
 * @param {string} options.machineRole the exact value the token hook maps
 * @param {string} options.defaultEmail used when `emailVar` is unset
 * @param {string} options.emailVar the environment variable that overrides the email
 * @param {string} options.passwordVar the environment variable holding the password
 * @param {string} options.passwordHint where the password goes once set, for the missing-password error
 * @returns {Promise<never>}
 */
export async function provisionMachineUser({ tag, machineRole, defaultEmail, emailVar, passwordVar, passwordHint }) {
  const fail = (message) => {
    process.stderr.write(`[${tag}] ${message}\n`);
    process.exit(1);
  };

  // Zero-config local DX: SUPABASE_URL and the service-role key fall back to .env.test.local.
  loadTestEnvFallback();

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env[emailVar] ?? defaultEmail;
  const password = process.env[passwordVar];

  if (!url || !serviceRoleKey) {
    const missing = [!url && "SUPABASE_URL", !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ");
    fail(
      `Missing ${missing}. Export them (or put them in .env.test.local for the local stack). ` +
        `On the hosted project use the project URL and its SECRET key — from your shell, never a committed file.`,
    );
  }

  if (!password) fail(`Missing ${passwordVar}. Generate a strong one, pass it in the environment, and ${passwordHint}`);

  const supabase = createClient(url, serviceRoleKey);
  const attributes = { email, password, email_confirm: true, app_metadata: { machine_role: machineRole } };

  const created = await supabase.auth.admin.createUser(attributes);

  if (!created.error) {
    process.stderr.write(`[${tag}] Created ${email} with machine_role=${machineRole}.\n`);
    process.exit(0);
  }

  // GoTrue's stable `email_exists` code is the contract — never match on message text.
  if (created.error.code !== "email_exists") fail(`Failed to create ${email}: ${created.error.message}`);

  const userId = await findUserIdByEmail(supabase, email).catch((error) => fail(error.message));
  if (!userId) fail(`${email} reports as existing but could not be found — resolve it in the dashboard.`);

  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    password,
    app_metadata: { machine_role: machineRole },
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

  process.stderr.write(`[${tag}] Rotated ${email} (password + machine_role re-asserted${cleared}).\n`);
  process.exit(0);
}
