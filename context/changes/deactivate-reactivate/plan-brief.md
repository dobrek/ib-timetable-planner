# Deactivate and reactivate (S-408) — Plan Brief

> Full plan: `context/changes/deactivate-reactivate/plan.md`
> Research: `context/changes/deactivate-reactivate/research.md`

## What & Why

An admin can deactivate a colleague from the Users page and reactivate them later. A deactivated person's data access ends on their next request, even though their session is still valid. They land on the "no access yet" notice, keep their own account, and keep their role for when they come back. This is PRD FR-407 (nice-to-have) and the "or deactivate" half of FR-408 (never lose the last active admin). It also gives S-411 a way to close a ban's up-to-one-hour window.

## Starting Point

Access already converges on one function, `private.current_app_role()`, read live on every statement and every request. S-409's pending fence proved that one extra condition there cuts access at once. Two things don't fit yet. The last-admin guard and the access record both return early when the role is unchanged, so as written the last admin could be deactivated, and a deactivation would go unrecorded. The only way to cut access today is "No access", which deletes the role.

## Desired End State

Every other user's Active row on `/users` offers **Deactivate** (asks first) and, once deactivated, **Reactivate** (saves at once). The row keeps showing the role. The person's next navigation lands on the notice, with a reworded paragraph that reads true for someone who once had access. Reactivating restores access with no new sign-in. The last active admin can't be deactivated by any path. Both actions are recorded with who did them and when. The break-glass script reactivates as well as granting.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where the state lives | `user_roles.deactivated_at` (Option A) | The admin already writes and reads this table under RLS, so there is no new policy, grant or table, and the role survives. | Research / Plan |
| Not the platform ban | Out of scope (S-411) | A ban sends the person to sign-in, not the notice, and needs the secret key. | Research |
| Notice | Same `none` state, neutral paragraph, heading unchanged | One-line copy fix; no middleware or `AccessState` change, no extra read. | Plan |
| Which rows | Other users' Active rows only | Avoids a tangle with the pending states; "No access" already covers self-lockout. | Plan |
| Role picker on a deactivated row | Stays live; a role change keeps the person deactivated | No special case: the guard and recorder must handle script/SQL writes anyway. | Plan |
| Role + flag in one UPDATE | Two records (`role_changed`, then `deactivated`/`reactivated`) | Every state change is recorded; the page never sends such a write. | Plan |
| Break-glass script | Any role write also reactivates, and reports it | Recovery must never print success while the person stays locked out. | Plan |
| Mid-session | Parity with S-406 (refused write, notice on the next navigation) | No change to every island's error path. | Plan |
| Red-first | Column-only migration, then tests red, then the fence migration | An honest red with no factory workaround (S-409 had to skip its write). | Plan |
| E2E | A full two-context spec, extending the sanctioned sign-in exception | The outcome sentence spans middleware, RLS and UI, and only a browser shows all three. | Plan |

## Scope

**In scope:**
- Two additive migrations: the column; then the fence, which re-creates `current_app_role()`, `guard_last_admin()` and `record_role_change()` from their live bodies and adds the kinds `deactivated` and `reactivated`.
- Role matrix: a `deactivatedAdmin` principal (≡ `pendingAdmin`) and `ROLE_DEACTIVATIONS` (admin only).
- Guard and access-record cases, a factory option, and a domain integration test on an already-signed-in session.
- Users page: status, flags, the `setUserActive` action, hook, confirm dialog and table buttons.
- Notice copy, the `assign-role.mjs` and e2e-provisioner reactivation, docs (CLAUDE.md, README, the runbook, e2e/CLAUDE.md) and a two-context E2E spec.

**Out of scope:**
- A dedicated access state.
- A redirect on FORBIDDEN.
- Deactivating pending or own rows.
- Locking the picker.
- Ban, sign-out or session revocation (S-411).
- Stopping a deactivated person's running job.
- Any Edge Function change.

## Architecture / Approach

```
admin session ──UPDATE user_roles.deactivated_at──▶ RLS ("Admins change roles")
                                                     ├─ BEFORE guard_last_admin   (active admin = admin ∧ not deactivated)
                                                     └─ BEFORE record_role_change (deactivated / reactivated)
person's next request ──▶ current_app_role() = null ──▶ every policy denies, middleware → none → /dashboard notice
```

The Users page reads `deactivated_at` through its existing loader and writes it through one Astro Action, under the admin's own session. Nothing needs the secret key.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The fence (database, red-first) | The column, matrix and test claims shown red, then the fence migration turning them green; types and CLAUDE.md | Re-creating three security functions: an early return or a dropped S-409 condition would silently let the last admin go |
| 2. Users page | Status, Deactivate/Reactivate, the action, the notice copy, unit tests and a live-session integration test | Status precedence against the pending and invitation states |
| 3. Break-glass and end-to-end proof | The script reactivates; a two-context spec shows a live session losing and regaining access | E2E flakiness from a second context; widening a recorded exception |

**Prerequisites:** S-406 (done). The local Supabase stack runs with the edge runtime. S-409 and S-410 are merged, so the live bodies carry the pending conditions.
**Estimated effort:** ~2–3 sessions across 3 phases (smaller than S-409 or S-410).

## Open Risks & Assumptions

- **Self-deactivation stays possible** through the database or a crafted action call, unless the admin is the last active one. The UI hides it. This is accepted, like "No access" on your own row.
- **A deactivated person's refresh token stays alive.** That is harmless (RLS fails closed) and is what makes reactivation instant. Permanent removal is S-411's job.
- **A stale board stays visible** after deactivation until the person navigates, and only a generic error shows. This is the same as S-406's role removal today.
- **S-411 must re-create these three bodies** from S-408's migration, not from earlier ones (lessons.md).

## Success Criteria (Summary)

- An admin deactivates a colleague on `/users`. The colleague's open session hits the notice on its next navigation, and reactivation brings it back with no new sign-in.
- The school can't lose its last active admin to a deactivation, and every deactivation and reactivation is recorded with its actor.
- `/verify`, the integration lane (matrix red first, then green) and the new E2E spec all pass.
