---
date: 2026-08-14T08:57:49+02:00
researcher: Dobromir Kropielnicki
git_commit: 1524e0c5ecbea45c4dcd12f41dd23d2c4d9b6372
branch: main
repository: 10xdev3 (ib-timetable-planner)
topic: "Retiring the CI generation-benchmark job and the dead code behind it"
tags: [research, codebase, ci, bench, greedy-engine, cp-sat, generation]
status: complete
last_updated: 2026-08-14
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Re-verified against main after S-301 (first-verified-proposal) merged — the greedy Web Worker path is now orphaned, which changes the removable set substantially."
---

# Research: Retiring the CI generation-benchmark job and the dead code behind it

**Date**: 2026-08-14T08:57:49+02:00 (revised 09:05:49+02:00)
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `1524e0c5ecbea45c4dcd12f41dd23d2c4d9b6372` (`chore(archive): close first-verified-proposal`)
**Branch**: `main`
**Repository**: `10xdev3` (ib-timetable-planner)

> **Revision note.** The first pass ran against `8e47083`, before **S-301 `first-verified-proposal`**
> merged. That merge landed the CP-SAT app path on `main` and moved the Generate button off greedy.
> The CI findings are unchanged; the *dead-code* findings changed a lot, and are restated below
> against the current `main`. See §7 for the delta.

## Research Question

> Our CI process contains a bench generation workflow. It was built to validate greedy engine
> performance and since we are right now moving the whole implementation to use only the CP-SAT
> engine, this work would produce only noise and it's flaky. There is no business value to keep it.
> Please check what is needed to clean it up from the CI process and if some dead code could
> potentially be removed as well.

## Summary

**The premise checks out, and the evidence is stronger than "flaky".** The `bench` job has failed
**26 of its 44 conclusive runs (59%)** since it was introduced on 2026-07-12, and **17 of 24 (71%)**
since 2026-08-09. Across the 15 most recent CI runs, it is the **only** job that has ever failed —
every red ❌ on the repo in that window is this job and nothing else. It is non-blocking (absent from
`deploy.needs`), so it has never gated anything; it costs ~3 min of runner time per push and boots a
full Supabase stack to do it.

The root cause is not infrastructure. The bench asserts `dp1.unplaced === []` against a
**wall-clock-driven LNS search**, and `bench/generation.bench.ts:23-28` already documents the
mechanism in its own docblock — *"the round count … moves with machine load. 46 was never a property
of the engine; it was a property of the runs that measured it."* The current failure is exactly the
failure mode that comment anticipated: dp1 leaves one hour unplaced. So the job is not measuring a
regression; it is sampling noise from an engine that is on its way out.

**And there is more dead code than the question assumed.** With S-301 merged, the Generate button
enqueues a CP-SAT job (`use-cohort-board-state.ts:175`) and the entire greedy Web Worker path is
orphaned — **502 lines with no production consumer**, held alive by a single two-line type import.
The greedy engine itself (~2,270 lines) now has **zero** production call sites too; its only
remaining consumers are its own tests and three `bench/` runners.

| Tier | Scope | Lines | Verdict |
|---|---|---|---|
| **1** | CI job + script + config + `generation.bench.ts` | ~155 | **In scope.** No gate loses coverage. |
| **2** | The orphaned greedy Web Worker path | 502 | **In scope** — newly dead as of S-301. One 2-line type needs a new home. |
| **3** | The greedy engine + its tests/fixtures | ~2,270 | **Out of scope** — technically unblocked, but it is roadmap **S-309**. |
| **4** | Greedy-driven `bench/` experiments | ~420 | **Out of scope.** `export-snapshot.experiment.ts` is the sole producer of the Python parity fixture. |

Tiers 1 and 2 together are a clean, self-contained change: delete a CI job that only produces false
red, plus the code path it was measuring, which nothing calls any more. Everything in that scope has
zero consumers, so it cannot change behaviour. Tier 3 is real and now *possible*, but it is a named
roadmap slice with a one-way gate, so it stays out.

**Scope and the four open questions below are settled** — see `change.md` §Decisions (D1–D6), which
is the authoritative input to `/10x-plan`.

## Detailed Findings

### 1. The flakiness, quantified

Per-job conclusions pulled from the GitHub Actions API across the last 60 workflow runs (the job did
not exist before 2026-07-12; 2 runs were cancelled):

