# The Proposal Is a Plan (S-306) — Plan Brief

> Full plan: `context/changes/drift-decided-delivery/plan.md`
> Frame brief: `context/changes/drift-decided-delivery/frame.md`
> Research: `context/changes/drift-decided-delivery/research.md`

## What & Why

S-306 was specified as drift-decided auto-apply; the frame re-grounded it this morning to
author-decided merge-or-keep. During planning the author simplified it once more: **the proposal is
a plan.** Generate clones the source (as today) but the clone is *pending* — listed, openable
read-only with progress, refused by every edit path — until the verified board lands on it, after
which it is an ordinary plan. The source is never written to. Rename and delete are the acts.

The frame's problem statement still holds: the review path is 100% of runs. This shape answers it by
making the reviewed thing a first-class plan, instead of building a decision surface around it.

## Starting Point

The delivery pipeline (verify → translate → apply → mark) is built and idempotent, but it is keyed by
the **source** plan and fires only on a visit there; the clone exists from the first second with no
reader and no guard; all status surfaces sit on the source row; `notified_at` and `delivery` are
unused; the E2E lane has no solver.

## Desired End State

Press Generate → the hub shows `Proposal — P` with a live badge → open it and see progress → it
delivers itself and becomes the board → the hub says "Ready — open" (durably) and toasts → compare,
rename, keep or delete. `P` is untouched throughout. A failed solve is swept and reported on `P`'s
strip. Generate has a Playwright spec that drives this end to end.

## Key Decisions Made

| Decision                  | Choice                                                         | Why (1 sentence)                                                                                                    | Source |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| Delivery model            | Proposal is a plan; **no merge, no drift gate**                | Merge ≡ delete-source + rename-proposal in the author's no-edit workflow; gated and rare otherwise.                 | Plan   |
| Materialisation           | Clone at dispatch, **pending until delivered**                 | Keeps the proposal T0-faithful and the tested pipeline intact; closes the editable in-flight window.               | Plan   |
| Pending appearance        | Listed, openable read-only with progress; edits refused        | A visible plan the hub links to must open somewhere; that page has no board so it may poll and deliver.            | Plan   |
| Where status lives        | On the proposal row; source shows advisory (active) + failures | The proposal is where the result appears; the source only needs FR-308's advisory and a home for failures.        | Plan   |
| Notification              | Durable hub badge (row state) + toast on transition            | A row transition is what S-310's emailer can extend; a toast is a free by-product of the poll.                    | Plan   |
| Delete while pending      | Refused while active-and-not-stale or deliverable-undelivered  | A wedged or failed proposal must always be removable by hand; a ready one is opened (delivered) first.             | Plan   |
| Delete of the source      | Refused while its job is active-and-not-stale                  | `plan_id` cascades: deleting the source mid-solve would drop the job row and strand the clone pending.             | Review |
| Dominance                 | S-307's                                                        | Exists at no layer; not load-bearing for a single-result review.                                                    | Frame  |
| Headless trigger          | S-310's                                                        | Only the notifier needs a no-tab actor, and it needs a read-only identity.                                          | Frame  |
| E2E for Generate          | Boot the native solver in the e2e CI job                       | The integration job already has the recipe; the fixture solves in ~2 s.                                             | Plan   |
| Dead client-apply code    | Delete `liveState`/`stage`/`settle`/`failGenerated`            | Kept three slices "for S-306"; S-306 has no client-side apply. The action stays (undo/redo binds it).              | Plan   |

## Scope

**In scope:** foundation re-ground; `plans.pending_proposal` + `delivery` CHECK migration; enqueue
sets / delivery clears the flag; `stopped`-with-checkpoint deliverable; proposal-keyed
dual-keyed `checkPlan` (source or proposal id, role-tagged; replaces `checkGeneration`); pending page island (polls, delivers, reloads); guards on 7 by-id routes and 3 plan
actions; strip split (source vs proposal); hub indicators keyed by proposal, terminal-undelivered and
ready-unnotified rows read durably, toast, `notified_at` first writer; e2e solver + `generation.spec.ts`.

**Out of scope:** merge, drift gate or advisory, dominance, any clock/identity, retention policy,
RPC/contract changes, guards on individual board-mutation actions, `stopped` producer (S-305).

## Architecture / Approach

Keep the pipeline; move three things around it. **Marker**: `plans.pending_proposal`, set right after
`clone_plan` in enqueue, cleared after the region-replace and before the delivered CAS. **Key**: one
`settle()` core reached by one dual-keyed `checkPlan({planId})` on every plan visit (`plan_id OR proposal_plan_id`, role-tagged)
(proposal visit; the pending island calls it on a 5 s timer and navigates on delivery). **Surfaces**:
indicators carry both ids and render on the proposal row (falling back to the source row when the
proposal row is not yet loaded — the two-tab hole); the hub loader reads active, terminal-undelivered
and delivered-unnotified jobs so "Ready" survives reloads; `checkPlan` (proposal role) writes `notified_at` on
first view.

## Phases at a Glance

| Phase                       | What it delivers                                                        | Key risk                                                     |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1. Foundation re-ground     | PRD/roadmap/README/change.md current before code                        | Leaving a stray "merge" sentence that a later reader trusts  |
| 2. Schema + lifecycle       | Flag + vocabulary; enqueue sets, every terminal path clears/sweeps      | A branch that leaves a clone alive but still pending         |
| 3. Proposal-keyed delivery  | dual-keyed `checkPlan`, pending page, 10-surface guard, strip split            | A missed by-id surface lets an in-flight clone be edited     |
| 4. Hub notification         | Badge on the proposal row, durable ready state, toast, `notified_at`    | Two-tab discovery when the proposal row is not loaded        |
| 5. E2E lane                 | Solver in the e2e job; Generate → board in a browser                    | `.dev.vars` written after the build (the S-302 lesson)       |

**Prerequisites:** local Supabase + `mise run solver:dev` for phases 2–5; Docker-free otherwise.
**Estimated effort:** ~5 sessions, one per phase; Phase 3 is the largest.

## Open Risks & Assumptions

- The guard surface is enumerated from today's routes; a future plan-scoped page must remember
  `isPendingProposal`. The roadmap's S-306 Risk line is rewritten to say exactly this.
- Board-mutation actions are not individually guarded (unreachable without a rendered board). If a
  direct action call on a pending plan ever matters, guard `placeCourse` and friends behind the same
  predicate.
- Pre-existing delivered jobs have `delivery = null`; the migration backfills `notified_at` so the
  new hub branch does not badge them.
- Issue #103's title/body still describe auto-apply — update it when the PR opens.

## Success Criteria (Summary)

- A solve never touches the source plan, and no path can edit the proposal before its board lands.
- "Ready" on the hub survives a reload until the proposal is opened once; an open hub toasts.
- `pnpm test:e2e` drives Generate → pending → board against a real solver in CI.
