#!/usr/bin/env node
// Gives a human account its one app role, or takes it away: the operator step until S-406 ships a
// Users page. It makes the developer `admin` on hosted, and gives every account created by hand
// (Studio, the hosted dashboard, a local account after `db reset`) the role it needs. Once S-403
// enforces roles, an account without one sees only the "no access yet" notice and its own account.
//
//   node scripts/assign-role.mjs <email> <admin|author|viewer|none>
//   ASSIGN_ROLE_CONFIRM=yes node scripts/assign-role.mjs <email> <role>   # any non-local SUPABASE_URL
//
// `none` deletes the role row; any other role upserts it. A machine account (any
// `app_metadata.machine_role`, such as the solver's) is refused: it must never hold a human role,
// or a misfired token hook would sign it in with that role's access.
//
// It needs the service-role (secret) key, because nobody writes a role through the Data API:
// `user_roles` has no write policy, and `authenticated` holds SELECT alone. On hosted, export
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from your shell, never a committed file; for the local
// stack both fall back to .env.test.local. A non-local host needs ASSIGN_ROLE_CONFIRM=yes, as
// `mise run solver:hosted` needs SOLVER_HOSTED_CONFIRM. Mirrors scripts/provision-solver-user.mjs.
//
// Runs in Node on the host (dev machine or ops shell) — workerd constraints do not apply.
import { createClient } from "@supabase/supabase-js";
import { findUserIdByEmail } from "./lib/find-user-id-by-email.mjs";
import { isLoopbackUrl } from "./lib/is-loopback-url.mjs";
import { loadTestEnvFallback } from "./lib/load-test-env-fallback.mjs";

const ROLES = ["admin", "author", "viewer"];
const NO_ROLE = "none";
const USAGE = `Usage: node scripts/assign-role.mjs <email> <${[...ROLES, NO_ROLE].join("|")}>`;

function fail(message) {
  process.stderr.write(`[assign-role] ${message}\n`);
  process.exit(1);
}

function report(message) {
  process.stderr.write(`[assign-role] ${message}\n`);
}

/** The role `userId` holds now, read back as the service role, or `none`. */
async function roleOf(supabase, userId) {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (error) fail(`Failed to read the role of ${userId}: ${error.message}`);
  return data?.role ?? NO_ROLE;
}

const [email, role] = process.argv.slice(2);
if (!email || !role) fail(USAGE);
if (role !== NO_ROLE && !ROLES.includes(role)) fail(`Unknown role "${role}". ${USAGE}`);

// Zero-config local DX: SUPABASE_URL and the service-role key fall back to .env.test.local.
loadTestEnvFallback();

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  const missing = [!url && "SUPABASE_URL", !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ");
  fail(
    `Missing ${missing}. Export them (or put them in .env.test.local for the local stack). ` +
      `On the hosted project use the project URL and its SECRET key — from your shell, never a committed file.`,
  );
}
if (!URL.canParse(url)) fail(`SUPABASE_URL is not a URL: ${url}`);

const host = new URL(url).host;
report(`Target: ${host}`);
if (!isLoopbackUrl(url) && process.env.ASSIGN_ROLE_CONFIRM !== "yes") {
  fail(`${host} is not the local stack. Re-run with ASSIGN_ROLE_CONFIRM=yes to change a role there.`);
}

const supabase = createClient(url, serviceRoleKey);

const userId = await findUserIdByEmail(supabase, email).catch((error) => fail(error.message));
if (!userId) fail(`No account has the email ${email}.`);

const { data: found, error: userError } = await supabase.auth.admin.getUserById(userId);
if (userError) fail(`Failed to read ${email}: ${userError.message}`);
const machineRole = found.user.app_metadata?.machine_role ?? null;
if (machineRole !== null) {
  fail(`${email} is a machine account (machine_role=${machineRole}), which never holds a human role.`);
}

const before = await roleOf(supabase, userId);
const { error: writeError } =
  role === NO_ROLE
    ? await supabase.from("user_roles").delete().eq("user_id", userId)
    : await supabase.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id" });
if (writeError) fail(`Failed to set ${email} to ${role}: ${writeError.message}`);
const after = await roleOf(supabase, userId);
if (after !== role) fail(`${email} reads back as ${after} after setting ${role}.`);

report(`${email}: ${before} → ${after}`);
process.exit(0);