| Window | Bench runs | Failures | Rate |
|---|---|---|---|
| Lifetime (2026-07-12 → 08-13) | 44 | 26 | **59%** |
| Since 2026-08-09 | 24 | 17 | **71%** |
| First week (2026-07-12 → 07-16) | 20 | 9 | 45% |

It was never reliable — it failed 45% of the time in its own probation week, which is precisely the
week the promotion protocol said should be all-green before promoting it to a gate.

In the 15 most recently inspected runs, `verify`, `integration`, `e2e`, `solver` and `deploy` were
green in **every single one**; `bench` failed in 12. Run `31718906807` on `main` is the clean
illustration: bench ❌, everything else ✅, `Deploy` still succeeded — the job correctly does not
block, it just paints the run red. (No CI run for the S-301 merge has appeared yet at the time of
writing.)

**The actual failure** (run `31718906807`, 2026-08-13):

```
dp1: placed 115 rows, slots 50 (bar ≤ 50), unplaced 1, day-edge holes 0
dp2: placed 134 rows, slots 47 (bar ≤ 47), unplaced 0, day-edge holes 0
 × bench/generation.bench.ts > … reaches a complete, valid board … 60164ms
   → expected [ { …(2) } ] to deeply equal []
   ❯ bench/generation.bench.ts:73:53
```

Note what failed: **not** the dp2 slot pin that the CI comment worries about (dp2 landed 47, inside
its bar), but `dp1.unplaced === []` at `bench/generation.bench.ts:73`. The greedy engine could not
place one hour within its 60 s budget on a GitHub runner.

**Why it is structurally unfixable in place** — the bench's own docblock,
`bench/generation.bench.ts:23-28`:

> *"the pin was measured as '46, reliably' — but re-measuring the SAME pre-tuning engine, at its
> shipped LNS seed, produced 47 on one run and 46 on the next, and a different seed left an hour
> unplaced. The search is wall-clock-driven (stagnation and budget are `Date.now()` windows), so the
> round count — and with it which plateau the LNS walks — moves with machine load. 46 was never a
> property of the engine; it was a property of the runs that measured it."*

And it was already known to be noise a month ago, from the change that loosened the bar
(`context/archive/2026-07-12-generation-quality-tuning/change.md:154-156`):

> *"2026-07-14 (bench is not a guard): measured during the review — `pnpm bench:generation` fails on
> **unmodified `main`** in 3 of 4 runs on this machine (dp1 one hour unplaced) … the change's only
> quality guard is noise."*

That review's follow-up §4 concluded the only fix would be *"a deterministic mode — round-count-bounded
rather than wall-clock-bounded — used by the bench only."* That work was never done, and doing it now
for an engine slated for deletion has no return.

### 2. Tier 1 — the CI removal surface

Everything below exists **only** to serve `pnpm bench:generation`. Nothing else reads any of it.

| File | Lines | What it is |
|---|---|---|
| `.github/workflows/ci.yml:208-224` | 17 | The whole `bench:` job |
| `.github/workflows/ci.yml:8-11` | 4 | `workflow_dispatch:` + its bench-probation comment |
| `package.json:19` | 1 | `"bench:generation": "vitest run --config vitest.bench.config.ts"` |
| `vitest.bench.config.ts` | 24 | Whole file — `include: ["bench/**/*.bench.ts"]`, matches one file |
| `bench/generation.bench.ts` | 112 | The only `*.bench.ts` in the repo |

Confirming facts:

- **No gate loses coverage.** `deploy.needs` is `[verify, integration, e2e, solver]`. `bench` was
  never promoted, despite the protocol at `ci.yml:211-216` saying to promote it after ~5 clean runs.
  It never had 5 clean runs.
- **`vitest.bench.config.ts` is single-purpose.** Its `include` glob (`:13`) matches exactly
  `bench/generation.bench.ts`. Its own docstring (`:5-7`) says *"NOT part of `pnpm test` or CI"* —
  accurate, since the CI job invokes the script directly.
- **`bench/generation.bench.ts` is imported by nothing.** Repo-wide grep for `../bench`, `@/bench`:
  zero hits. Nothing outside `bench/` imports from `bench/` at all.
- **The composite actions survive.** `.github/actions/supabase-stack` keeps two callers
  (`integration`, `e2e`), both of which pass `export-anon-key: "true"`. `bench` was the only caller
  relying on the `"false"` default — removing it orphans no input, only stops exercising that default.
  `.github/actions/setup` is used by all five jobs.
