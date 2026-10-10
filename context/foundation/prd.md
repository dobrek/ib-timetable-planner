---
project: ib-timetable-planner
version: 1
status: draft
created: 2026-10-10
context_type: brownfield
product_type: web-app
target_scale:
  users: small
timeline_budget:
  delivery_weeks: 5
  hard_deadline: null
  after_hours_only: true
---

# PRD — IB Timetable Planner (user management & privileges)

> Brownfield change PRD, generated from `context/foundation/shape-notes.md`
> (2026-10-10). Seed: `context/changes/user-managment-research/research.md`
> (2026-10-09, follow-up 2026-10-10 with author decisions). IDs use this change's
> own series (`FR-4XX`/`US-4XX`); the archived PRDs use `0XX` and the CP-SAT change `3XX`.
> The prior change PRD (post-POC CP-SAT solver service) is archived at
> `context/foundation/archive/2026-10-10-prd.md`.

## Current System Overview

> Baseline this change is described against. May name real technologies — it describes
> reality, not a stack choice. Grounded in the research (commit `6eb1569`).

**Purpose.** An interactive IB timetable planner: a Plan Author drags course groupings onto a
two-cohort (dp1/dp2) slot grid with live constraint validation, and can generate a full board
with the CP-SAT solver.

- **Architecture and stack.** Astro 7 + React 19 islands on Cloudflare Workers; Supabase
  (Postgres + Auth); a CP-SAT solver in a Cloudflare Container that reaches the database as a
  **machine** Auth user (`solver_job_writer` via the Custom Access Token Hook).
- **Users today.** A few Plan Authors at one school. Accounts are created by hand by the developer
  in the Supabase dashboard (Auto Confirm, credentials handed over out of band). No self-signup,
  by design (student PII). Also ordinary Auth users: the solver machine user and a
  calibration-campaign account.
- **Auth, but no authorization.** Deny-by-default middleware resolves the session; every action
  checks only that a session exists. The database is one shared workspace: 16 identical
  `using (true)` RLS policies, full DML for `authenticated`, no owner/role/attribution columns.
  The only privilege check in the app is an env-keyed email allowlist on one ops route.
- **No self-service.** No password change, reset, profile, invite or email-confirm flow; no SMTP.
  The provisioning runbook tells new authors to "change the password", which no screen allows.
- **Must preserve.** Deny-by-default routing; no secret key in the Worker (decision of record);
  the solver machine credential and hook path; the <200 ms drag-drop validation budget; the shared
  author workspace (parallel variants); no self-signup; existing hosted school data.

## Problem Statement & Motivation

The product is being put forward: to **more staff at the same school**, with **ownership of
accounts handed to the school**, and in a state that is **ready to demo/pitch** to stakeholders.
Today every account is a full-edit account that only the developer can create, so the school
cannot onboard anyone itself, cannot give leadership or colleagues a look without giving them
edit rights, and cannot recover a forgotten password without the developer. It is **not** about
offering the product to other schools — multi-tenancy stays out.

**Current workaround and its cost.** Each onboarding, look-in request and password reset goes
through the developer working in the platform console, with credentials passed along out of band;
the only access level that exists is full edit.

**Insight.** None of this was needed until now: one author plus developer-run provisioning was
enough. What changed is who uses the product — and the authorization model has to change with it.

## User & Persona

### Primary persona — School admin (the DP/IB coordinator)

- **Who.** The DP/IB coordinator: owns the timetabling process at the school and is typically also
  a Plan Author.
- **Moments they reach for this.**
  - A new staff member needs access.
  - Leadership (or a colleague) wants to look at the timetable or a proposal.
  - Someone forgot their password.
- **Cost today.** Each of these goes through the developer working in the platform console, with
  credentials passed along out of band; the only access level that exists is full edit.
- _Not named as a trigger:_ someone leaving or changing job.

### Secondary persona — Viewer (read-only)

School leadership, other teachers, and fellow coordinators (e.g. CAS/EE, MYP). They need to read
timetables and proposals, and must not edit them.

### Secondary persona — Plan Author (existing)

Keeps editing exactly as today; gains a self-service account.

## Success Criteria

### Primary

