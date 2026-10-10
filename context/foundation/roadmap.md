---
project: ib-timetable-planner
version: 1
status: draft
created: 2026-10-10
updated: 2026-10-10
prd_version: 1
main_goal: quality
top_blocker: external
milestone_id: school-run-accounts
milestone_seq: 2
milestone_status: open
---

# Roadmap: IB Timetable Planner (user management & privileges)

> Derived from `context/foundation/prd.md` (v1 — the user-management PRD, 2026-10-10) + the research's decided phasing (`context/changes/user-managment-research/research.md`, "Decided scope") + auto-researched codebase baseline (2026-10-10).
> Edit-in-place; archive when superseded. The closed M-01 roadmap (CP-SAT solver service) is archived at `context/foundation/archive/2026-10-10-roadmap-cp-sat-solver-service.md`.
> Slices below are listed in dependency order. The `## At a glance` table is the index. IDs use this change's `4XX` series; `S-310` keeps the ID it had in M-01.

## Milestone

**M-02: The school runs its own accounts** — Status: open

- **Intent:** The DP coordinator onboards colleagues — read-only leadership included — changes roles, and leaves password resets to each person, with no developer or platform console involved. Access becomes fail-closed (denied unless an assigned role grants it) without any existing author losing access or edits.
- **Source materials:** `context/foundation/prd.md` (v1, 2026-10-10); sequencing input from the shape notes' technical-roadmap block and the research's decided P0–P6 scope; `S-310` traces to FR-309 of the archived CP-SAT PRD (`context/foundation/archive/2026-10-10-prd.md`).
- **Done when:** every S-NN below is `done`, and the PRD's Primary success flow — invite by email → confirm → set password → land read-only → listed as a viewer on the Users page — has been shown on hosted against a real school mailbox. The Secondary criterion (a full term without developer help) is observed after the milestone closes; it is not a gate.
- **Scope anchors:** FR-401–FR-418 and FR-420 (FR-419 was retired in shaping and is not reused), US-401, the PRD's Guardrails and Non-functional guardrails; FR-309 (archived CP-SAT PRD) for the carried `S-310`.

## Vision recap

The planner is being put forward to more staff at the same school, with ownership of accounts handed to the school and in a state ready to demo to stakeholders. Today every account is a full-edit account that only the developer can create in the platform console, so the school cannot onboard anyone, cannot give leadership a look without edit rights, and cannot recover a forgotten password alone. This milestone introduces three global roles (admin, author, viewer), a Users page, self-service passwords and email invitations, under one rule: what a person may see and change is decided solely by the one role a school admin assigned them, and without a role they see no school data.

## North star

**S-410: Coordinator invites a colleague by email and the colleague lands read-only** — the north star is the smallest end-to-end slice whose delivery would prove what the milestone exists for, placed as early as its prerequisites allow; here that is the PRD's Primary success criterion verbatim: the school onboards a colleague, with the right access, without the developer.

> Under `main_goal: quality`, every slice ahead of it retires one of its risks in isolation — fail-closed roles proven by role tests (S-403), the email channel proven against a real school inbox (S-402), the read-only landing (S-405), the secret-holding lifecycle component proven on the simpler no-email path (S-409) — so S-410 itself adds only the invitation, its acceptance page, and re-send/revoke.

## At a glance

`§NFG` = the PRD's Non-functional guardrails list; `§Guardrails` = its Guardrails list. Neither carries IDs, so the topic is named in brackets.