- **`workflow_dispatch` is a judgment call.** Its only *stated* purpose (`ci.yml:8-11`) is bench
  probation, so the comment must go either way. Keeping the bare trigger is harmless and useful for
  manual re-runs; deleting it removes the ability to re-run CI without a push.

**Bonus:** `bench/generation.bench.ts:84` builds a Supabase client directly with `createClient`,
bypassing the localhost fence in `bench/local-supabase.ts:13-34`. It is the one DB-touching runner in
`bench/` with no guard against being pointed at hosted Supabase. That latent gap disappears with the file.

### 3. Tier 2 — the orphaned Web Worker path (new since S-301)

**The Generate button no longer runs greedy.** `use-cohort-board-state.ts:172-175` says so directly:

> *"S-301: Generate enqueues a durable CP-SAT job instead of running the greedy engine in a Web
> Worker."*
> `const generateControls = useGenerationJob({ planId: shared.planId, initialJob: generationJob, busy: combinedBusy });`

Live CP-SAT chain: `PlannerBoard.tsx:295` → `GenerateButton.tsx:21` → `use-cohort-board-state.ts:175`
(`useGenerationJob`) → `generation-job.ts:152` (`transport.dispatchSolveJob`), wired in
`src/actions/index.ts:27` via `createGenerationActions({ getTransport: getSolverTransport })`.

That leaves the old client-side path with **no production consumer**:

| File | Lines | Remaining references |
|---|---|---|
| `use-generate-plan.ts` | 178 | Only the `ApplyGeneratedResult` type (`:30`) — see below |
| `use-generate-plan.test.tsx` | 214 | Tests the dead hook |
| `generate.worker.ts` | 59 | Loaded only by `use-generate-plan.ts:178` |
| `worker-protocol.ts` | 31 | Imported only by the two files above |
| `worker-protocol.test.ts` | 20 | Tests the dead protocol |
| **Total** | **502** | |

**The one live thread** is a type, not behaviour: `use-cohort-board-state.ts:16` imports
`type ApplyGeneratedResult` from `./generation/use-generate-plan`, and uses it at `:120` as the return
type of `applyGenerated`. The definition is two lines (`use-generate-plan.ts:30`):

```ts
export type ApplyGeneratedResult = { ok: true } | { ok: false; reason?: "stale" };
```

Move it (`apply-generated.ts` is the natural home — it is live and already holds the sibling helpers)
and the whole 502-line path detaches cleanly. `apply-generated.ts` itself **stays**:
`use-cohort-board-state.ts:15` still uses `buildGeneratedSegments`, `buildRegionPayload`, and
`generationHistoryEntry` on the CP-SAT delivery path.

Note that `generate.worker.ts` is the *only* thing keeping the greedy engine reachable from
`src/_pages/**`. Deleting it makes tier 3 a pure entity-layer change with no page-slice involvement.

### 4. Tier 3 — the greedy engine (now unblocked, but it is S-309)

After tier 2, the full consumer set of `engines/greedy/**` is:

| Consumer | Kind |
|---|---|
| `src/entities/timetable/index.ts:33` | Barrel re-export (3 symbols) |
| `engine-fuzz.test.ts`, `quality-bar.test.ts`, `generation-smoke.test.ts` | Greedy-only tests |
| `engines/greedy/greedy.test.ts` | Its own test |
| `bench/generation.bench.ts` | Tier 1 — deleted |
| `bench/generation.experiment.ts`, `bench/export-snapshot.experiment.ts` | Tier 4 — see below |

Sizing:

| Group | Lines |
|---|---|
| `src/entities/timetable/model/generation/engines/greedy/**` (10 files) | 2,015 |
| `engine-fuzz.test.ts` + `quality-bar.test.ts` + `generation-smoke.test.ts` + `__fixtures__/descent-catalog.ts` | 255 |
| **Strictly greedy-only** | **2,270** |
| `+ __fixtures__/synthetic-catalog.ts` (orphaned), `rng.ts` (loses last consumer) | ~2,349 |

