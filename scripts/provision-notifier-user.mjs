#!/usr/bin/env node
// Creates (or rotates) the job-email notifier's MACHINE Auth user — the account the Worker's cron
// signs in as (S-310). Its `app_metadata.machine_role` is what the Custom Access Token Hook reads to
// swap the token's `role` claim from `authenticated` to `job_notifier`, so the cron reaches only the
// job-email columns and rows (supabase/migrations/…_job_completion_email.sql).
//
// Idempotent, and rotation is the same operation as creation (scripts/lib/provision-machine-user.mjs,
// shared with provision-solver-user.mjs). The password must be at least 15 characters, the Auth
// floor locally and on hosted; GoTrue refuses a shorter one.
//
//   NOTIFIER_MACHINE_PASSWORD=<strong-password> node scripts/provision-notifier-user.mjs
//   NOTIFIER_MACHINE_EMAIL=notifier@ib-timetable-planner.dev NOTIFIER_MACHINE_PASSWORD=… node …
//
// See docs/runbooks/job-email.md for the notifier's whole operational story.
import { provisionMachineUser } from "./lib/provision-machine-user.mjs";

await provisionMachineUser({
  tag: "provision-notifier-user",
  machineRole: "job_notifier",
  defaultEmail: "notifier@ib-timetable-planner.dev",
  emailVar: "NOTIFIER_MACHINE_EMAIL",
  passwordVar: "NOTIFIER_MACHINE_PASSWORD",
  passwordHint:
    "store it as the Worker secret NOTIFIER_MACHINE_PASSWORD (`wrangler secret put`) — it is never committed.",
});