| ID    | Change ID                    | Outcome (user can …)                                                                                   | Prerequisites      | PRD refs                                                                       | Status   |
| ----- | ---------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------ | -------- |
| S-401 | account-self-service         | change their own password and set a display name; passwords under 15 characters are refused           | —                  | FR-411, FR-413, §NFG (passwords ≥ 15)                                          | ready    |
| S-402 | forgot-password-by-email     | reset a forgotten password by email, through a scanner-safe confirm page, into a real school inbox     | S-401              | FR-412, FR-418, §NFG (link lifetime, reset flood, no student data, inbox delivery) | blocked  |
| S-403 | fail-closed-roles            | keep everything as an existing author, while someone without a role sees only "no access yet"          | S-401              | FR-410, FR-416, FR-417, FR-418, §Guardrails, §NFG (role change on next action, < 200 ms) | proposed |
| S-404 | current-plan-marker          | (author) mark one plan as current; everyone sees which plan is current                                 | —                  | FR-420                                                                         | ready    |
| S-405 | viewer-read-only             | (viewer) read every plan and proposal, export and compare, with no edit affordances                    | S-403, S-404       | FR-409                                                                         | blocked  |
| S-406 | users-page-roles             | (admin) list the school's users and change anyone's role; the last admin cannot be demoted             | S-403              | FR-405, FR-406, FR-408, FR-413, §NFG (access changes traceable)                | proposed |
| S-407 | created-by-and-job-ownership | see who created each plan or proposal; only a job's requester or an admin can stop it                  | S-406              | FR-415, FR-416, FR-417                                                         | proposed |
| S-408 | deactivate-reactivate        | (admin) deactivate and reactivate a user, with data access ending on their next action                 | S-406              | FR-407                                                                         | proposed |
| S-409 | create-account-fallback      | (admin) create an account with a temporary password that must be changed at first sign-in              | S-401, S-406       | FR-403                                                                         | proposed |
| S-410 | invite-by-email              | (admin) invite a colleague by email; the colleague confirms, sets a password and lands with that role  | S-402, S-405, S-409 | FR-401, FR-402, FR-404, FR-418, US-401, §NFG (invite lifetime, inbox delivery, no student data) | blocked  |
| S-411 | remove-and-correct-accounts  | (admin) ban or delete an account and change a user's email; access ends within an hour                 | S-409              | FR-404, FR-414, §NFG (removal ≤ 1 h, access changes traceable)                 | proposed |
| S-310 | job-completion-email         | get notified of job completion by email as well as in-app                                              | S-402, S-407       | FR-309 (archived CP-SAT PRD), §NFG (no student data)                           | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                         | Chain                                              | Note                                                                                                                                              |
| ------ | ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Self-service & email channel  | `S-401` → `S-402`                                  | The external-risk track: the first email the product sends is proven early. Feeds Stream D at `S-410` and Stream C's `S-310`.                    |
| B      | Fail-closed roles & viewer    | `S-403` → `S-405`, with `S-404` parallel           | Quality-first: the riskiest rewrite lands, proven by role tests, before any new surface. `S-403` hangs off Stream A's `S-401`.                    |
| C      | Admin & attribution           | `S-406` → `S-407` → `S-310`, with `S-408` parallel | The Users page and the readable list of school users everything after it reuses. `S-310` joins Stream A at `S-402`.                              |
| D      | Account lifecycle             | `S-409` → `S-410` ∥ `S-411`                        | The secret-holding component, proven on the fallback first; joins Stream C at `S-406`. `S-410` (north star) also joins Streams A and B at `S-402` and `S-405`. |

## Baseline

What's already in place in the codebase as of 2026-10-10 (auto-researched + author-confirmed; no code has changed since the research commit `6eb1569`). No slice below re-scaffolds a layer reported present.

**Generic platform — present (per tech-stack.md; not re-probed):**

- **Frontend:** present — Astro 7 + React 19 islands, Tailwind v4, shadcn primitives.
- **Backend / API:** present — Astro Actions are the single mutation/compute transport.
- **Data:** present — Supabase Postgres; hosted holds real school data (migrations additive only, applied on merge).
- **Auth:** **partial** — authentication present (email/password, deny-by-default `src/middleware.ts:7-10` allowing only `/auth/signin`, `/api/auth/`, `/_`); **authorization absent**: 17 `using (true)` policies for `authenticated`, no human role or capability helper, actions check only that a session exists (`src/shared/lib/actions/require-session.ts:9-11`), and `DomainErrorCode` has no `FORBIDDEN`.
- **Deploy / infra:** present — GitHub Actions gate-then-deploy (verify / integration / e2e / solver / deploy); the CP-SAT solver runs as a Cloudflare Container attached to the Worker.
- **Observability:** partial — Cloudflare observability and raw `console.*` only; **no audit trail** of who changed what.

