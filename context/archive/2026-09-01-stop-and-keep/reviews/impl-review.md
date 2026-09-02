<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Stop & keep (S-305)

- **Plan**: context/changes/stop-and-keep/plan.md
- **Scope**: Full plan — Phases 1–4 of 4
- **Date**: 2026-09-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Verification evidence (re-run 2026-09-01)

- Solver: `uv run pytest` 184 passed (includes both new stop tests); `uv run mypy` strict clean; `uv run ruff check` clean.
- App: `pnpm check` 0 errors (802 files); `pnpm lint` clean; `pnpm steiger` clean; `pnpm test` 1797 passed (197 files); `pnpm build` green.
- Integration (live local stack): generation-stop + generation-delivery + solver-credential suites 38/38 passed.
- Phase 4 grep gate: only past/present-tense S-305 prose outside `supabase/migrations/`.
- Not re-run: `pnpm test:e2e e2e/specs/generation.spec.ts` (needs `mise run solver:dev`); recorded green at 8c45b4f.
- Drift agent: all planned items MATCH across 4 phases; unplanned diff files are comment true-ups, forced `stopRequestedAt: null` fixture additions, and extra tests; all "NOT doing" guardrails held (contracts/ and supabase/ zero diff, hub 10-key pin untouched, reclaim + claim-CAS unchanged, no measured latency in copy).

## Findings

### F1 — Transient "nothing was kept" flash on the delivered stop path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/ui/PendingProposalPage.tsx:67-77
- **Detail**: The stopped branch's comment claims "A stopped row WITH a checkpoint never reaches here", but it does — transiently, on the mainline path. The polling store publishes the new snapshot BEFORE `afterTick` navigates (polling-store.ts:105-106), so on the tick that delivers a stopped-with-checkpoint board the page briefly renders "You stopped this generation before any stage finished — nothing was kept" while the reload is in flight. The succeeded case has the same pre-existing flash one branch down (S-306's destructive panel), but this diff adds a new instance with actively misleading copy.
- **Fix**: Add a `job.delivered === true` branch ahead of the status branches rendering a neutral "Board ready — opening…" panel. (Guarding only the stopped branch with `checkpointStageIndex === null` would route a delivered stopped row into the destructive panel — worse.) The delivered-first branch also fixes the pre-existing succeeded flash.
  - Strength: One small branch fixes both the new and the inherited flash; matches the page's derived-state style.
  - Tradeoff: Minor — a new panel string.
  - Confidence: HIGH — publish-before-afterTick ordering verified at polling-store.ts:105-106.
  - Blind spot: None significant.
- **Decision**: FIXED — delivered-first "Board ready — opening…" branch added ahead of the status branches in PendingProposalPage.tsx; stopped-branch comment trued up. Verified: pnpm check 0 errors, page unit tests 5/5.

### F2 — `progress()` never-raises docstring has an uncaught escape path

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: services/solver/src/cpsat_service/supabase.py (progress)
- **Detail**: The catch tuple is `(SupabaseError, httpx.TransportError, ValueError)`, but `_headers()` → `sign_in()` runs inside the try; a 2xx Auth body missing `access_token` raises KeyError (non-object body: TypeError) — neither caught. Not a live bug: both call sites wrap in `except Exception`. Documentation-vs-code drift only.
- **Fix**: Widen the catch (or guard `sign_in`'s body access) so the "never raises" docstring is literally true.
- **Decision**: FIXED — progress() catch widened to `except Exception` with a comment naming the escape paths (malformed Auth body, RoleClaimError, non-JSON 2xx). Verified: ruff, mypy, 74 service tests green.

### F3 — Post-stop ladder tail is unbounded in theory

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: services/solver/src/cpsat_engine/solve.py (_run_ladder)
- **Detail**: External `stop_search()` records budget/None, never `cancelled`, so the cancelled break is taken by the NEXT stage's first improving solution. A post-stop stage ending UNKNOWN burns its full budget and the ladder marches on — the "at most one extra short solve" claim holds only when the hinted incumbent lands quickly (it does in practice; the live test pins tier <= stop+1).
- **Fix**: Optional belt-and-braces — check `hooks.should_stop` at the top of each ladder iteration. Acceptable as-is; the plan's honest-latency framing budgets for this.
- **Decision**: FIXED — `_run_ladder` asks `hooks.should_stop` at the top of each iteration (marking the run unproven on the break), docstring trued up, live test comment updated and assertion tightened to `tier == LIVE_STOP_TIER`. Verified: full solver suite 184 passed, ruff + mypy clean.

### F4 — A stop latched after the final stage writes `stopped` over a finished run

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — edge-of-race semantics; defensible as shipped
- **Dimension**: Safety & Quality
- **Location**: services/solver/src/cpsat_service/runner.py (_stop_outcome)
- **Detail**: The latch outranks the transcript (inherited S-304 rule), so a beat observing the flag between the last stage completing and `_stop_outcome` being read writes `stopped` with no `result`. Data-safe — the final stage's checkpoint IS the final board and it delivers — but the row loses `provenOptimal` and the copy says "stopped after stage 10". No action needed; known edge.
- **Fix**: None proposed — accept the semantics (the author did ask to stop).
- **Decision**: ACCEPTED — known edge; the latch-outranks-transcript keying is the inherited S-304 rule and stays untouched.

### F5 — Stop against a dead container resolves as `interrupted`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — bounded by design; no action needed
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/api/generation-stop.ts
- **Detail**: A stop on a running row whose container already died leaves "Stopping…" until S-304's staleness reclaim flips it to `interrupted` — the copy then attributes the halt to the platform, not the click. Bounded by the heartbeat grace; the plan's C5 line anticipated exactly this.
- **Fix**: None proposed — accept.
- **Decision**: ACCEPTED — matches the plan's C5 decision; the reclaim is on the NOT-doing list.

### F6 — Copy niggles: "You stopped" for every viewer; wait copy on queued; ~5 s re-clickable button

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; wording only
- **Dimension**: Pattern Consistency
- **Location**: PendingProposalPage.tsx / GenerationStatusStrip.tsx / StopAndKeep.tsx
- **Detail**: (a) Any authenticated user can stop any job (documented C14 non-goal), but "You stopped this generation" shows to viewers who didn't click — moot in a single-author deployment. (b) The dialog's "can take a few minutes" line also shows for a queued job, where the stop is instant. (c) After confirming, the button stays clickable for up to one poll tick (~5 s) until `stopRequestedAt` arrives — idempotent and safe via the first-writer-wins latch.
- **Fix**: Optional wording tweaks; all three are deliberate/harmless as shipped.
- **Decision**: SKIPPED — all three niggles deliberate/harmless as shipped.