Type-level residue is small: `types.ts:99`'s `"stagnation"` member of the `stopReason` union, plus
prose-only mentions at `types.ts:81-99` and `wire.ts:34`. **The wire contract needs no change** —
`contracts/generation-wire.schema.json:156` already pins `"engine": { "const": "cp-sat" }`, and greedy
appears there only in three `description` strings. On the Python side, `schema.py:99-113`'s
`greedy_placements` / `greedy_diagnostics` are *field names* on the out-of-contract bench `Dump`
envelope, fed from the contract's engine-neutral `warmStart` (`runner.py:112-113`).

**The gate is now policy, not code.** Roadmap S-309 (*"Generate defaults to CP-SAT; the greedy engine
+ Web Worker path are deleted"*) is `proposed`, gated on S-305 + S-306 + S-307 + S-308 — all still
`proposed`. But S-301 is `done`, and it already delivered the first half of S-309's outcome: Generate
*does* default to CP-SAT today. So the roadmap's sequencing is partly overtaken by events, and
FR-314's *"until the calibration gate passes and the proposal flow ships"* has had one of its two
conditions met. Whether the remaining condition (S-308 calibration) still gates a pure *deletion* of
code nothing calls is a product call, not a technical one.

### 5. Tier 4 — greedy-driven experiments (recommend deferring)

- `bench/generation.experiment.ts:79` — `generatePlanGreedy` (~247 lines; also carries ~130 lines
  duplicated from `experiment-harness.ts` that were never migrated)
- `bench/export-snapshot.experiment.ts:104` — `generatePlanGreedy` + `scoreCandidate` (~170 lines)

**The blocker is `export-snapshot.experiment.ts`.** It is the documented producer of
`services/solver/tests/fixtures/seed-plan-a.json`, whose greedy board and objective 10-tuple
`[0,0,97,223,0,1048,316,4,38,14]` are pinned as `SEED_OBJECTIVE` in
`services/solver/tests/test_objective.py:24` — the *"objective-parity suite at exact 10/10"* that
`CLAUDE.md` makes a hard gate. Five pytest modules read that fixture.

The fixture is committed, so deleting the exporter reds nothing today. But it deletes the only way to
**regenerate** it, and the parity gate's baseline is a greedy board. Re-anchoring that baseline is
S-308's job. Touching this now buys nothing and risks a gate the project treats as non-negotiable.

### 6. What must NOT be removed from `bench/`

The directory name is misleading: most of `bench/` has nothing to do with the generation benchmark,
and three of its files run in the **blocking** `verify` job. `vitest.config.ts:27` includes
`"bench/**/*.test.ts"` in the default unit project, so these run under `pnpm test`:

| File | Why it must stay |
|---|---|
| `bench/contract-parity.test.ts` | **The TS half of the frozen wire contract gate.** Byte-gates `contracts/fixtures/` — a hard rule in `CLAUDE.md` and `contracts/README.md:16`. Its canonicalizer is the live production request body (`solver-transport.ts:62`). |
| `bench/read-json.ts` | Imported by the above. Deleting it reds `pnpm test`. |
| `bench/generate-contract-goldens.experiment.ts` | `pnpm experiment:goldens` — the *only* sanctioned way to regenerate the goldens that the gate pins. |
| `bench/fixture-courses.test.ts` | Also collected into `pnpm test` → `verify`. |

Unaffected by any tier (engine-agnostic dev tooling): `import-generated.experiment.ts` (CP-SAT side),
`experiment-harness.ts`, `local-supabase.ts`, `plan-report.ts`, `plan-quality.analyze.ts`.

Also untouched: `eslint.config.js:82-139` (`benchBoundaryConfig`) fences imports for **all** of
`bench/**/*.ts`, and `vitest.config.ts:27`'s `bench/**/*.test.ts` glob. Both stay relevant as long as
any file remains under `bench/`.

### 7. What the S-301 merge changed since the first pass

| Finding (pass 1, `8e47083`) | Now (`1524e0c`) |
|---|---|
| Greedy is the only runtime engine; CP-SAT unreachable from the app | **Inverted.** Generate runs CP-SAT; greedy has zero production call sites |
| Greedy deletion blocked — would break shipped Generate | **Unblocked technically**; gated only by S-309 policy |
| Web Worker path is live production code | **502 lines orphaned**, held by one 2-line type |
| `bench/auto-park.ts` is greedy-only, removable with the exporter | **Promoted** to `src/entities/timetable/model/generation/auto-park.ts`; now production code on the CP-SAT path (`plan-snapshot.ts:40`, `generation-job.ts:105`). Not removable. |
| CI: 5 jobs, `bench` non-blocking | **Unchanged.** Only CI delta is `SOLVER_MAX_CONCURRENT_JOBS: "2"` in `integration`, sized for the new `generation-proposal.integration.test.ts` |

Everything in tiers 1 and 4, and every "must not remove" item, is unchanged by the merge.

### 8. Docs that need updating with tier 1

The `lessons.md` rule *"A convention that cites a code mechanism is coupled to it"* applies directly —
these all name the bench as a live mechanism:

| File:line | What it claims |
|---|---|
| `context/foundation/roadmap.md:66` | Inventories `verify/integration/e2e/**bench**/deploy` as the CI shape |
| `context/foundation/prd.md:384` | FR-314 precondition: *"bench re-anchored to pinned CP-SAT numbers"* |
| `context/foundation/roadmap.md:225` | S-309 precondition, same wording |
| `context/foundation/shape-notes.md:548-549` | Retirement preconditions, same wording |
| `context/changes/post-poc-cp-sat-refactoring-plan/research.md:337, 382` | *"Retirement re-anchors regression to pinned CP-SAT numbers"* |

Three live artifacts name **"bench re-anchored to pinned CP-SAT numbers"** as a precondition for
greedy retirement. Deleting the bench does not violate that — it *changes* it. The honest edit is to
restate the precondition as "a CP-SAT regression baseline exists" (which S-308 produces anyway) rather
than leave three documents pointing at a file that no longer exists.

Also stale and worth fixing while in there: `ci.yml:9,214` still says *"the dp2 = 46 pin"* while the
code has read `{ dp1: 50, dp2: 47 }` since 2026-07-14 (`bench/generation.bench.ts:33`).

Archived docs under `context/archive/**` also mention the bench (notably
`2026-07-12-generation-engine-refactor/`, which introduced it). Those are historical record — **do not
rewrite them.**

## Code References

- `.github/workflows/ci.yml:208-224` — the `bench` job; `:8-11` — `workflow_dispatch` + probation comment; `:211-216` — the never-executed promotion protocol
- `package.json:19` — `bench:generation` script
- `vitest.bench.config.ts:13` — `include: ["bench/**/*.bench.ts"]`, matches one file
- `bench/generation.bench.ts:33` — `SLOT_BARS = { dp1: 50, dp2: 47 }`; `:23-28` — the wall-clock-noise docblock; `:54` — `createGreedyEngine`; `:73-77` — the assertions; `:84` — unfenced Supabase client
- `vitest.config.ts:27` — `include: ["src/**/*.test.ts", "bench/**/*.test.ts"]` — why three bench files run in `verify`
- `src/_pages/plan-detail/model/use-cohort-board-state.ts:172-175` — Generate switched to `useGenerationJob` (CP-SAT)
- `src/_pages/plan-detail/model/generation/use-generate-plan.ts:30` — `ApplyGeneratedResult`, the only live thread in the dead worker path; `:178` — the `new Worker(...)` call
- `src/_pages/plan-detail/api/generation-job.ts:152` — `transport.dispatchSolveJob`; `src/actions/index.ts:27` — where the transport is injected
- `src/entities/timetable/index.ts:33` — the three greedy barrel exports; `:22` — `auto-park` re-export
- `src/entities/timetable/model/generation/auto-park.ts` — promoted out of `bench/`, now on the production path via `plan-snapshot.ts:40`
- `bench/export-snapshot.experiment.ts:104` — greedy warm-start producer for the Python fixture
- `services/solver/tests/test_objective.py:24` — `SEED_OBJECTIVE`, pinned from that fixture
- `contracts/generation-wire.schema.json:156` — `"engine": { "const": "cp-sat" }`
- `eslint.config.js:82-139` — `benchBoundaryConfig`, governs all of `bench/`

## Architecture Insights

- **`bench/` is three unrelated things under one name.** A CI-blocking contract gate
  (`contract-parity.test.ts`, in `pnpm test`), a non-blocking quality benchmark (`generation.bench.ts`),
  and a set of dev-only DB experiment runners. The four sibling vitest configs
  (`bench`/`analyze`/`experiment`/default) are what keep them apart. Any cleanup must reason per-file,
  never per-directory — deleting "the bench folder" would take out a frozen-contract gate.
- **A wall-clock-bounded search cannot back a hard assertion.** The bench pins `unplaced === []` on a
  `Date.now()`-driven LNS. Load-dependent round counts make the result a distribution, not a value.
  The 2026-07-14 review reached this conclusion, wrote the fix (deterministic round-count mode), and
  the fix was never built — so the job has been sampling noise for a month.
- **A non-blocking job still has a cost.** It doesn't block `deploy`, but it marks the run ❌, which
  trains everyone to read red as "probably just the bench" — and that habit is what eventually lets a
  real failure through. Plus ~3 min of runner time and a full Supabase stack per push.
- **The engine swap left its scaffolding behind.** `runVerifiedGeneration(engine, …)` was built as a
  seam for exactly this migration; S-301 used it and then routed around the client path entirely. The
  502 orphaned lines are the normal residue of a completed swap — worth collecting now, while the
  reason they are dead is still fresh.
- **Promotion out of `bench/` is the healthy pattern.** `auto-park` started as a bench-only transform
  and became production code on the CP-SAT path. That is the counter-example to treating `bench/` as
  a deletion unit: some of it graduates.

## Historical Context (from prior changes)

- `context/archive/2026-07-12-generation-engine-refactor/` — **introduced the bench job.** Rationale
  (`plan-brief.md:7`): *"CI cannot detect quality regressions … nothing in CI asserts quality (slot
  counts)."* Validated with 5 clean local runs at `{ dp1: 50, dp2: 46 }`. Shipped non-blocking with an
  explicit promotion protocol; the protocol's condition (~5 clean runs) was never met.