**Change-specific:**

- **Attribution / current plan:** absent — no `created_by` / `requested_by`; no current-plan marker (`plan_variants.is_final` was dropped in 2026-06). → S-404, S-407.
- **Account self-service:** absent — only sign-in and sign-out; no password-change, reset or display-name code. → S-401, S-402.
- **Email:** partial — local Mailpit only; hosted SMTP not configured, `site_url` on a dead port, 6-character password minimum, no templates, no sending code. → S-401, S-402.
- **Secret-holding lifecycle component:** absent — no `supabase/functions/`; CI excludes the edge runtime and has no functions deploy step. → S-409.
- **Read-only surfaces:** partial — `src/widgets/timetable-board` is already a read-only board reused by the perspective views; no `canEdit` gating anywhere; nav items carry no gating; proposal delivery-on-visit writes under the visitor's session. → S-405.
- **Role-aware test harness:** partial — every integration suite runs as service-role (bypasses RLS); the only signed-in precedent is `src/test/solver-credential.integration.test.ts`; one e2e account with no role; CI excludes Mailpit; no `supabase db lint`. → S-403 (then S-405, S-406 add viewer and admin accounts).

**Constraints that bind every slice:** migrations auto-deploy on merge and must be safe against live data on their own; no merge while a production solve runs; hosted auth settings (Site URL, redirects, SMTP, templates, password policy) change by hand, never `config push`; no secret key in the app Worker (decision of record); all four CI lanes stay green.

## Foundations

None in this milestone. Each cross-cutting element is introduced by the first slice that needs it, so no layer is built ahead of a user-visible capability:

- the role-matrix test harness (a real signed-in client per role) → first phase of **S-403**, before its policy migration, so its first red run proves it can fail;
- the email channel (sending provider and domain, hosted mail settings, templates, the scanner-safe confirm page) → **S-402**;
- the readable list of school users and the access-change record → **S-406**;
- the secret-holding lifecycle component, its toolchain boundary and CI deploy → **S-409**.

A foundation was considered for each and rejected: postponing none of them makes its first consuming slice unplannable, unsafe or unverifiable.

## Slices

### S-401: Account self-service

- **Outcome:** Any user can open an account page from the sidebar, change their own password and set a display name; a password shorter than 15 characters is refused.
- **Change ID:** account-self-service
- **PRD refs:** FR-411, FR-413, §NFG (passwords ≥ 15)
- **Prerequisites:** —
- **Parallel with:** S-404
- **Blockers:** —
- **Unknowns:**
  - Current-password rule — the research's decided scope says to enable hosted "Require current password", but the PRD later dropped that rule (FR-411's resolution: it would block a user arriving from a reset link). The PRD supersedes; the plan confirms the hosted toggle stays off and records the accepted session-hijack trade-off. — Owner: plan phase. Block: no.
  - The display name must live where the Users list (S-406) and "Created by" (S-407) can later read it for every user, not only the signed-in one. — Owner: plan phase. Block: no.
- **Risk:** The smallest valuable slice: it needs no role, no email and no secret, so it can start now. It closes the provisioning runbook's "change the password" step that no screen allows today, and it is the first place a password is set, so the 15-character minimum lands here (local config, and the hosted setting by hand) and every later password path inherits it. A developer's own solver machine password under 15 characters would be refused on re-provisioning.
- **Status:** ready

### S-402: Forgot password by email

