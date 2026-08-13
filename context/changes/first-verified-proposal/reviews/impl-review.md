<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: First Verified Proposal (S-301)

- **Plan**: context/changes/first-verified-proposal/plan.md
- **Scope**: Full plan — Phases 1–5 of 5
- **Date**: 2026-08-13
- **Verdict**: NEEDS ATTENTION → triaged 2026-08-13 (F1, F2, F3, F6, F8, F9 fixed; F5, F7 accepted; F4 skipped)
- **Findings**: 0 critical, 4 warnings, 5 observations
- **Post-triage verification**: `pnpm check` 0 errors · 1603/1603 unit · 150/150 integration (live stack + solver) · lint/steiger clean · solver ruff + mypy --strict clean

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | WARNING |

## Evidence base

- Solver lane: 97/97 pytest with **zero skips** (golden parity genuinely executed locally), ruff + `mypy --strict` clean.
- App: `pnpm check` 0 errors, 1603/1603 unit tests, lint/steiger/build/audit clean.
- Full integration suite against the live local stack + running solver: 32 files, 150/150 (includes enqueue, delivery, credential, and the full-chain E2E suites).
- CI: the new E2E test verifiably executed in the `integration` job (2.3 s); all **required** jobs green; PR run red only from the non-blocking greedy benchmark (F4).
- Drift sweep: **no drift, no missing items** across all 5 phases; all five change.md-documented deviations match their code exactly. Justified extras: `survivingPins` in the delivery apply (required by region-replace semantics), CI-only `SOLVER_URL` hard-fail guard in the E2E suite. The plan's "delivered-marker CAS with a returning check" shipped without the returning check, but exactly-once delivery is proven by the three-way concurrent integration test (region-replace idempotency converges the losing tab) — recorded, not a finding.

## Findings

### F1 — Course-id translation failure never terminates the job: invisible infinite retry

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability / Data safety)
- **Location**: src/\_pages/plan-detail/api/generation-delivery.ts:109
- **Detail**: A failing oracle verdict is handled terminally (failJob + orphan sweep), but `buildCourseIdMap` / `translateCourseIds` throw plain `Error` — and the proposal clone is an ordinary plan the author can edit between enqueue and delivery, making a key mismatch permanent. The throw escapes `checkGeneration`; the page frontmatter swallows it to null, so the strip shows nothing, the job stays succeeded-and-undelivered, and every visit re-fetches the ~160 KB payload, re-verifies, and re-throws. Deterministic failure, unbounded retries, zero user-visible signal.
- **Fix A ⭐ Recommended**: Catch map/translation errors in `deliver()`, failJob with the message, and KEEP the clone
  - Strength: Terminal state + visible diagnostic via the existing failed-strip path; the clone likely carries author edits (the very cause of the mismatch), so keeping it avoids destroying their work.
  - Tradeoff: Diverges from the other failure paths, which sweep the clone — needs a one-line guard comment.
  - Confidence: HIGH — failJob + strip plumbing already exists and is integration-tested.
  - Blind spot: Whether an edited clone under a failed job confuses the plans list ("Proposal — X" with no delivery).
- **Fix B**: Treat exactly like a failed verdict (failJob + sweep clone)
  - Strength: One uniform failure path; no orphan plans ever.
  - Tradeoff: Deletes a clone the author may have hand-edited — the only failure mode where the clone holds work.
  - Confidence: MED — mechanically trivial, but the data-loss edge is real.
  - Blind spot: No test currently constructs an edited-clone mismatch.
- **Decision**: FIXED via Fix A (translation errors → failJob with diagnostic + clone detached and kept; DomainError still propagates as retryable)

