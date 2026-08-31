# Generation Deletion Integrity — Plan Brief

> Full plan: `context/changes/generation-deletion-integrity/plan.md`
> Research: `context/changes/generation-deletion-integrity/research.md`

## What & Why

Deleting a plan can leave `generation_jobs` in a state the UI misreports, two ways. **D2** (reproduced
on the local stack): deleting a delivered proposal flips its `succeeded` job to `failed`, so the source
plan shows a sticky red "Generation failed" for a solve that worked — and, as verified during
planning, also blocks deleting the source with a dead-end "open the proposal to deliver it first".
**The stranded orphan**: deleting a source whose job is stale-`running` cascades the job row away,
leaving the clone `pending_proposal = true` forever — a permanent "still being generated" page that
can only be deleted, never used.

## Starting Point

`delivered_plan_id` conflates a fact ("did it deliver?") with a link ("where?"), and its
`ON DELETE SET NULL` FK erases both — making `isDeliverableJob` true again and re-entering the
delivery pipeline's fail-on-missing-proposal branch. Meanwhile the `delivery` column (written
atomically with the pointer by `markDelivered`, immune to the FK) already records the durable fact.
The orphan was foreseen by `proposalIsReleasable`'s author and made *deletable*, but never *usable*.

## Desired End State

Deleting a delivered proposal is uneventful: the job row stays `succeeded`, the source shows nothing
(its documented delivered behavior), the source stays deletable, and chained provenance (A→B→C, C
deleted) survives. A pending proposal with no job silently becomes an ordinary plan on its next visit,
rendering the board it holds.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| D2 mechanism | `isDeliverableJob` requires `delivery === null` | The durable delivered-fact no FK can null; already in every projection | Research |
| `pickJob` | Same discriminator, same commit | Two notions of "undelivered" in one file is the drift its docstring warns against | Plan |
| Orphan fix locus | Lazy, on visit (route + new `releaseOrphanProposal`) | Heals all orphans regardless of cause, mirroring on-visit delivery/sweeping | Plan |
| Orphan race guard | `created_at < stalenessCutoff(now)` in the UPDATE | "Pending + no job" is transiently true mid-enqueue; a real orphan is always older | Plan |
| Orphan UX | Silent release | No job row left to hang a notice on; the clone's name carries the residue | Plan |
| Schema | No migration; `delivery` as-is | Zero hosted-migration risk for a semantic nicety | Plan |
| Dialog proposal count | Out of scope | Deletion stays the sanctioned low-friction cleanup act | Plan |
| Tests | Integration + predicate unit tests, no E2E | Integration asserts both defects far cheaper than the ~444 s E2E path | Research |

## Scope

**In scope:** the shared predicate + its consumers (`settle`, hub guards, `pickJob`, the hub badge
surface — `surfacedJobsFor` + `toGenerationIndicator`); the
null-proposal branch reporting its reason on first visit; a race-safe orphan release wired into the
plan route; unit + integration coverage.

**Out of scope:** any migration; `delivered_at` rename; DeletePlanDialog proposal counts; orphan
release notices; eager delete-time clearing; repairing already-corrupted dev rows; the (correct)
loss of provenance when a delivered proposal's source is deleted.

## Architecture / Approach

Phase 1 moves the "has this ever delivered?" question onto the `delivery` fact inside the one shared
predicate, which fixes every consumer at once. Phase 2 adds one guarded UPDATE
(`pending ∧ created_at < staleness cutoff`) called by the route only when `checkPlan` returned null
*without throwing* — untangling the route's current conflation of "no job row" and "check failed".
The phases share no files.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. D2 — the `delivery` discriminator | No flip, source deletable, provenance survives, reasons surface, no stuck hub badge | A raw-column consumer the predicate fix can't reach (the hub badge surface — handled explicitly, found in plan review) |
| 2. Orphan release — lazy, on visit | Stranded proposals become ordinary plans on visit | Releasing a mid-enqueue clone (closed by the `created_at` grace guard) |

**Prerequisites:** local Supabase stack for integration tests; solver only for the manual walkthroughs.
**Estimated effort:** ~1–2 sessions; Phase 1 is the larger half.

## Open Risks & Assumptions

- The 5-minute `HEARTBEAT_GRACE_MS` doubles as the orphan-release age guard; a pathological >5-minute
  enqueue stall could theoretically be released early — accepted as negligible and recoverable.
- Existing corrupted rows on dev/hosted data are not repaired, per the repo's "no production data to
  preserve yet" stance.

## Success Criteria (Summary)

- An author who rejects and deletes a delivered proposal never sees a failure they didn't cause, and
  can still delete the source.
- No plan is ever stranded un-usable behind `pending_proposal` — every orphan heals on its next visit.
- All existing generation/guard integration cases stay green.
