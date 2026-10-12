# Signed-in Client per Role for the Integration Lane — Plan Brief

> Full plan: `context/changes/give-integration-lane-a-signed-in-client-per-role/plan.md`
> Research: `context/changes/give-integration-lane-a-signed-in-client-per-role/research.md`

## What & Why

F-401 (#155) builds the harness half of health-check Fix 1:

- a factory that signs a real human user in with the publishable key;
- a role-matrix suite that pins today's access posture in a typed expectation table.

No test can fail today when a human role has *too much* access, and S-403's fail-closed rewrite is
exactly the removal of excess access. Landing the harness first lets S-403's expectation flip
(red, then green) prove that the suite can fail, without ever turning `main` red.

## Starting Point

Every integration suite runs as `service_role` (BYPASSRLS). The only signed-in suite signs in as the
solver's machine user.

Live posture: 16 `public` tables, each with an `ALL to authenticated using (true)` policy. `anon` is
denied DML on every table, but holds four auto-granted non-DML privileges on 15 of them.
`teardown` knows only plans. The pieces exist: `readPublishableKey`, `heldPrivileges`, the
create → sign in → delete pattern, and factories for nearly every table.

## Desired End State

`createSignedInUser(admin)` returns a signed-in client that `teardown` cleans up, deleting plans and
then users. `role-matrix.integration.test.ts` runs:

- a read on all 16 tables;
- INSERT, UPDATE and DELETE on five representative tables;
- `clone_plan`;
- an exact grant and RLS check on every table.

It is green today: `anon` is denied, and a user without a role is allowed everywhere, which the
output names as the hole S-403 closes. A recorded local drill has shown every role-less cell going
red for the right reason.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Placement | Its own foundation (F-401), harness plus characterization matrix, no schema | Lands now while S-403 waits on S-401, and keeps S-403's PR on the policy diff | Research |
| CI key format | Not here: F-402 | The harness reads the key format-agnostically, so a red build stays unambiguous | Research |
| "Denied" for a read | The table reads empty (or 42501); "allowed" means fixture rows are visible | This is literally S-403's promise that a user with no role reads nothing; a single hidden row could pass while others leak | Plan |
| Coverage | CRUD on 5 representatives, a SELECT on all 16 tables, and a catalog check on every table | S-403 rewrites all 16 policies, and its main promise covers the whole schema | Plan |
| Probe proof | Unit-tested pure classifier plus a recorded drill (a scratch restrictive policy) | Follows the kill-switch drill precedent; no DDL inside tests | Plan |
| Hosted guard | Loopback check in the factory only | Scoped to the new capability (creating accounts that can sign in); other suites unchanged | Plan |
| Docs | CLAUDE.md pointer plus test-plan.md (retire "Phase 2.5", add a cookbook entry) | A doc that names a mechanism is coupled to it (lessons.md) | Plan |
| Action-level rows | Not in F-401 | Today an Action only adds `requireSession` over the same RLS; `FORBIDDEN` arrives in S-403/S-405 | Plan |
| Non-access errors | Fail the test whatever the expectation; every write has at least one allowed principal | Otherwise a bad payload or a 502 makes every denied cell pass | Plan |
| `clone_plan` denial | A declared `deniedWhen` for its "source plan not found" P0001 | RLS hiding the source surfaces in the RPC's own words, not as 42501 | Plan |

## Scope

**In scope:**

- `createSignedInUser`, with a loopback guard and a password that meets any likely policy;
- a user registry in `teardown`;
- the CI `SUPABASE_KEY` gate, moved into `load-test-env.ts`;
- the access probe and its unit tests;
- `role-matrix-expectations.ts` and its invariant test;
- `role-matrix.integration.test.ts`;
- the deny drill (in the change folder);
- CLAUDE.md and `test-plan.md` updates.

**Out of scope:**

- `user_roles` and role assignment, and the flip (S-403);
- e2e role accounts (HC Fix 2);
- the SQL lint gate (HC Fix 7);
- pgTAP;
- Action-level rows;
- the CI key format (F-402);
- moving `solver-credential` onto the factory;
- revoking `anon`'s residue;
- editing `health-check.md`.

## Architecture / Approach

There are two instruments and one data file:

- **Rows** are proven through signed-in clients by the probe. A read is judged from the role's own
  view; a write by service-role read-back, never from `error` alone.
- **Grants** are proven from the catalog through `pg`.
- **`role-matrix-expectations.ts`** is the specification both run against. It is typed so that a new
  principal (S-403) or a new table in the regenerated types fails `pnpm check` until declared, and
  the catalog check compares the live table set against the declared one.

Writes never ask for rows back, so a read denial can't masquerade as a write denial.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Signed-in user factory and teardown registry | Create, sign in and clean up a human user; one CI gate for `SUPABASE_KEY` | Users leaked when teardown fails partway, mitigated by aggregated errors and registering before sign-in |
| 2. Access probe and role matrix | Classifier, expectation table, and a live 16-table matrix that is green today | A classification bug that hides silent denials, mitigated by unit tests now and the drill in Phase 3 |
| 3. Prove it can fail, then docs | Drill record in `change.md`; CLAUDE.md and test-plan.md point at the harness | A role-less cell going red for the wrong reason, which means a probe bug to fix first |

**Prerequisites:** the local Supabase stack running (`pnpm exec supabase start`), `.env.test.local`
holding the service-role key, and `pnpm env:local` done, so that `readPublishableKey()` resolves.

**Estimated effort:** about 2 sessions across 3 phases.

## Open Risks & Assumptions

- **The lane is already about 1-in-5 red from transient 502s.** The matrix adds one file and signs
  in once per file. A red run has to be judged against that baseline.
- **CI's unpinned Supabase CLI (until F-402) could change GoTrue's rate limiting or the key export.**
  The `load-test-env.ts` gate turns a missing key into a loud failure.
- **Until S-403, the matrix proves little that is new** beyond `anon` at the row level and the
  catalog posture. Its value is the harness and the table S-403 edits.
- **Auth users leaked by a crashed run are not swept.** They are confined to local or ephemeral CI
  stacks and identifiable by the `signed-in-` prefix.

## Success Criteria (Summary)

- An agent rewriting S-403's policies can no longer get a green lane regardless of what the
  policies say: flipping the `noRole` column fails until the policies match.
- The drill showed all 32 role-less cells red for the right reason and green again after restore.
- `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test` and `pnpm test:integration` are all green,
  with no migration.