- **Outcome:** Any user can request a password reset from the sign-in page, receive the email in a real school inbox, open a confirm page that consumes the link only on a deliberate click (a mail scanner opening it does not), and set a new password; a flood of reset requests cannot stop a genuine staff member from resetting, and the email carries no student data.
- **Change ID:** forgot-password-by-email
- **PRD refs:** FR-412, FR-418, §NFG (link lifetime, reset flood, no student data, inbox delivery)
- **Prerequisites:** S-401, a sending-provider account and sending-domain DNS records (set up by hand)
- **Parallel with:** S-403, S-404, S-405, S-406, S-407, S-408, S-409, S-411
- **Blockers:** A real staff mailbox at the school for the delivery smoke test — the coordinator's own inbox suffices, but it sits in the school's M365 tenant, outside the developer's control.
- **Unknowns:**
  - Email-link lifetime — the platform has one lifetime for every email link, so "invite 72 h, reset 1 h" cannot both hold (Open Roadmap Question 2). — Owner: user. Block: yes.
  - Which guard against reset flooding: a CAPTCHA on the public endpoint, or a paid sending tier that lifts the 100-per-day cap. — Owner: plan phase. Block: no.
- **Risk:** The head of the external-risk track (`top_blocker: external`): the first email the product ever sends, through DNS and hosted mail settings changed by hand, into a school tenant whose link scanners can consume one-time links. Sequenced straight after S-401 — and its by-hand provider and DNS setup can begin before S-401 lands — so delivery and scanner surprises surface while the invite flow (S-410) is still far off. Widens the deny-by-default allowlist for the first time since sign-in, with a recorded reason.
- **Status:** blocked

### S-403: Fail-closed roles

- **Outcome:** Every person's access follows the one role an admin assigned. On the day it goes live, every existing author sees and edits everything as before — Generate → solve → proposal → delivery included — the developer is admin through a documented operator step, and a signed-in user without a role sees only a "no access yet — ask your admin" notice plus their own account. A role change takes effect on the person's next action, and drag-drop validation stays under 200 ms.
- **Change ID:** fail-closed-roles
- **PRD refs:** FR-410, FR-416, FR-417, FR-418, §Guardrails, §NFG (role change on next action, < 200 ms)
- **Prerequisites:** S-401
- **Parallel with:** S-402, S-404
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The riskiest slice, and the reason it comes first under `main_goal: quality`: it rewrites every human-facing database rule (17 `using (true)` policies today) to fail-closed on live school data, and migrations auto-deploy on merge, so the migration must be safe on its own. Two things make it verifiable rather than hopeful. First, a role-matrix harness that signs in a real user per role lands before the policy change, so its first red run proves it can fail (today no test can see these rules). Second, the e2e account gets its role in the same PR, or `e2e` goes red and blocks `deploy`. The live role-reading helper is the repo's first scoped exception to "no SECURITY DEFINER", recorded per CLAUDE.md. Side effect worth naming: the role-less solver machine user loses its fallback to full read if the token hook is ever off. Restricting who may stop a job is not here — that is S-407.
- **Status:** proposed

### S-404: Current-plan marker

- **Outcome:** An author can mark one plan as the current one, and every user sees which plan is current, on the plans list and on the plan itself.
- **Change ID:** current-plan-marker
- **PRD refs:** FR-420
- **Prerequisites:** —
- **Parallel with:** S-401, S-402, S-403, S-406, S-407, S-408, S-409, S-411, S-310
- **Blockers:** —
- **Unknowns:**
  - What happens to the marker when the current plan is deleted, and whether a pending proposal can carry it. — Owner: plan phase. Block: no.
- **Risk:** Small and independent, so it runs beside the first slices; it exists so the viewer slice (S-405) has something to label drafts and proposals against. The PRD accepts that any author can move the marker. If it lands before S-403, any signed-in user can move it (today everyone is an author); S-403's write rules then cover it.
- **Status:** ready

### S-405: Viewer reads everything read-only

