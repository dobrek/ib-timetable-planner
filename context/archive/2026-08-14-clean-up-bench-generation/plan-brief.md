# Retire the CI generation benchmark and the orphaned client generation path — Plan Brief

> Full plan: `context/changes/clean-up-bench-generation/plan.md`
> Research: `context/changes/clean-up-bench-generation/research.md`
> Decisions D1–D6: `context/changes/clean-up-bench-generation/change.md`

## What & Why

The CI `bench` job exists to catch quality regressions in the greedy generation engine. It has failed
**26 of its 44 conclusive runs (59%)**, and across the 15 most recent CI runs it is the **only** job
that has ever failed — every red ❌ is this job. It gates nothing (absent from `deploy.needs`), so its
sole effect is training the team to read red as "probably just the bench." Meanwhile S-301 moved
Generate onto CP-SAT, orphaning the entire client-side generation path it was measuring.

## Starting Point

`ci.yml:208-224` boots a full Supabase stack (~3 min/push) to run one wall-clock-driven test that
asserts a hard equality on a `Date.now()`-bounded search — the bench's own docblock
(`generation.bench.ts:23-28`) explains why that can't be stable, and a 2026-07-14 review already
declared it *"not a guard."* Separately, S-301 (`1524e0c`) switched Generate to a server-side CP-SAT
job and explicitly deferred the resulting cleanup to "the separate greedy-removal cleanup change" —
this one.

## Desired End State

CI runs four jobs, and a red run means something is actually broken. `src/_pages/plan-detail/**`
contains no generation code unreachable from the Generate button and no import edge into
`engines/greedy`. Every comment citing a deleted mechanism has been re-anchored to one that still
exists, and the PRD no longer claims greedy is "the working Generate affordance."

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Scope | Retire the bench + delete the orphaned client path | Everything in scope has zero consumers, so it cannot change behaviour | Research → D1 |
| Greedy engine (~2,270 lines) | Out of scope | Roadmap S-309: one-way, gated on S-305–S-308 | Research → D1 |
| Greedy `bench/` experiments | Out of scope | `export-snapshot.experiment.ts` solely produces the `SEED_OBJECTIVE` parity fixture | Research → D4 (tier 4) |
| `workflow_dispatch` | Keep trigger, delete its comment | The comment is bench-specific; manual re-run is not | Decisions → D2 |
| Dead-code boundary | By **reachability**, not import graph | `applyGenerated` is unreachable but imported; leaving it re-poses the question to S-309 | Plan |
| Cascade boundary | Stop at the Astro Action | Domain `applyGeneratedPlacements` is live (CP-SAT delivery); S-306 may want a client apply again | Plan |
| `ApplyGeneratedResult` | Deleted, not rehomed | Supersedes D3 — its only consumer is the dead verb | Plan |
| `useCollisionInspection` | Swept, in its own phase | Cheap, but unrelated cause — isolate so the revert stays independent | Plan (user override) |
| Docs | Correct normative docs, annotate dated ones | FR-314 is already false; rewriting shape-notes/research would falsify the record | Decisions → D4 + Plan |
| Verification | Automated gate only | Nothing deleted has a production consumer; `pnpm check` is the real authority | Plan |

## Scope

**In scope:** the `bench` CI job + `bench:generation` + `vitest.bench.config.ts` + `generation.bench.ts`;
the 5-file Web Worker path; `GenerationSummaryPanel` + test; the dead `applyGenerated` verb and its
builders + client wrapper; `useCollisionInspection`; five comment re-anchors; PRD/roadmap corrections
plus shape-notes/research annotations.

**Out of scope:** the greedy engine and its tests; the greedy-driven `bench/` experiments; the
`applyGeneratedPlacements` Astro Action; S-309's status and prerequisites; replacement test coverage;
anything under `context/archive/`.

## Architecture / Approach

Pure subtraction in four independently-revertable phases, ordered lowest-risk-first. The live CP-SAT
path — `GenerateButton` → `useGenerationJob` → `generation-job.ts` → `dispatchSolveJob` →
`generation-delivery.ts` — is untouched throughout. Comment re-anchoring ships *inside* the phase that
falsifies each comment, so the tree is never internally inconsistent. `pnpm check` is the type
authority (per `lessons.md`, build/test/lint passing is no evidence of type safety); `pnpm lint`
catches incomplete excisions; `pnpm build` is the gate on the barrel trap below.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Retire the CI benchmark | CI stops producing false red; ~3 min/push reclaimed | Deleting the wrong `bench/` file — `contract-parity.test.ts` runs in the **blocking** `verify` job |
| 2. Delete the orphaned client path | ~700 lines gone; no `_pages` → greedy edge remains | The barrel client-safety comment (see below); two live symbols with confusingly similar names |
| 3. Sweep `useCollisionInspection` | One pre-existing orphan removed | It may be intentionally-kept API — isolated so the revert is clean |
| 4. Truth-up the docs | PRD/roadmap match reality; S-309's remaining scope is unambiguous | Over-reaching into S-309's gate, which is a product call |

**Prerequisites:** none — main at `1524e0c` already carries S-301. Local Supabase for the two manual
render checks; no solver needed.
**Estimated effort:** ~1–2 sessions across four phases.

## Open Risks & Assumptions

- **The barrel trap.** `entities/timetable/index.ts:74-82` and `solver-config.ts:15-17` justify a live
  build constraint by citing `generate.worker.ts`. The **rule survives** the deletion (~20 `client:load`
  island components import that barrel); only its stated reason dies. A reader who concludes the barrel
  is server-safe now breaks `pnpm build` with `[ServerOnlyModule]`.
- **Name collisions.** `applyGeneratedPlacements` is both a dead client wrapper and a live domain
  function; `applyGeneratedRegion` is a separate live symbol on the history/reconcile path. Deleting by
  name match breaks CP-SAT delivery or undo/redo.
- **Assumption:** S-306 may want a client-side apply path again, which is why the Astro Action stays.
  If S-306 lands differently, that action is a follow-up deletion.
- **Known gap, not introduced here:** there is no E2E coverage of the Generate button at all. This
  change records it rather than closing it.

## Success Criteria (Summary)

- A red CI run means something is actually broken — the benchmark no longer reports on an engine the
  product doesn't use.
- The Generate button behaves exactly as before; nothing deleted was reachable from it.
- The PRD and roadmap describe the real engine situation, so whoever plans S-309 inherits facts rather
  than a false premise.
