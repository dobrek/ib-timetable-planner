---
date: 2026-08-31T16:20:00+02:00
researcher: Dobromir Kropielnicki
git_commit: ff609de271ed7a5a02ffb19ca79bffcbb08e834b
branch: main
repository: ib-timetable-planner
topic: "Deleting a plan corrupts its generation job's state — the delivered-proposal false failure, and the stranded pending orphan"
tags: [research, codebase, generation, deletion, foreign-keys, generation-jobs]
status: complete
last_updated: 2026-08-31
last_updated_by: Dobromir Kropielnicki
---

# Research: plan deletion vs. generation job state

**Date**: 2026-08-31T16:20:00+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `ff609de271ed7a5a02ffb19ca79bffcbb08e834b`
**Branch**: `main`
**Repository**: `ib-timetable-planner`

> Split out of `context/changes/extract-share-polling-store/research.md` on 2026-08-31, where both
> defects were found while researching the proposal provenance note. That change keeps the F6
> polling-store factory and the acknowledgement UX; this one owns the deletion aftermath. The two
> share no files.

## Research Question

What happens to a `generation_jobs` row, and to the UI reading it, when one of the two plans it names
is deleted? Specifically: is any reachable delete able to leave the job row — or a plan — in a state
the UI misreports?

## Summary

**Yes, in two ways, and one is confirmed by reproduction.**

**D2 — a delivered proposal's deletion flips its job to `failed`.** Delete a proposal plan after its
board has been delivered (permitted; nothing warns) and `delivered_plan_id` is `SET NULL`. That makes
`isDeliverableJob` true again for a `succeeded` row, so the **source** plan's next visit re-enters
`deliver()`, hits the null-proposal branch, and calls `failJob`. The author — who deliberately
rejected and deleted the proposal — is then shown a red *"Generation failed"* on the source plan for
a solve that worked, sticky across every later visit. The row is left internally contradictory:
`delivery='proposal'` (it did deliver) with `status='failed'` and `delivered_plan_id=null`.

**The stranded orphan — a source's deletion can leave a clone permanently pending.** When the job is
`running` but stale past the heartbeat grace, `assertNoActiveJob` lets the source delete through. The
job row cascades away (`plan_id … on delete cascade`), leaving the clone with `pending_proposal = true`
and no job. Every edit path refuses a pending plan, so the plan renders *"This proposal is still being
generated. Its status could not be read just now"* forever and can only be deleted, never used.

**Both fixes are small, and D2's needs no migration.** `delivery` (`null | 'proposal'`, set by
`markDelivered` in the same CAS as `delivered_plan_id`) is already a durable "was delivered at least
once" fact that no foreign key can null, and it is already fetched in `STATUS_COLUMNS`.

**Neither is recorded anywhere in `context/`, and no roadmap slice owns them.** S-306 guarded three
adjacent cases and stopped one short of each of these.

---

## Detailed Findings

### 1. The root cause: `delivered_plan_id` conflates a fact with a link

```sql
-- supabase/migrations/20260810200122_generation_jobs.sql:57-98
plan_id           uuid not null references plans(id) on delete cascade,
proposal_plan_id  uuid          references plans(id) on delete set null,
delivered_plan_id uuid          references plans(id) on delete set null,
```

The asymmetry is deliberate, and the migration argues for it in its own header (`:36-41`):

> *"`proposal_plan_id` and `delivered_plan_id` are `on delete set null`, where 41 of 43 FKs in this
> schema cascade. S-306 deletes the working clone on auto-apply; a cascading FK would take the job row
> with it and erase the record of every successful generation. **The job must outlive the plans it
> produced.** `plan_id` DOES cascade — it is the source plan, and the test harness's teardown relies
> on every domain table cascading from `plans.id`."*

The reasoning is sound; the consequence was not followed through. `delivered` is derived as
`row.delivered_plan_id !== null` (`generation-delivery.ts:573`), so `SET NULL` erases **the fact that
delivery happened** along with the pointer to where it landed. The job outlives the plan, but not the
knowledge that it succeeded.