- **Outcome:** A viewer can read every plan and proposal, including the teacher and student perspective views, export timetables and use the comparison page, with no edit affordance anywhere, and can always tell a proposal or draft from the plan marked current.
- **Change ID:** viewer-read-only
- **PRD refs:** FR-409
- **Prerequisites:** S-403, S-404
- **Parallel with:** S-402, S-406, S-407, S-408, S-409, S-411, S-310
- **Blockers:** —
- **Unknowns:**
  - Delivery when a viewer is the first to open a finished proposal: delivery runs under the visitor's own session, and a viewer cannot write (Open Roadmap Question 1). — Owner: user. Block: yes.
- **Risk:** A wide UI sweep — plan detail (drag-drop, shelf, Generate/Stop), the catalog pages and the plans list all need gating, and nav gains per-item gating. The read-only board the perspective views already share keeps it from becoming a rebuild. The hidden hazard is the writes that run under the visitor's session on page load (proposal delivery, the delivered-notice flag, interrupted-job marking): under a viewer they would fail or must be skipped, which is exactly what Question 1 decides. Adds a viewer e2e account.
- **Status:** blocked

### S-406: Users page — list and roles

- **Outcome:** An admin can open a Users page listing the school's users — display name beside email, role and status; machine users never appear, and the calibration-campaign account appears labelled as a service account — and can change anyone's role. The last active admin cannot be demoted, and every role change records who made it and when.
- **Change ID:** users-page-roles
- **PRD refs:** FR-405, FR-406, FR-408, FR-413, §NFG (access changes traceable)
- **Prerequisites:** S-403
- **Parallel with:** S-402, S-404, S-405
- **Blockers:** —
- **Unknowns:**
  - Where the access-change record is shown — on the Users page, or only queryable. — Owner: plan phase. Block: no.
- **Risk:** The first admin-only surface, and it needs no secret: role writes run under the admin's own session with the database rules deciding. It introduces the readable list of school users that "Created by" (S-407) and every lifecycle slice reuse, and starts the access-change record those slices append to. It can run beside S-405; until S-405 lands, a user switched to viewer is refused every write but still sees edit controls — acceptable while no real viewers exist. Adds an admin e2e account.
- **Status:** proposed

### S-407: Created-by and job ownership

- **Outcome:** Any user can see who created each plan and proposal — a proposal is credited to whoever pressed Generate, and plans that predate the change show "unknown" — and a running generation job can be stopped only by the person who requested it or an admin; jobs that predate the change stay stoppable by any author.
- **Change ID:** created-by-and-job-ownership
- **PRD refs:** FR-415, FR-416, FR-417
- **Prerequisites:** S-406
- **Parallel with:** S-402, S-404, S-405, S-408, S-409, S-410, S-411
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Touches the generation path (the proposal clone and the job record), so FR-417's "generation works end to end" guardrail is the one to re-prove. Attribution on shared data must never take timetables with it: deleting a person clears the credit, never the plan. The job's recorded requester is also the recipient S-310 needs.
- **Status:** proposed

### S-408: Deactivate and reactivate

- **Outcome:** An admin can deactivate and reactivate a user; a deactivated person's data access ends on their next action, and they land on the "no access yet" notice.
- **Change ID:** deactivate-reactivate
- **PRD refs:** FR-407
- **Prerequisites:** S-406
- **Parallel with:** S-402, S-404, S-405, S-407, S-409, S-410, S-411, S-310
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This PRD's one nice-to-have — skippable without touching the success criteria. Its value is immediacy: a ban or delete (S-411) leaves an already-issued session working for up to an hour, and this closes that gap. A deactivated admin must stop counting as "active" for the last-admin rule S-406 introduces.
- **Status:** proposed

### S-409: Create an account with a temporary password

