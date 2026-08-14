---
change_id: clean-up-bench-generation
title: Retire the flaky CI generation-benchmark job (and its dead code)
status: plan_reviewed
created: 2026-08-14
updated: 2026-08-14
archived_at: null
---

## Notes

The CI `bench` job was built to validate greedy-engine performance. With the implementation moving to
CP-SAT only, it produces noise, not signal — and it's flaky. No business value in keeping it.

Findings in `research.md`. Headline: bench has failed **26 of 44 conclusive runs (59%)** lifetime,
**17 of 24 (71%)** since 2026-08-09, and is the **only** job that has failed in the 15 most recent
runs. Non-blocking, never promoted to a gate.

Research classified the removable surface into four tiers (re-verified after S-301
`first-verified-proposal` merged into main at `1524e0c` — that merge moved Generate onto CP-SAT and
changed the removable set). The decisions below settle which tiers this change takes and how.

## Decisions

Taken 2026-08-14, from `research.md`'s recommendations. These are the inputs to `/10x-plan`; the plan
implements them rather than re-litigating them.

### D1 — Scope: tiers 1 + 2 only

**This change deletes the CI `bench` job and the orphaned greedy Web Worker path. Nothing else.**

- **In:** `ci.yml` `bench:` job, `package.json:19` (`bench:generation`), `vitest.bench.config.ts`,
  `bench/generation.bench.ts` (~155 lines) — plus `use-generate-plan.ts` + test, `generate.worker.ts`,
  `worker-protocol.ts` + test (502 lines).
- **Out:** the greedy engine (tier 3, ~2,270 lines) and the greedy-driven `bench/` experiments (tier 4).

**Why:** everything in scope has **zero consumers** — deleting it cannot change behaviour, which makes
the change reviewable by inspection and trivially revertable. Tier 3 is roadmap **S-309**, explicitly
one-way (`roadmap.md:225`) and gated on S-305–S-308. Folding an irreversible engine deletion into a
CI-hygiene change would make both harder to review and impossible to revert independently.

### D2 — Keep `workflow_dispatch`, delete its comment

Keep the bare trigger at `ci.yml:11`; delete the three comment lines above it (`:8-10`) that scope it
to bench probation.

**Why:** the *comment* is bench-specific, the *capability* is not. Manual re-run of CI without a push
is independently useful and costs nothing. Deleting the trigger would be a silent capability
regression bundled into a cleanup.

### D3 — `ApplyGeneratedResult` moves to `apply-generated.ts`

The 2-line type at `use-generate-plan.ts:30` is the only live thread into the dead worker path
(consumed by `use-cohort-board-state.ts:120`). It moves to
`src/_pages/plan-detail/model/generation/apply-generated.ts`.

**Why:** same folder, file is already live on the CP-SAT delivery path, and it already exports the
sibling helpers (`buildGeneratedSegments`, `buildRegionPayload`, `generationHistoryEntry`) that
`use-cohort-board-state.ts` imports alongside it. No new file, no new import edge.

### D4 — Restate the FR-314 / S-309 precondition; do not drop it

Three live docs name *"bench re-anchored to pinned CP-SAT numbers"* as a greedy-retirement
precondition (`prd.md:384`, `roadmap.md:225`, `shape-notes.md:548-549`). Reword to the **intent**
rather than the mechanism — e.g. *"a CP-SAT regression baseline is pinned and executable"* (S-308's
output). Also refresh `roadmap.md:66`, which inventories `bench` as part of the CI shape.

**Why:** the guarantee those docs protect is "don't retire greedy without a regression baseline." That
survives the bench's deletion; only the named mechanism dies. Dropping the precondition would quietly
weaken S-309's gate; leaving it pointing at a deleted file is the exact staleness `lessons.md` warns
about ("a convention that cites a code mechanism is coupled to it").

> PRD wording is ultimately the user's call — this is the recommended phrasing, cheap to override at
> plan time. Archived docs under `context/archive/**` are historical record and are **not** rewritten.

### D5 — No replacement quality bar in this change

Delete the bench without standing up a successor. Say so explicitly in the plan so it reads as a
deliberate choice, not accidental coverage loss.

**Why:** the bench was the only executable assertion over the *real* catalog, but it has been
asserting noise for a month, so there is no coverage to preserve. Designing the real successor —
a completeness/quality guarantee for the shipped CP-SAT engine — is S-308's calibration campaign, and
it needs calibrated numbers this change does not have. Deleting a noise generator is not the moment to
design its replacement.

### D6 — Leave the greedy barrel exports and greedy unit tests alone

`src/entities/timetable/index.ts:33` keeps exporting `createGreedyEngine`/`generatePlanGreedy`/
`GreedyTuning`; `engine-fuzz.test.ts`, `quality-bar.test.ts`, `generation-smoke.test.ts` keep running.

**Why:** they are tier 3's business. They are also not part of the problem — `verify` was green in all
15 recent CI runs, so the greedy *unit* tests are not flaky; only the real-catalog bench is. Removing
`bench/generation.experiment.ts` alone wouldn't help either: `export-snapshot.experiment.ts` keeps
`bench/` depending on greedy regardless, so partial tier-4 removal is churn without decoupling.

### Amendments from planning (2026-08-14)

The orphan sweep found the deletion set was larger than D1 assumed, and the user took one override:

- **D3 is superseded.** `applyGenerated` (`use-cohort-board-state.ts:120`) is itself unreachable —
  `PlannerBoard.tsx:83` destructures `{ dp1, dp2, history, generation }` and never takes it. So
  `ApplyGeneratedResult` is **deleted, not rehomed**, along with `apply-generated.ts` + test and the
  `placement-client.ts` wrapper.
- **D1 expands** to include `GenerationSummaryPanel` + test (orphaned; `PlannerBoard.tsx:320-323`
  says so outright, and the S-301 plan deferred it to this change).
- **New boundary:** the reachability sweep stops at the Astro Action. The *domain*
  `applyGeneratedPlacements` (`api/placements.ts:112`) is live on the CP-SAT delivery path, and S-306
  may want a client apply again, so `placement-actions.ts:19` stays.
- **D4 expands:** FR-314's *"greedy remains the working Generate affordance"* is already false on main.
  Correct `prd.md` + `roadmap.md`; annotate `shape-notes.md` + the post-poc `research.md`.
- **User override:** `useCollisionInspection` (pre-existing orphan, unrelated to S-301) is swept too —
  isolated in its own phase so its revert stays independent.

**Known gap, recorded not closed:** there is no E2E coverage of the Generate button at all. This change
deliberately does not add it — that needs the solver in the E2E lane, a CI change of its own.

## Guardrails for the plan

- `bench/` is three unrelated things under one name. **Reason per-file, never per-directory.**
  `contract-parity.test.ts` (+ `read-json.ts`) runs in the **blocking** `verify` job and byte-gates
  the frozen wire contract; `generate-contract-goldens.experiment.ts` is the only sanctioned way to
  regenerate those goldens. All three stay.
- `bench/auto-park.ts` no longer exists — it was **promoted** to
  `src/entities/timetable/model/generation/auto-park.ts` by S-301 and is now production code on the
  CP-SAT path (`plan-snapshot.ts:40`). Not removable.
- After D1, nothing under `src/_pages/**` reaches the greedy engine — which is what makes a future
  S-309 a pure entity-layer change.
- Verification: `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` (the `/verify`
  gate). `pnpm test` must stay green — it is what proves the three surviving `bench/**/*.test.ts`
  files were not caught in the sweep.