- `context/archive/2026-07-12-generation-quality-tuning/change.md:154-156, 232-244` — **two days later,
  declared the bench "not a guard"**: 3-of-4 local failures on unmodified `main`, and loosened dp2
  from 46 to ≤47. Follow-up §4 specified the deterministic-mode fix that was never built.
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md:326-388` (live, status `preparing`) —
  the greedy keep/freeze/delete decision. Initially "freeze behind a five-condition gate", revised
  after pushback to *"delete as a phase of this migration"*, with sequencing preserved. This is the
  reasoning trail behind FR-314 and S-309.
- `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md:94` — the GO decision: CP-SAT beat
  the clique bound on both cohorts. From that point greedy's output stopped having product value —
  `shape-notes.md:113-140` puts it as *"keeping it is operational cost, not product value."*
- **S-301 `first-verified-proposal` (merged 2026-08-14, `1524e0c`)** — made CP-SAT the Generate path
  and, as a side effect, orphaned the greedy Web Worker path. This is what turns tier 2 from "blocked"
  into "free".

## Related Research

- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` — the CP-SAT migration research; §"the
  greedy engine: keep, freeze, or delete?" is the direct predecessor to this question
- `context/archive/2026-07-12-generation-engine-refactor/plan.md` — where the bench job and its
  promotion protocol were designed