- **The coordinator invites a colleague by email and the colleague lands read-only — with no
  developer involvement.** The flow, as a delta on today:
  1. The coordinator (admin) opens a new Users page.
  2. Types a colleague's email and picks a role (e.g. viewer).
  3. The colleague receives an invitation email.
  4. Opens the link, confirms with a button (so link-scanning can't consume it), sets a password.
  5. Lands in the app read-only: every plan and proposal, export and compare, no edit affordances.
  6. The coordinator sees them in the Users list as a viewer and can change the role.

### Secondary

- **The school runs its accounts alone:** over a full school term, no onboarding, role change or
  password reset needs the developer or the platform console.

### Guardrails

- **Generation works end to end** for authors — Generate, solve, proposal clone, delivery, board.
- **No author loses access or edits** on the day the change goes live: every existing author sees and edits
  everything they could before, and no edit silently becomes a no-op.
- **School data stays safe:** going live only adds to the school's existing data and harms none of it; no
  student data ever leaves in an email.
- **Drag-drop validation stays < 200 ms** (repo hard rule) with role checks in place.

> Blast radius named in shaping (page-me failures): generation breaking; authors locked out or
> edits vanishing; hosted school data harmed. Drag-drop latency was not named as page-me but stays
> a guardrail as a standing hard rule.

**Non-functional guardrails.** Each is outside-observable; mechanism is downstream.

- A role change takes effect on the affected person's next action, with no sign-out needed.
- After a ban or delete, all of that person's access ends within at most 1 hour.
- An invitation link stops working 72 hours after it is sent; a password-reset link after 1 hour.
- A flood of password-reset requests cannot prevent a genuine staff member from resetting their
  own password.
- No email the product sends contains student data; emails carry staff and plan information only.
- Product emails pass sender authentication and reach a real staff inbox at the school, not quarantine.
- Passwords shorter than 15 characters are refused.
- For every access change (invite, role, email, ban, delete), the product can show who made it and
  when.
- Preserved: drag-drop validation stays < 200 ms with role checks in place.

## User Stories

### US-401: Coordinator invites a colleague as a viewer

- **Given** the coordinator is signed in as admin, and a colleague has no account
- **When** they enter the colleague's email on the Users page, choose "viewer" and send the invite
- **Then** the colleague receives an invitation email; confirming it lets them set a password and
  land in the app read-only, and the coordinator sees them as a viewer in the Users list
- **Before:** the developer created the account in the platform console and passed credentials
  along out of band, and the only access level was full edit.

#### Acceptance Criteria

- Accepting needs a deliberate click on the confirm page; an automated mail-security
  scanner opening the link does not consume it.
- An expired or already-used link shows "ask your admin to re-send", not a raw error.
- The admin can re-send (FR-401) or revoke (FR-404) a pending invite.
- Inviting an email that already has an account is refused with a clear message, and no
  duplicate is created.
- The invitee's first view is read-only: every plan and proposal is visible, with no edit
  affordances.

## Scope of Change

> Each item is delta-categorized: `[new]` didn't exist, `[modified]` existing behaviour changes,
> `[preserved]` must keep working unchanged. FR identifiers carry over from shaping and are
> stable (FR-414 moved groups and kept its number; the retired FR-419 is not reused).
> `> Socrates:` blockquotes record the strongest counter-argument considered and its resolution.

### Accounts & invitations

- [new] FR-401: Admin can invite a colleague by email, choosing their role up front; re-inviting a pending address re-sends the invitation. Priority: must-have.
  > Socrates: Counter-argument accepted: "email is the fragile path — a school mail filter can
  > quarantine the invite, and FR-403 already onboards without email." Resolution: kept
  > must-have — it is the Primary success flow. Mitigated by P0's smoke test against a real
  > school M365 mailbox and by FR-403 as the fallback. Absorbed "re-send" from the retired FR-419.
- [new] FR-402: Invitee can accept an invitation by confirming on a page and setting a password. Priority: must-have.
  > Socrates: Counter-arguments considered: "the confirm page is the first new public route since
  > sign-in"; "a one-time code beats a link in an M365 school". Resolution: stands as written.
- [new] FR-403: Admin can, as a fallback when an invitation cannot reach someone, create an account with a temporary password that must be changed at first sign-in. Priority: must-have.
  > Socrates: Counter-argument accepted: "a temporary password passed along out of band is the
  > developer-era habit this change exists to retire." Resolution: kept must-have, but reworded
  > as a fallback only — not a second normal onboarding path. It is FR-401's mitigation.
- [new] FR-404: Admin can ban or delete an account, including revoking a never-confirmed invitation. Priority: must-have.
  > Socrates: Counter-arguments considered: "ban/delete isn't immediate — an issued token lives up
  > to 1 h — while FR-407's immediate flag is only nice-to-have"; "no one named 'someone leaves'
  > as a trigger"; "delete is irreversible". Resolution: stands as written. Absorbed "revoke a
  > pending invitation" from the retired FR-419.
- [new] FR-414: Admin can change a user's email address. Priority: must-have.
  > Socrates: Counter-argument accepted: "staff emails rarely change; a double-confirmation flow
  > plus keeping the user-list mirror in sync is real cost for a rare event." Resolution: changed
  > from self-service ("any user can change their email") to admin-only.
- ~~FR-419~~: _Retired during shaping_ (was: "Admin can re-send or revoke a pending
  invitation"). Counter-argument accepted: "it duplicates FR-401 + FR-404." Folded into FR-401
  (re-send) and FR-404 (revoke). The ID is not reused.

### Roles & access

- [new] FR-405: Admin can list the school's users with role and status; machine users never appear, and the calibration-campaign account appears labelled as a service account. Priority: must-have.
  > Socrates: Counter-argument accepted: "the calibration-campaign account is an ordinary author,
  > so it will appear in the coordinator's list and confuse them." Resolution: show it, labelled
  > as a service account.
- [new] FR-406: Admin can change any user's role (admin / author / viewer). Priority: must-have.
  > Socrates: Counter-arguments considered: "a demoted user's open page still shows edit controls
  > until reload"; "any admin can mint admins". Resolution: stands as written.
- [new] FR-407: Admin can deactivate and reactivate a user, with data access ending immediately. Priority: nice-to-have.
  > Socrates: Counter-arguments considered: "without it, removal (FR-404) leaves up to a 1 h
  > window"; "clearing a role already does this". Resolution: stands as nice-to-have.
- [new] FR-408: Admin cannot demote or deactivate the last active admin. Priority: must-have.
  > Socrates: Counter-arguments considered: "rarely fires with two admins, and the dashboard is
  > break-glass"; "it pins a departing last admin in place". Resolution: stands as written.
- [new] FR-409: Viewer can read every plan and proposal (incl. perspective views), export timetables and use the comparison page, with no edit affordances; a viewer can always tell a proposal or draft from a plan the authors consider current. Priority: must-have.
  > Socrates: Counter-argument accepted: "proposals are unreviewed solver output; leadership
  > seeing every draft may treat one as the decided timetable." Resolution: viewers still see
  > everything, clearly labelled. The "current" marker it relies on is FR-420.
- [new] FR-410: Signed-in user without a role sees a "no access yet — ask your admin" notice and no plan data; from there they can still manage their own account (password, display name) and sign out. Priority: must-have.
  > Socrates: Counter-argument accepted: "a dead end — the user can't do anything, not even change
  > their password, until an admin acts." Resolution: the notice page also gives access to the
  > user's own account; still no plan data.

### Self-service

- [new] FR-411: Any user can change their own password while signed in. Priority: must-have.
  > Socrates: Counter-argument accepted: "requiring the current password blocks a user arriving
  > from a reset link." Resolution: the current-password rule is dropped. **Trade-off accepted:**
  > anyone holding a live session (a stolen cookie, an unlocked shared PC) can change the password
  > and lock the owner out.
- [new] FR-412: Any user can reset a forgotten password by email from the sign-in page. Priority: must-have.
  > Socrates: Counter-argument accepted: "with an in-app admin, 'ask the coordinator' covers a
  > forgotten password without a public endpoint." Resolution: kept must-have — self-service reset
  > is the coordinator's third trigger. Abuse of the public endpoint (exhausting the daily email
  > cap) is covered by a non-functional guardrail.
- [new] FR-413: Any user can set a display name; wherever identity matters (the Users list, "Created by") the email is shown alongside it. Priority: must-have.
  > Socrates: Counter-argument accepted: "a free-text name lets someone appear as a colleague."
  > Resolution: kept, with the email always shown next to the display name.

### Attribution

- [new] FR-415: Any user can see who created a plan or proposal. Priority: must-have.
  > Socrates: Counter-arguments considered: "a proposal is credited to whoever pressed Generate";
  > "existing hosted plans show 'unknown' on day one". Resolution: stands as written.

### Plan status

- [new] FR-420: Author can mark one plan as current, and every user sees which plan is current. Priority: must-have.
  > Added during shaping to resolve FR-409's "tell a proposal or draft from the current plan":
  > today only an undelivered proposal is marked as one, a delivered proposal
  > becomes an ordinary plan, and nothing marks a plan as current.
  > Socrates: Counter-arguments considered: "contested shared state — any author can move the
  > marker"; "'current' but still editable — should marking freeze it?"; "a naming convention
  > would do". Resolution: stands as written.

### Preserved & modified

- [modified] FR-416: Author can edit plans and catalog and generate exactly as today; stopping a generation job is limited to whoever requested it, or an admin. Priority: must-have.
  > Socrates: Counter-argument accepted: "with more authors, one can stop another's long-running
  > solve (up to 38 min of compute)." Resolution: changed from preserved to modified — editing
  > stays fully shared, but stopping a job needs to be its requester or an admin (so a job has to
  > record who requested it).
- [preserved] FR-417: Generate → solve → proposal → delivery keeps working for authors; the one intended difference is that a proposal is credited to whoever pressed Generate. Priority: must-have.
  > Socrates: Counter-argument accepted: "with attribution, a proposal belongs to the clicker —
  > new behaviour inside a 'preserved' FR." Resolution: crediting the requester is intended; it is
  > named here as the flow's one deliberate difference.
- [preserved] FR-418: Unauthenticated visitors are sent to sign-in, and nobody can sign themselves up. Priority: must-have.
  > Socrates: Counter-arguments considered: "one-by-one invites don't scale — an email-domain
  > rule would"; "invite/reset routes erode 'only sign-in is public'". Resolution: stands as
  > written.

## Constraints & Compatibility

### Integrations and contracts

- The solver wire contract (`contracts/generation-wire.schema.json`) is untouched.
- The solver machine user and the access-token hook are unchanged; the machine user gets no role
  and stays out of user management.
- **No secret key in the app Worker** — the decision of record (`deploy-plan.md:141`) stands.
  Account-lifecycle operations must reach the secret some other way (author decision 2026-10-10).
- The deny-by-default allowlist widens only for invitation acceptance and password reset, each
  with a recorded reason.
- The ops route's env-keyed email allowlist (`SOLVER_OPS_ALLOWED_EMAILS`) is unchanged.

### Data migration

- **Additive only.** Hosted holds real school data (README's "no production data yet" line is
  stale).
- Existing non-machine users are backfilled as `author`; a runbook step promotes the developer to
  `admin`.
- Existing plans have no recorded creator and show "unknown"; no backfill is possible.
- Existing generation jobs have no recorded requester and stay stoppable by any author.
- No plan is marked current at migration time.

### Backward compatibility

- On migration day every existing author keeps the same sessions, URLs and workflows (guardrail).
- Proposal delivery keeps working for authors (FR-417); what happens when a viewer is the first to
  open a finished proposal is open (Open Question 1).

### Preserved behavior

- Plan and catalog editing stays fully shared between authors (FR-416).
- Generate → solve → proposal → delivery for authors (FR-417).
- No self-signup; unauthenticated visitors go to sign-in (FR-418).
- Drag-drop validation < 200 ms.

### Constraints the existing system imposes

- **Migrations auto-deploy on merge.** CI applies pending migrations to hosted on every merge to
  `main`, so each migration must be safe against live school data on its own.
- **No merge mid-solve.** Every merge deploys and may roll the solver container (README rule); it
  binds every phase of this change.
- **Hosted auth config by hand.** SMTP, site URL, email templates and hook settings change through
  the dashboard or the Management API — never `config push`.
- **All CI lanes stay green** — verify, integration, e2e and solver. Test accounts must keep
  working once access is fail-closed.

## Business Logic Changes

**What a person may see and change is decided solely by the one role a school admin assigned
them; without a role, they see no school data.**

The rule consumes two inputs: the role an admin assigned the person (admin, author, viewer, or
none), and — for stopping a generation job — who requested that job. Its output is what the
person sees and which controls they get, on every page and every action. A person meets it the
moment they sign in: an author sees today's product, a viewer sees everything read-only, an admin
additionally sees the Users page, and someone without a role sees only the "no access yet" notice
and their own account.

Invariants that come with it: one role per person; admin includes everything an author can do;
the school always keeps at least one active admin (FR-408); a job is stopped only by its requester
or an admin (FR-416), except jobs that predate this change, which any author may still stop; at
most one plan is marked current (FR-420).

**Existing rule — unchanged.** The system validates every placement against the two-cohort
(dp1/dp2) constraints and generates complete, oracle-verified boards. This change does not modify
that rule; it decides only _who_ may invoke it.

## Access Control Changes

### Current model

Email + password sign-in; no self-signup; accounts created by the developer in the platform
console. A single human role (Author) with full access to everything; deny-by-default
middleware; unauthenticated visitors to any gated page are sent to sign-in. One machine
principal (the solver) with its own narrow, separately granted access.

### Planned changes

Three global roles within the one school — **one role per user**:

| Capability                                             | admin | author | viewer | no role / deactivated |
| ------------------------------------------------------ | :---: | :----: | :----: | :-------------------: |
| Read every plan and proposal (incl. perspective views) |   ✓   |   ✓    |   ✓    |           —           |
| Export timetables; use the comparison page             |   ✓   |   ✓    |   ✓    |           —           |
| Own account (change password, display name)            |   ✓   |   ✓    |   ✓    |           ✓           |
| Edit plans and catalog; generate; mark a plan current  |   ✓   |   ✓    |   —    |           —           |
| Stop a generation job                                  |  any  |  own   |   —    |           —           |
| Manage users (invite, create, role, email, ban/delete) |   ✓   |   —    |   —    |           —           |

- **Admin ⊇ author.** The admin (the DP coordinator) is also a Plan Author.
- **No role ⇒ no access (fail-closed).** A signed-in user without a role — newly created and not
  yet assigned, or deactivated — stays signed in on a **"no access yet — ask your admin"** notice
  page that reveals no plan data; from there they can still manage their own account and sign out
  (FR-410).
- **Stopping a job** is limited to its requester or an admin (FR-416); editing stays fully shared
  between authors.
- **Bootstrap.** Every existing staff account starts as `author` when the change goes live (the
  calibration-campaign account included). A documented operator step makes the **developer admin** by email; the developer then
  **promotes the DP coordinator in-app** and may stay admin as a support lever or step down.
- **Machine users** (the solver) get no role, never appear in the admin's user list, and cannot be
  touched by user-management actions.

### Preserved

- No self-signup.
- Deny-by-default access; unauthenticated visitors are sent to sign-in.
- The solver machine credential and hook path, unchanged.
- The solver operations page keeps its own separate operator list; it is not folded into `admin`.

## Non-Goals

- **Multiple schools / tenancy.** One school only; "putting the product forward" does not mean
  other schools. Standing non-goal, unchanged.
- **Folding the ops allowlist into `admin`.** The solver operations page keeps its own operator
  list, independent of roles, so it keeps working even if role data is broken.
- **Student or parent accounts.** Accounts are for staff only; students and parents never sign in.
- **Bulk import or school-system sync.** No CSV staff import and no syncing leavers from school
  systems; the admin onboards people one at a time.

### Deliberately not ruled out

Offered as non-goals and left open on purpose — not forgotten: per-plan sharing / ownership
(model B), custom roles or a permission editor, single sign-on with the school's identity provider and multi-factor sign-in, and deactivation
(FR-407, nice-to-have).

## Open Questions

1. **Delivery when a viewer opens a finished proposal first.** Delivery runs under the visitor's
   session, and a viewer cannot write. Should delivery wait for the next author/admin visit
   (today's mechanism), or happen regardless of who looks (a bigger change to FR-417)? — Owner:
   user.
2. **Invitation lifetime vs platform cap.** The 72-hour invitation lifetime must be verified
   against what the auth platform allows. — Owner: planning.
