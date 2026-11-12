#!/usr/bin/env node
// Gives a human account its one app role, or takes it away: the operator's path. Since S-406 an admin
// does this from the Users page (/users); the script stays for bootstrap and recovery: the first
// admin of a fresh stack (a local account after `db reset`), or a school whose admins cannot sign
// in. An account without a role sees only the "no access yet" notice and its own account.
//
//   node scripts/assign-role.mjs <email> <admin|author|viewer|none>
//   ASSIGN_ROLE_CONFIRM=yes node scripts/assign-role.mjs <email> <role>   # any non-local SUPABASE_URL
//
// `none` deletes the role row; any other role upserts it. A machine account (any
// `app_metadata.machine_role`, such as the solver's) is refused: it must never hold a human role,
// or a misfired token hook would sign it in with that role's access.
//
// A role write also REACTIVATES a deactivated person (S-408), unlike the Users page, where changing
// a deactivated person's role keeps them deactivated. The script's purpose is "give this person this
// access now", so it must never report success while they stay locked out: it clears
// `deactivated_at` in the same upsert, reads both back, and prints `(reactivated)`. The record shows
// the Operator's `reactivated`, after a `role_changed` when the role differs too. `none` deletes the
// row, flag included, as a removal from the page does.
//
// It needs the service-role (secret) key, because it writes outside any session: RLS lets only an
// admin's own session write `user_roles`. Its writes are recorded in `access_changes` as the
// "Operator". The last-admin guard binds it too: demoting the school's last admin, or setting them
// to `none`, is refused (SQLSTATE PT409), so promote another admin first. On hosted, export
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
/** The SQLSTATE the last-admin guard raises (20261105080343_role_management.sql). */
const LAST_ADMIN = "PT409";
const USAGE = `Usage: node scripts/assign-role.mjs <email> <${[...ROLES, NO_ROLE].join("|")}>`;

function fail(message) {
  process.stderr.write(`[assign-role] ${message}\n`);
  process.exit(1);
}

function report(message) {
  process.stderr.write(`[assign-role] ${message}\n`);
}

/** The role `userId` holds now, and whether it is deactivated, read back as the service role. */
async function roleOf(supabase, userId) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role, deactivated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) fail(`Failed to read the role of ${userId}: ${error.message}`);
  return { role: data?.role ?? NO_ROLE, deactivated: Boolean(data?.deactivated_at) };
}

/** How the report names a role: `author`, `author (deactivated)` or `none`. */
function describeRole({ role, deactivated }) {
  return deactivated ? `${role} (deactivated)` : role;
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
    : await supabase
        .from("user_roles")
        .upsert({ user_id: userId, role, deactivated_at: null }, { onConflict: "user_id" });
if (writeError?.code === LAST_ADMIN) {
  fail(
    `refused: the school must keep at least one admin — promote another admin first ` +
      `(${email} stays ${describeRole(before)}).`,
  );
}
if (writeError) fail(`Failed to set ${email} to ${role}: ${writeError.message}`);
const after = await roleOf(supabase, userId);
if (after.role !== role || after.deactivated) {
  fail(`${email} reads back as ${describeRole(after)} after setting ${role}.`);
}

const reactivated = before.deactivated && role !== NO_ROLE ? " (reactivated)" : "";
report(`${email}: ${describeRole(before)} → ${describeRole(after)}${reactivated}`);
process.exit(0);
