# Create account with a temporary password (S-409) — Plan Brief

> Full plan: `context/changes/create-account-fallback/plan.md`
> Research: `context/changes/create-account-fallback/research.md`

## What & Why

As a fallback when an invitation cannot reach someone (FR-403), an admin creates an account from the Users page with a server-generated temporary password. The person cannot reach any data until they choose their own password. This is the milestone's one new trusted component: a secret-holding Edge Function that keeps the secret key out of the app Worker.

## Starting Point

Roles are enforced by RLS through `private.current_app_role()`; the middleware knows `granted | none | unavailable`; the Users page lists roles and changes them (S-406). There is no `supabase/functions/`, no Deno toolchain, no function deploy, and CI excludes the edge runtime. Research ran the whole flow on a throwaway stack (51 of 51 checks).

## Desired End State

An admin presses **Create account**, picks an email and a role, and sees a 24-character password once. The new person signs in, is held on `/account` with a banner (every other page, action and RLS read refuses them), chooses a password, and the same session then holds their role. Until then the Users page shows "Temporary password", and the admin can re-issue a new one for that row.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where the flag lives | `user_directory.must_change_password` | System-owned and RLS-readable live; `app_metadata` is stale and unclearable without the secret key | Research |
| Enforcement | `current_app_role()` returns null while pending | One function change fails every table closed, including for a pending admin | Research |
| Secret-key holder | Deno Edge Function, Worker stays a courier | Decision of record: the Worker holds no secret key | Research |
| Password source | Server-generated, revealed last, rollback on failure | Admin `createUser` enforces no strength floor; reveal-last makes a multi-write sequence fail safely | Research |
| Re-issue (D1) | Included, pending accounts only; full reset to S-411 | Closes the lost/timed-out dead ends without letting an admin take over a live account | Plan |
| Role at creation (D2) | Chosen in the create form | No window where a finished first sign-in hits "no access yet"; matches S-410 | Plan |
| Expiry (D3) | None, state visible on the Users page | One-school product; recorded as an accepted PRD residual | Plan |
| Row wording | "Temporary password" | "Never signed in" is wrong for someone who signed in but has not yet changed it | Plan |
| Hosted check | Phase 1 gate before any build | Fixes the trigger form and can stop the plan cheaply | Plan |
| Last-admin guard | Excludes pending admins, in this slice | S-409 introduces pending admins; S-408 is skippable and may never ship | Plan |
| Dependency pinning | Exact pins in `deno.json` + Dependabot, no lockfile | Lockfile compatibility with the runtime's Deno 2.1.4 is unproven | Plan |
| Function tests | HTTP-surface integration + `deno test` for pure parts | Repo rule: test the wrapper; the generator gets a direct test | Plan |

## Scope

**In scope:** the function (`create`, `reissue`), the flag and fail-closed role read, the clearing trigger, the pending-aware guard, the pending access state and gate, Account banner, Users page create/re-issue UI, Deno toolchain boundary, CI edge runtime and deploy step, docs and runbook corrections.

**Out of scope:** resetting confirmed accounts and deleting accounts (S-411), email invite (S-410), deactivation (S-408), password expiry, a Deno lockfile.

## Architecture / Approach

Users page → Astro Action (`manage_users`, a courier) → `functions.invoke("admin-users")` with the admin's own JWT → function verifies the JWT, makes a live `own_app_role = admin` check, then creates the user, sets the flag, records `account_created` as the verified admin, grants the role under the admin's session (so S-406's trigger attributes it), and reveals the password last. The clearing trigger on `auth.users` lifts the flag on a real password change only.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Hosted check | Recorded hosted facts; trigger form decided | Secret key not named `default`, or ES256 not current: re-plan |
| 2. Toolchain and CI | Deno boundary, edge runtime in CI, function deploy, Dependabot | Cold start and image pull make the flaky lane worse |
| 3. Access model | Matrix (red first), migration, guard, types, tests | Overlap with S-408 on `current_app_role()` and the guard |
| 4. Edge Function | `create` and `reissue` with rollback and audit | Ordering: admin check before the admin client; reveal last |
| 5. The app | Pending state, gate, banner, Users UI, e2e | `functions.invoke` inside workerd is unmeasured |
| 6. Docs and hosted smoke | CLAUDE.md, README, runbooks, PRD residual, smoke test | Merge deploys the Worker (no merge during a solve) |

**Prerequisites:** S-401, S-406, F-402 (all done); developer access to the hosted dashboard and DB for Phase 1.
**Estimated effort:** about 6 to 8 sessions across 6 phases; Phases 2 to 4 are the heavy ones.

## Open Risks & Assumptions

- Hosted behaviour is unproven until Phase 1 (secret key name, `verify_jwt`, DB encryption, Deno version, region pinning).
- If hosted has DB encryption on, the migration uses the `reauthentication_token` trigger form instead.
- The guard change (pending admins) and the empty-cache cold start were not exercised in the spike; each has its own test or measurement here.
- Transitive function dependencies can float on a merge (accepted residual).

## Success Criteria (Summary)

- An admin creates an account without email; the person must set their own password before reaching any data, and then holds their role in the same session.
- The role matrix (with a pending admin), the function's HTTP-surface suite and the e2e journey are green in CI; machine users are untouchable through the function.
- The hosted smoke test shows the flag surviving first sign-in and clearing on the real change.