- **Outcome:** As a fallback when an invitation cannot reach someone, an admin can create an account with a temporary password from the Users page; the person must change it at first sign-in, and the new account appears in the Users list.
- **Change ID:** create-account-fallback
- **PRD refs:** FR-403
- **Prerequisites:** S-401, S-406
- **Parallel with:** S-402, S-404, S-405, S-407, S-408, S-310
- **Blockers:** —
- **Unknowns:**
  - Hosted signing-key state — hosted publishes only an ES256 key, but the dashboard must confirm it is the current key and that the new API keys are enabled, because the lifecycle component rejects legacy tokens. — Owner: developer. Block: no.
- **Risk:** Introduces the milestone's one new trusted component. Account operations need the platform's secret key, and the decision of record keeps that key out of the app Worker, so it lives in a separate secret-holding component with a live admin check — a new runtime, a new toolchain boundary and a new CI deploy step. Proving it on the simplest operation (no email) leaves the north star with email as its only new risk. The PRD frames this path as a fallback only, not a second normal onboarding route, and machine users must be untouchable through it.
- **Status:** proposed

### S-410: Invite a colleague by email _(north star)_

- **Outcome:** An admin invites a colleague by email with a role chosen up front; the colleague receives the invitation, confirms on a page that needs a deliberate click (a mail scanner opening the link does not consume it), sets a password and lands with that role — read-only for a viewer — and the admin sees them in the Users list. The admin can re-send or revoke a pending invitation; an expired or used link says "ask your admin to re-send"; inviting an address that already has an account is refused with a clear message and creates no duplicate.
- **Change ID:** invite-by-email
- **PRD refs:** FR-401, FR-402, FR-404, FR-418, US-401, §NFG (invite lifetime, inbox delivery, no student data)
- **Prerequisites:** S-402, S-405, S-409
- **Parallel with:** S-407, S-408, S-411, S-310
- **Blockers:** —
- **Unknowns:**
  - Email-link lifetime (Open Roadmap Question 2) — under option (a) invitations rely on re-send; under (b) they carry their own 72-hour expiry. — Owner: user. Block: yes.
- **Risk:** Last on its chain by design: each prerequisite retires one risk (S-402 delivery and the scanner-safe confirm page, S-405 the read-only landing, S-409 the secret-holding component), so what remains is the invitation template, its acceptance and re-send/revoke. Revoking a pending invitation is this slice's share of FR-404; removing confirmed accounts is S-411's. Widens the public-route allowlist once more, with a recorded reason. Its demonstration on hosted against a real school mailbox is the milestone's done-line.
- **Status:** blocked

### S-411: Remove and correct accounts