- `context/archive/2026-07-12-generation-quality-tuning/change.md` — the measurement that first showed
  the bars are noise

## Open Questions — resolved 2026-08-14

All five closed. Rationale lives in `change.md` §Decisions; this table is the index.

| # | Question | Decision |
|---|---|---|
| 1 | Does tier 3 (the greedy engine) belong in this change? | **No** — tiers 1+2 only. Tier 3 is S-309, one-way, gated on S-305–S-308. (**D1**) |
| 2 | Where does `ApplyGeneratedResult` live? | `apply-generated.ts` — live, same folder, already holds the sibling helpers. (**D3**) |
| 3 | Keep `workflow_dispatch`? | **Keep the trigger, delete its bench-probation comment.** The comment is bench-specific; the capability is not. (**D2**) |
| 4 | How to restate the FR-314 / S-309 precondition? | **Restate, don't drop** — reword to the intent ("a CP-SAT regression baseline is pinned and executable") rather than the dead mechanism. (**D4**) |
| 5 | Does anything replace the quality bar? | **No replacement here.** There is no coverage to preserve — the bar has been asserting noise. The real successor is S-308's calibration. (**D5**) |

One item stays deliberately soft: **D4's exact PRD phrasing** is the user's call. The recommendation
is recorded and is cheap to override at plan time; what is settled is that the precondition gets
*reworded* rather than deleted.

Secondary decision recorded at the same time (**D6**): the greedy barrel exports and the greedy unit
tests stay. They are tier 3's business, and they are not part of the problem — `verify` was green in
all 15 recent runs, so the greedy *unit* tests are not flaky; only the real-catalog bench is.
