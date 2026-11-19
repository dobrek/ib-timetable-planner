#!/usr/bin/env node
// Creates (or rotates) the solver's MACHINE Auth user — the account the CP-SAT container signs in
// as. Its `app_metadata.machine_role` is what the Custom Access Token Hook reads to swap the token's
// `role` claim from `authenticated` to `solver_job_writer`, so the container reaches exactly one
// table (supabase/migrations/…_solver_job_writer_role.sql).
//
// Idempotent, and rotation is the same operation as creation. The create-or-rotate logic is shared
// with provision-notifier-user.mjs (scripts/lib/provision-machine-user.mjs); this script keeps its
// own CLI and environment, which CI and the README call.
//
//   SOLVER_MACHINE_PASSWORD=<strong-password> node scripts/provision-solver-user.mjs
//   SOLVER_MACHINE_EMAIL=solver@ib-timetable-planner.dev SOLVER_MACHINE_PASSWORD=… node …
//
// See docs/runbooks/solver-credential.md for the full credential story.
import { provisionMachineUser } from "./lib/provision-machine-user.mjs";

await provisionMachineUser({
  tag: "provision-solver-user",
  machineRole: "solver_job_writer",
  defaultEmail: "solver@ib-timetable-planner.dev",
  emailVar: "SOLVER_MACHINE_EMAIL",
  passwordVar: "SOLVER_MACHINE_PASSWORD",
  passwordHint:
    "store it in the container's config — it is never committed, and the Worker only carries it to the container.",
});