### F2 — Crash between job insert and dispatch deadlocks Generate for that plan (and the docstring claims it can't)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/\_pages/plan-detail/api/generation-job.ts:61
- **Detail**: The enqueue ordering prevents the error-path queued-never-dispatched row, but not process death between `insertJob` and `dispatch` — and `markDispatchFailed` is best-effort (its own failure is only console.error'd). A stranded `queued` row trips the partial unique index, so every future Generate returns "already running" with no recovery short of manual DB surgery. The module docstring overclaims ("forbids" the state). The wedged-`running` sibling is explicitly S-304's scope; this app-side window isn't recorded anywhere.
- **Fix A ⭐ Recommended**: Correct the docstring overclaim and record the queued-staleness window as S-304 inherited scope
  - Strength: Honest, zero behavior change, respects the plan's own "no wedged-state reclaim (S-304)" boundary.
  - Tradeoff: The rare deadlock remains possible until S-304 ships.
  - Confidence: HIGH — pure documentation; S-304 already owns the recovery family.
  - Blind spot: If S-301 merges and sits in production long before S-304, the window is live in prod.
- **Fix B**: Stopgap staleness sweep in `checkGeneration` (queued older than N minutes with no started_at → failed + clone sweep)
  - Strength: Self-healing now; no manual surgery ever.
  - Tradeoff: Scope extension the plan deliberately deferred; N must respect legitimate queue latency, and a wrong N fails healthy jobs.
  - Confidence: MED — mechanism is simple but the threshold interacts with solver capacity (503-past-cap).
  - Blind spot: Queued-age semantics under future S-303 polling.
- **Decision**: FIXED via Fix A (docstring truth-up + S-304 inherited-scope note in change.md)

### F3 — Stuck "launching" UI state with no recovery affordance

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/\_pages/plan-detail/model/generation/use-generation-job.ts:81
- **Detail**: `launch()` sets state "launching", then calls `runCheck()`. If that follow-up check rejects (transient failure right after a successful enqueue), the catch sets `error` but never changes state: the button renders permanently disabled ("Starting…") and the strip renders null (it only shows when "tracking"), so the Refresh recovery affordance is unreachable. Only a reload recovers.
- **Fix**: On a check failure following a successful launch, transition to a recoverable state (e.g. back to idle with the error kept visible, or synthesize a tracking state so the strip's Refresh renders).
- **Decision**: FIXED (runCheck's catch falls back from "launching" to idle; error stays visible)

### F4 — PR checks show red: the non-blocking greedy benchmark failed on both branch CI runs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: .github/workflows/ci.yml:209 (job), bench/generation.bench.ts:73
- **Detail**: All plan-listed criteria pass, and every REQUIRED job (verify, integration, e2e, solver) is green — but the overall PR run is red 2/2 because "Generation benchmark (non-blocking)" fails: greedy leaves dp1 with 1 unplaced hour at the 60 s budget. The greedy engine is untouched by this branch, the bench file's own doc records exactly this wall-clock nondeterminism class, the job is deliberately outside deploy.needs, and main's latest run passed it. Almost certainly runner-speed flake — but 2/2 means it wasn't observed passing on this branch, and a red X can block merge if branch protection requires all checks.
- **Fix**: Re-run the benchmark job to confirm flake vs. persistent; if it stays red, note it for the greedy-removal cleanup change (the engine is already slated for removal) rather than tuning the bar here.
- **Decision**: SKIPPED

### F5 — Recurring ~124 KB snapshot read for delivered not-fully-clean jobs

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/\_pages/plan-detail/api/generation-delivery.ts:276
- **Detail**: The short-circuits are right (undelivered → skip; tier-5 best 0 → clean without touching snapshot — the whole current catalog). But once the latest job is delivered with best > 0, every plan visit re-reads the TOASTed snapshot to recompute the floor, indefinitely, until the next generation. `deliver()` has both label inputs in hand at delivery time; persisting the floor then would keep later reads narrow — at the cost of contradicting change.md's "cleanliness is a derived read, no new field" decision. Unreachable on current data; decide consciously.
- **Fix**: Either accept (document the accepted read cost) or persist the computed floor at delivery time — which amends the recorded no-new-field decision and belongs with S-307's policy vocabulary if deferred.
- **Decision**: ACCEPTED (keep the derived read per change.md's no-new-field decision; the read only occurs for delivered jobs with best > 0, which no current data produces)

### F6 — A verified-but-empty result is marked delivered

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/\_pages/plan-detail/api/generation-delivery.ts:191
- **Detail**: `applyToProposal` early-returns on zero placements, yet `deliver()` proceeds to `markDelivered` — "Proposal ready" would link to a board that is just the clone's pins. Unreachable via the UI (Generate is disabled on complete plans) but reachable via the action directly.
- **Fix**: Treat an empty succeeded result as a failed verdict (or assert non-empty before apply).
- **Decision**: FIXED (empty succeeded result → failJob + clone sweep before verify; dead early-return in applyToProposal removed)

### F7 — Clone can leak if insert fails AND the compensating delete also fails

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/\_pages/plan-detail/api/generation-job.ts:66
- **Detail**: Double-fault window: `insertJob` fails and `deleteOrphanClone` errors (swallowed) or the process dies between them → a "Proposal — X" plan with no job row pointing at it, invisible to every sweep (which key off `proposal_plan_id`). Very narrow; the author can delete the stray plan manually from the plans list.
- **Fix**: Accept (it is user-recoverable) or log the orphan id at error level so it is at least findable.
- **Decision**: ACCEPTED (double-fault window; user-recoverable from the plans list, and deleteOrphanClone already logs its own failure with the clone id)

### F8 — Stale claim() docstring: "table-wide SELECT" became false in this same branch

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: services/solver/src/cpsat_service/supabase.py:107
- **Detail**: The claim CAS docstring still says the role holds table-wide SELECT; migration 20260812141459 (same branch) scoped it to three columns. Behavior is correct — the projection names exactly the granted columns — but this is precisely the prose-coupled-to-mechanism drift lessons.md warns about, introduced and invalidated within one branch.
- **Fix**: One-line docstring update naming the column-scoped grant.
- **Decision**: FIXED (claim() docstring now names the column-scoped grant and its migration)

### F9 — Stale-comment fix landed in the schema description, not contracts/README.md as the plan and change.md state

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: contracts/generation-wire.schema.json:23
- **Detail**: Phase 1 item 5 (and change.md decision 4) name contracts/README.md as the second stale-comment site — but the README never contained the "never a constraint" prose; it lived in the schema JSON's `AvailabilitySeverity` description, and that is what was corrected. The right fix went to the right place (annotation-only: fixtures byte-identical, no formatVersion bump, canonical form untouched); only the change record misnames the location.
- **Fix**: One-line correction in change.md's decision 4 so the record matches what shipped.
- **Decision**: FIXED (change.md decision 4 now names the schema description as the actual second stale-comment site)