`delivery` is the fact that actually survives — written by `markDelivered` in the same statement, with
a comment saying exactly why (`generation-delivery.ts:518-528`):

```ts
// `delivery` rides along in the SAME update so the pair can never disagree — the vocabulary has
// exactly one value (`'proposal'`, checked in the schema) because the source is never a target.
.update({ delivered_plan_id: proposalPlanId, delivery: "proposal" })
.eq("id", jobId)
.is("delivered_plan_id", null);
```

The FK is the one thing that *can* make them disagree — which is why the disagreement is a precise
signature for "delivered, then the proposal was deleted".

### 2. D2 — confirmed by reproduction

**The chain**, all in `src/_pages/plan-detail/api/generation-delivery.ts`:

1. `pickJob:212-215` — `if (asSource && (isActiveJobStatus(...) || asSource.delivered_plan_id === null)) return asSource;`
   With `delivered_plan_id` nulled, the source's own job outranks everything and is tagged `role: "source"`.
2. `settle:230` — `if (isDeliverableJob(row)) return deliver(supabase, row.plan_id, row);`
   `isDeliverableJob` (`entities/timetable/model/generation/job-delivery.ts:35-37`) is
   `delivered_plan_id === null && status === "succeeded"` → **true again**.
3. `deliver:268-273` —
   ```ts
   if (proposalPlanId === null) {
     await failJob(supabase, row.id, "the proposal plan no longer exists, so the result cannot be delivered");
     return toView({ ...row, status: "failed" }, { kind: "unavailable" });
   }
   ```
4. `GenerationStatusStrip.tsx:80-90` renders the destructive red strip on the source plan.

**Reproduced against the local Supabase stack, 2026-08-31** (throwaway integration harness, since
removed). Fixture: a tiny two-cohort plan, enqueued through the real `startGeneration`, terminal row
written by hand as the solver would, delivered through the real `checkPlan`, then the proposal deleted:

```
[2] after deleting the proposal, job row =
    { status: 'succeeded', delivered_plan_id: null, proposal_plan_id: null,
      delivery: 'proposal', error: null }

[3] checkPlan(source) =
    { status: 'failed', role: 'source', delivered: false, error: null, … }

[3] job row now =
    { status: 'failed', delivered_plan_id: null, proposal_plan_id: null, delivery: 'proposal',
      error: 'the proposal plan no longer exists, so the result cannot be delivered' }
```

Asserted and passing: the flip happens, the row keeps `delivery: 'proposal'`, and the false failure is
**sticky** across subsequent `checkPlan` calls.

**Sub-finding — the first visit shows no reason at all.** The view returned by the *flipping* visit
carries `error: null`, because the branch returns `toView({ ...row, status: "failed" })`, spreading the
row as read **before** `failJob` wrote the message. Since the strip renders
``Generation failed{job.error ? `: ${job.error}` : "."}``, the author sees:

- **first visit after deleting:** a bare red **"Generation failed."**, with no explanation;
- **every visit after:** *"Generation failed: the proposal plan no longer exists, so the result cannot
  be delivered"* — which blames a generation for the author's own deliberate act.

**Why the guards miss it.** `delete-plan.ts:22-26` runs `assertNotPending` then `assertNoActiveJob`.
Once delivered, `pending_proposal` is false so `assertNotPending` returns early (`pending-guards.ts:46`),
and `assertNoActiveJob(proposalId)` finds nothing keyed on `plan_id` — the job's `plan_id` is the
*source*. The delete goes through unguarded, and is asserted as intended for the terminal case at
`plan-actions.integration.test.ts:291-296`.

**The codebase already made this argument, one case short.** `job-delivery.ts:99-103`:

> *"the plans hub refuses to delete a proposal whose board has **not been delivered yet**, because
> `proposal_plan_id` is `on delete set null` and `deliver()` on a null proposal marks the job failed —
> so a deliberate delete of a ready proposal would surface as **a red failure the author never caused**.
> … Once delivered the plan is no longer pending, so this guard is not consulted at all."*

