# S-406 Users Page — List Users and Change Roles: Plan Brief

> Full plan: `context/changes/users-page-roles/plan.md`
> Research: `context/changes/users-page-roles/research.md`

## What & Why

An admin (the DP coordinator) gets a `/users` page that lists every human user of the school. Each row shows the display name beside the email, the role, the status, a "Service account" label where it applies, and who last changed the role and when. From that page the admin can give, change or remove anyone's role.

This is the first admin-only surface. It is what lets the school, rather than the developer, decide who may see and edit timetables (FR-405/406/408/413, §NFG "access changes traceable").

## Starting Point

S-403 left:

- a `user_roles` table that nobody can write through the Data API;
- one DEFINER role reader, built for exactly this slice's admin-reads-all policy;
- a capability map with no admin-only capability.

Emails and the machine flag live only in `auth.users`, which the app cannot read. Hosted already has an admin. The calibration-campaign account no longer exists.

## Desired End State

**Admins** see **Users** in the sidebar and on the dashboard. A role change saves on select. Changing your own role, or choosing "No access", asks for confirmation first. The school can never be left with zero admins, whether through the page, the operator script or two admins demoting each other at the same moment. Every role write is recorded.

**Everyone else**: authors and viewers get a 404 at `/users`, and machine users appear nowhere.

**E2E** gains an admin account and project.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where emails and the machine flag come from | `public.user_directory`, mirrored by an INVOKER trigger on `auth.users` and backfilled | No new DEFINER function and no secret key. It covers users who never signed in, and S-407 reuses it. | Research → Plan |
| Admin-only writes | A new capability `manage_users`, through an INVOKER `private.can_manage_users()` | Policies name capabilities, never roles, and there is no recursion (P1). | Research |
| Last-admin guard | A BEFORE trigger with `pg_advisory_xact_lock`. It exempts FK cascades and raises `PT409` | It binds the operator too, survives account deletion and teardown, closes the write-skew race (P9), and PostgREST maps `PT409` to HTTP 409. | Research + Plan probes |
| Access record | `access_changes`, append-only by grants. Grants are recorded AFTER INSERT; changes and removals BEFORE UPDATE/DELETE | Probes P7 and P8 showed that an AFTER-only recorder breaks account deletion, and a BEFORE-only one logs fake grants on upsert. | Plan (corrects research) |
| "No access" | Offered in the picker. It deletes the role row, confirmed and guarded | The only immediate way to cut access until S-408 ships. | Plan (user) |
| Self-demotion | Allowed, with a confirm, then a redirect to `/dashboard` | Matches the PRD's bootstrap story ("may step down"). | Plan (user) |
| Where the record is shown | Inline on each row: "Changed by X · date" from the latest record. History stays in SQL | Meets §NFG with no new UI surface. | Plan (user) |
| Retention | Ids only, `on delete set null`, with an `actor_kind` of user or operator | No ex-staff email is kept, and "Deleted user" stays distinct from "Operator". | Plan (user) |
| Non-admin at `/users` | 404 | Doesn't advertise the page. It is one route check, and the middleware is unchanged. | Plan (user) |
| Service-account label | An `app_metadata.service_account` flag, mirrored. No hosted instance today | Not spoofable, and no email in code. The runbook carries the step for the next campaign. | Plan (user) |
| U+061C in display names | Folded in as an additive `NOT VALID` + `VALIDATE` constraint | It was assigned to S-406 by S-401 (F4). | Plan |

## Scope

**In scope:**

- the directory, its Auth trigger and the backfill;
- `manage_users` and the admin policies and grants on `user_roles`;
- the last-admin guard and the access-change record;
- `/users`: route, nav and tile, table, role picker and confirmations;
- the `profileLabel` move to `shared/ui`;
- the role-matrix expansion, with declared policy shapes for user-keyed tables;
- the admin e2e account and specs;
- CLAUDE.md, README, runbook, test-plan and lessons updates;
- the U+061C rule.

**Out of scope:**

- deactivation (S-408), account creation (S-409), invitations (S-410), ban/delete and email change (S-411);
- a history panel, and email snapshots or retention jobs;
- a DB guard on *deleting* the last admin's account (S-411 owns it);
- locking the service account's role;
- `entities/user` (S-407);
- a "never signed in" status.

## Architecture / Approach

```
auth.users ──(AFTER INSERT / UPDATE OF email, app_metadata WHEN …)──► user_directory   [read: can_read, never machines]
                                                                          ▲ exists() check
admin session ─► changeUserRole action (requires manage_users) ─► user_roles ─┬─ BEFORE UPD/DEL: guard_last_admin (lock → count → PT409)
                                                                              ├─ BEFORE UPD/DEL + AFTER INS: record_role_change
                                                                              └─► access_changes  [read: admins; insert: trigger only]
/users route: allows(access,"manage_users") ? loader(4 selects) → buildUserRows (pure) → UsersPage island : 404
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. User directory | The mirror table, the Auth trigger, the backfill, matrix cells, a real-GoTrue test, the U+061C rule | A raising trigger blocks user creation on hosted |
| 2. Role writes, guard, record | `can_manage_users`, admin policies and grants, the guard, `access_changes`; matrix flip red first; rolled-back invariant and lock tests | Trigger timing in cascades and upserts (P7/P8); global-invariant tests in a parallel lane |
| 3. App capability, loader, action | `manage_users` in the app, `profileLabel` moved, the `_pages/users` loader, model and action | `Record<Capability>` fallout across the tests; the steiger cap on `shared/lib` |
| 4. Users page | Route with 404, nav and tile, table, picker, confirms, badges, latest-change line | Self-demotion navigation; hydration-safe dates |
| 5. Admin e2e + docs | `chromium-admin`, the admin spec and tripwires, conventions and runbooks, hosted checks | E2E specs must never change the admin's own role |

**Prerequisites:** the local Supabase stack, and S-403 and S-405 done (both are). Hosted already holds an admin.
**Estimated effort:** about 4–5 sessions across 5 phases. Phases 1 and 2 are the heavy ones.

## Open Risks & Assumptions

- **The trigger on `auth.users` is proven locally against real GoTrue (P10), but not on hosted.** The risks are mitigated by null-safe derivations, the `WHEN` clause, the integration test, and the hosted post-deploy check. Recovery is roll-forward.
- **The guard counts admins through RLS as the invoker.** That is correct only while every `user_roles` writer is an admin, the service role or the owner. A future writer role must revisit it.
- **Deleting the last admin's account is not blocked at the database.** It is an accepted gap, assigned to S-411.
- **Secret-key writers (S-409, S-411) will be recorded as "Operator"** unless they write explicit records. That is flagged in the roadmap.
- **U+061C validation could fail the deploy** if a hosted display name contains it. A pre-merge read-only check guards it.

## Success Criteria (Summary)

- An admin lists the school's users and changes, gives or removes a role from the page, and sees who changed it and when. Machine users never appear.
- No path leaves the school without an admin: the page, the operator script, or two admins at once.
- Every CI lane is green, including the new `chromium-admin` project. On hosted, the coordinator is promoted in-app and shows "Changed by \<developer\>".