- **Outcome:** An admin can ban or delete a confirmed account and change a user's email address; a removed person's access ends within an hour at most, machine users cannot be touched, deleting a person never deletes a timetable, and every change records who made it and when.
- **Change ID:** remove-and-correct-accounts
- **PRD refs:** FR-404, FR-414, §NFG (removal ≤ 1 h, access changes traceable)
- **Prerequisites:** S-409
- **Parallel with:** S-402, S-404, S-405, S-407, S-408, S-410, S-310
- **Blockers:** —
- **Unknowns:**
  - Whether hosted auth rejects tokens issued before a ban (the platform's latest source does; local v2.189.0 does not). The one-hour guardrail holds either way through token expiry. — Owner: plan phase. Block: no.
- **Risk:** Delete is irreversible, which is why it reuses the component S-409 already proved instead of introducing it. Both operations maintain existing accounts and share one risk: keeping the Users list in step with the platform's own user records. Revoking a pending invitation belongs to S-410.
- **Status:** proposed

### S-310: Job-completion email _(carried from M-01)_

- **Outcome:** An author is notified on job completion with the result information by email as well as in-app, so "kick it off and walk away" works for a long solve; the email carries no student data.
- **Change ID:** job-completion-email
- **PRD refs:** FR-309 (archived CP-SAT PRD), §NFG (no student data)
- **Prerequisites:** S-402, S-407
- **Parallel with:** S-404, S-405, S-408, S-409, S-410, S-411
- **Blockers:** —
- **Unknowns:**
  - A trigger that fires with no tab open (carried from M-01): nothing today notices a completed job without a browser, and the Worker's only database client is bound to a request's cookies. Under fail-closed roles the notifier also needs its own narrow read identity — never the secret key in the Worker. — Owner: plan phase. Block: no.
- **Risk:** Nice-to-have, last, and skippable without touching either milestone's success criteria. Moved here from M-01 because it now shares this milestone's sending provider and domain (S-402) and needs the job's recorded requester as its recipient (S-407).
- **Status:** proposed

## Backlog Handoff

Handed off to GitHub 2026-10-10: milestone **"User management & privileges"**, tracking issue [#153](https://github.com/dobrek/ib-timetable-planner/issues/153) (dependency-ordered checklist). One issue per item, below; `S-310` kept its M-01 issue. The Notes column maps the tasks gathered in `context/changes/user-managment-research/change.md` (health-check fixes, "HC Fix N") to the slice that carries them.

| Roadmap ID | Change ID                    | Issue | Suggested issue title                                                        | Ready for `/10x-plan` | Notes |
| ---------- | ---------------------------- | ----- | ---------------------------------------------------------------------------- | --------------------- | ----- |
| S-401      | account-self-service         | [#142](https://github.com/dobrek/ib-timetable-planner/issues/142) | Account page: change own password, display name, 15-character minimum       | yes                   | Run `/10x-plan account-self-service`. Carries HC Fix 4's password minimum (local; hosted by hand), HC Fix 8 (`pnpm db:types`) if it adds a migration, and HC Fix 10 (`.editorconfig`) as any-time hygiene |
| S-402      | forgot-password-by-email     | [#143](https://github.com/dobrek/ib-timetable-planner/issues/143) | Forgot password by email via a scanner-safe confirm page                     | no                    | Blocked on Open Roadmap Question 2; after S-401. Carries HC Fix 4 (Site URL, redirect allowlist, `[local_smtp]`), HC Fix 6's CI mail capture, the research's sending-provider setup checklist and M365 smoke test, and CLAUDE.md's email-flow rules. By-hand provider/DNS setup can start now |
| S-403      | fail-closed-roles            | [#144](https://github.com/dobrek/ib-timetable-planner/issues/144) | Fail-closed roles: authors unchanged, no role → "no access yet"              | no                    | After S-401. Carries HC Fix 1 (role-matrix harness, landed first), HC Fix 2 (role-aware e2e account, same PR), HC Fix 3's role rules for CLAUDE.md, HC Fix 7 (SQL lint gate), and the bootstrap runbook step |
| S-404      | current-plan-marker          | [#145](https://github.com/dobrek/ib-timetable-planner/issues/145) | Mark one plan as current, visible to everyone                                | yes                   | Run `/10x-plan current-plan-marker`. Independent; any order with S-401 |
| S-405      | viewer-read-only             | [#146](https://github.com/dobrek/ib-timetable-planner/issues/146) | Viewer role: read every plan and proposal, no edit affordances               | no                    | Blocked on Open Roadmap Question 1; after S-403 + S-404. Adds the viewer e2e account |
| S-406      | users-page-roles             | [#147](https://github.com/dobrek/ib-timetable-planner/issues/147) | Users page: list users, change roles, last-admin guard, access-change record | no                    | After S-403. Adds the admin e2e account |
| S-407      | created-by-and-job-ownership | [#148](https://github.com/dobrek/ib-timetable-planner/issues/148) | "Created by" on plans and proposals; stop limited to requester or admin      | no                    | After S-406 |
| S-408      | deactivate-reactivate        | [#149](https://github.com/dobrek/ib-timetable-planner/issues/149) | Deactivate / reactivate a user with immediate cut-off                        | no                    | After S-406; nice-to-have |
| S-409      | create-account-fallback      | [#150](https://github.com/dobrek/ib-timetable-planner/issues/150) | Admin creates an account with a temporary password (fallback)                | no                    | After S-401 + S-406. Carries HC Fix 6 (toolchain boundary, CI deploy for the new component) and CLAUDE.md's component section |
| S-410      | invite-by-email              | [#151](https://github.com/dobrek/ib-timetable-planner/issues/151) | Invite a colleague by email; confirm, set password, land with role           | no                    | North star. Blocked on Open Roadmap Question 2; after S-402 + S-405 + S-409 |
| S-411      | remove-and-correct-accounts  | [#152](https://github.com/dobrek/ib-timetable-planner/issues/152) | Ban, delete and change email for existing accounts                           | no                    | After S-409 |
| S-310      | job-completion-email         | [#107](https://github.com/dobrek/ib-timetable-planner/issues/107) | Email notification on job completion                                         | no                    | After S-402 + S-407; nice-to-have |

## Open Roadmap Questions

1. **Delivery when a viewer opens a finished proposal first** (PRD Open Question 1). Delivery runs under the visitor's session, and a viewer cannot write. Should delivery wait for the next author or admin visit (today's mechanism), or happen regardless of who looks (a bigger change to FR-417)? — Owner: user. Block: S-405 (and S-410 through it).
2. **Email-link lifetime vs the platform's single setting** (PRD Open Question 2). One lifetime governs invite, reset and email-change links, and a value above one day is discouraged and settable only through the Management API, so "invite 72 h, reset 1 h" cannot both hold. Options: (a) one lifetime for all links, e.g. 24 h — invitations lean on re-send and the reset guardrail relaxes to match; (b) resets stay at 1 h and invitations use app-issued tokens with their own 72-hour expiry — more code and a new token table; (c) 72 h for all links through the Management API — discouraged, and it weakens resets. The health check calls (a) the smallest change that keeps the PRD's intent; the choice may amend the non-functional guardrail. — Owner: user. Block: S-402, S-410.

## Parked

- **Multiple schools / tenancy** — Why parked: PRD §Non-Goals; standing non-goal, unchanged.
- **Folding the solver ops allowlist into `admin`** — Why parked: PRD §Non-Goals; the ops page keeps its own operator list so it works even if role data is broken.
- **Student or parent accounts** — Why parked: PRD §Non-Goals; accounts are for staff only.
- **Bulk staff import or school-system sync** — Why parked: PRD §Non-Goals; the admin onboards people one at a time.
- **Per-plan sharing / ownership (model B)** — Why parked: PRD "deliberately not ruled out"; the role helpers can grow a per-plan argument later.
- **Custom roles or a permission editor** — Why parked: PRD "deliberately not ruled out"; three roles do not need one.
- **Single sign-on with the school's identity provider; multi-factor sign-in** — Why parked: PRD "deliberately not ruled out".
- **One-major dependency bumps** (`@astrojs/react` 7, `vitest` 5, `jsdom` 30, `typescript` 7, and others) — Why parked: health check Fix 9 defers them until after this milestone, one per PR, outside a production solve.
- **M-01's parked items and follow-ups** (off-Cloudflare hosting, push-based progress, parallel jobs per plan, the objective tuple on the wire, the never-exercised deploy-during-solve rescue path, and others) — Why parked: outside this milestone's PRD; recorded in the archived M-01 roadmap.

## Milestone History

- **M-01: CP-SAT solver service** (`cp-sat-solver-service`) — closed 2026-10-10. CP-SAT became the engine of record: frozen wire contract and jobs schema, the solver as a Cloudflare Container deployed on merge, staged progress with checkpoints, job-aware lifecycle, stop & keep, proposal-as-plan delivery, launch-time policy choice, production-calibrated budgets, and the greedy engine deleted (11 of 12 items done). S-310 (job-completion email, unstarted) moved to M-02. Full roadmap archived at `context/foundation/archive/2026-10-10-roadmap-cp-sat-solver-service.md`.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)