That last sentence is the hole, stated by its own author as a fact about scope rather than a risk.

### 3. The stranded orphan

`proposalIsReleasable` (`pending-guards.ts:106-114`) returns `true` when `jobs.length === 0`, and its
docstring (`:95-98`) names this exact scenario:

> *"A clone whose job row is gone (**the source was deleted** before this guard existed, or a detach
> left it alone) must **always be deletable**, or the only way out is SQL."*

So the orphan was foreseen and made **deletable** — but not **usable**. With `pending_proposal` still
true, `src/pages/plans/[id]/index.astro` routes to `PendingProposalPage`, and with no job row
`checkPlan` returns null, so `PendingProposalPage.tsx:40-44` renders, permanently:

> *"This proposal is still being generated. Its status could not be read just now — refresh to try again."*

Nothing will ever generate it. The plan holds a real board (the clone carries the source's placements)
and cannot be opened, renamed, cloned or edited — only deleted.

Reachable whenever `assertNoActiveJob` admits a **stale** active job (`isStaleActiveJob`, past
`HEARTBEAT_GRACE_MS`) — which is deliberate, since a wedged job must not block deletion forever.

### 4. What is NOT a defect

**Deleting the source of a delivered proposal loses the provenance note, and that is correct.** The
job row cascades away (pinned by `src/test/generation-jobs.integration.test.ts:111-119`), so `checkPlan`
returns null and the "Generated from …" strip stops rendering. No dangling link is reachable — the link
and its row die together. The strip's purpose is navigational (its docstring: *"the only route back to
the source"*), FR-307 makes a delivered proposal *"an ordinary plan"*, and the clone's name
(`Proposal — <source>`) survives as the informational residue. Investigated and dismissed in the parent
change; recorded here so it is not re-raised.

---

## Recommendation

**Fix 1 — D2, no migration.** Add `delivery` to `DeliverableJobRow` and require `row.delivery === null`
in `isDeliverableJob`. That single edit reaches both consumers at once —
`generation-delivery.ts:230` and `pending-guards.ts:74,112` — which is precisely what the file's own
docstring demands (*"Two copies of this predicate drifting apart would either strand a deletable plan or
let a deliverable one be deleted"*). `delivery` is already in `STATUS_COLUMNS` (`:117`) and `StatusRow`
(`:125`), so nothing else changes shape.

Give `pickJob:213` the same discriminator, or an A→B→C chain (generate from a proposal, then delete C)
permanently hides B's provenance from A.

Also return the reason on the flipping visit — either re-read after `failJob` or set `error` in the
spread — so the strip never shows a bare "Generation failed."

**Fix 2 — the orphan.** When a pending proposal has no job row at all, clear `pending_proposal` so it
becomes an ordinary, usable plan. This finishes the thought `proposalIsReleasable` started: an orphan
must always be recoverable without SQL, and today it is only disposable.

**Tests — integration, not E2E.** One case in `plan-actions.integration.test.ts` beside the
pending-variant sibling at `:227-236`; one in `generation-delivery.integration.test.ts` beside the
delivered-row assertions at `:136`/`:252`/`:333`. E2E's critical path is ~444 s and
`e2e/specs/generation.spec.ts` already encodes the safe teardown order in a comment — the unsafe order
is the defect, and integration can assert it far cheaper.

**Open design question:** should `DeletePlanDialog` also name how many proposals were generated from
the plan being deleted? It is one count query and makes the act informed, but it is scope beyond
fixing the misreport.

---

## Code References

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/`

- [`supabase/migrations/20260810200122_generation_jobs.sql:36-41`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/supabase/migrations/20260810200122_generation_jobs.sql#L36-L41) — the FK-asymmetry rationale
- `20260810200122_generation_jobs.sql:57-98` — the table and its three plan FKs
- [`src/entities/timetable/model/generation/job-delivery.ts:35-37`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/entities/timetable/model/generation/job-delivery.ts#L35-L37) — `isDeliverableJob`; the docstring at `:99-103` states the failure mode one case short
- [`src/_pages/plan-detail/api/generation-delivery.ts:212-215`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/_pages/plan-detail/api/generation-delivery.ts#L212-L215) — `pickJob`
- `generation-delivery.ts:268-273` — the null-proposal `failJob` branch (D2's trigger)
- `generation-delivery.ts:518-528` — `markDelivered`, and the "the pair can never disagree" comment
- `generation-delivery.ts:117,125` — `STATUS_COLUMNS` and `StatusRow`, both already carrying `delivery`
- [`src/_pages/plans-list/api/delete-plan.ts:22-26`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/_pages/plans-list/api/delete-plan.ts#L22-L26) — the two guards
- `src/_pages/plans-list/api/pending-guards.ts:95-114` — `proposalIsReleasable` and the orphan docstring
- `src/_pages/plan-detail/ui/PendingProposalPage.tsx:40-44` — the permanent "still being generated" panel
- `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:80-90` — the destructive strip D2 lights up
- `src/test/generation-jobs.integration.test.ts:111-138` — the two FK-semantics tests

## Architecture Insights

- **A column that is both a fact and a foreign key cannot survive `ON DELETE SET NULL` intact.**
  `delivered_plan_id` answers "did it deliver?" and "where?" at once; nulling the link retracts the
  answer to both. `delivery` is the fact half, already present — the schema is one rename away from
  saying so out loud.
- **The delete path guards liveness and pendingness, but has no notion of *aftermath*.** Both existing
  guards ask "is something in flight?", never "what will this row mean once the plan is gone?"
- **The guard authors reasoned to the edge of both defects and stopped.** `job-delivery.ts:99-103`
  describes D2's mechanism for the undelivered case; `pending-guards.ts:95-98` foresees the orphan and
  makes it deletable. Each is one sentence short of the fix.

## Historical Context (from prior changes)

- `context/archive/2026-08-25-drift-decided-delivery/reviews/plan-review.md:36-45` (F2, CRITICAL) —
  deleting the source **mid-solve** strands the proposal; fixed.
- `.../reviews/plan-review.md:47-56` (F3) — deleting a deliverable-but-undelivered **proposal** would
  surface a red failure; fixed by refusing with *"open the proposal to deliver it first"*. D2 is the
  same finding for the delivered case.
- `.../reviews/impl-review.md:25-37` (F1, WARNING) — deleting the source loses a finished-but-undelivered
  solve; fixed by widening `assertNoActiveJob` to `isDeliverableJob`.
- `.../plan.md:107-108` — *"No retention policy for proposals — the author keeps them and cleans up by
  hand; Delete is the act."* Deletion is the sanctioned workflow, so **blocking** it is never the fix here.
- `context/foundation/prd.md:399-407` (FR-307) — the proposal is a plan; the source is never written to.
- No FR governs plan deletion or proposal retention, and no roadmap slice (S-305/307/308/310) owns it.

## Related Research

- `context/changes/extract-share-polling-store/research.md` — the parent investigation: F6 feasibility,
  the provenance note's lifecycle, and the acknowledgement persistence comparison. §3 there carries the
  same FK analysis from the provenance angle.

## Open Questions

1. Should `pickJob` use the same `delivery` discriminator as `isDeliverableJob`, or is the A→B→C
   provenance-hiding case rare enough to leave? (Recommendation says fix both; it is one expression.)
2. Should the orphan fix clear `pending_proposal` silently, or tell the author what happened
   ("its generation was interrupted when the source plan was deleted")?
3. Is `delivery` the right long-term home for the delivered fact, or should it be renamed
   (`delivered_at`) so the schema stops reading as a vocabulary column doing double duty?
4. Should `DeletePlanDialog` name the proposals generated from the plan being deleted?
