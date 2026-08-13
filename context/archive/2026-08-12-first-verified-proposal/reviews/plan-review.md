<!-- PLAN-REVIEW-REPORT -->
# Plan Review: First Verified Proposal (S-301)

- **Plan**: context/changes/first-verified-proposal/plan.md
- **Mode**: Deep
- **Date**: 2026-08-12
- **Verdict**: REVISE → SOUND after triage (all findings fixed in plan)
- **Findings**: 3 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING (fixed) |
| Blind Spots | FAIL (fixed) |
| Plan Completeness | FAIL (fixed) |

## Grounding

15/15 paths ✓, 10/10 symbols ✓, brief↔plan ✓. Deep verification additionally confirmed: RLS status-window narrowing is safe for the solver's own claim/finish writes (`finish` PATCHes while the row is still `running`; `supabase.py:174-177` already anticipates the narrowed window), `generation_jobs` schema readiness (incl. the `delivery` column and the partial unique index on `plan_id where status in ('queued','running')`), `authenticated`'s FOR ALL policy suffices for the delivery CAS and failure writes, `runVerifiedGeneration`'s injected-engine seam fits the delivery design, and TS↔Python hash parity is straightforwardly achievable (Web Crypto hex, no prefix; Python adds `hashlib.sha256` over the already-byte-gated canonical string).

## Findings

### F1 — Pinned-floor formula is wrong for co-taught and split-week pins

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details; Phase 1 #1; Phase 4 #2
- **Detail**: Plan stated the floor as "pins ∩ soft cells"; tier 5 actually counts one hit per pin row × per soft co-teacher (`objective.py:176-186`, `:107-110`). An undercounted floor makes `softHits == floor` infeasible-by-construction → fallback fires and the app mislabels a clean-as-permitted board as non-clean.
- **Fix**: Restated the floor as Σ over pin rows of (count of that course's `teacher_keys` soft at that cell) in Key Discoveries, Phase 1 #1, Critical Implementation Details, and Phase 4 #2; added engine test (f) for co-taught and week-split pin floors.
- **Decision**: FIXED

### F2 — Feasibility-stage clean constraint unimplementable as written

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details; Phase 1 #1
- **Detail**: (1) softHits var doesn't exist at the feasibility solve (tier machinery built after SAT, `solve.py:193-195,210`); (2) CP-SAT constraints can't be dropped, so "drop it and re-solve" needs a rebuild or assumption literal; (3) plan was silent on the constraint persisting through the ladder (it must, or tiers 2–4 hardening can push softHits above the floor).
- **Fix A ⭐ (applied)**: Build the soft-hits linear expression directly over `bundle.x` + pin constants pre-feasibility (helper reusing `_soft_index`/weights); on INFEASIBLE rebuild the model from the dump without it; constraint persists through the ladder.
- **Fix B (rejected)**: Assumption-literal-guarded constraint on one model — unproven interplay with `_run_solver`/ladder here; re-adds the pre-SAT tier-var bloat.
- **Decision**: FIXED (Fix A)

### F3 — Progress heading mismatch: Phase 1 "(Python)" suffix

- **Severity**: ❌ CRITICAL (mechanical contract)
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 heading vs ## Progress
- **Detail**: Body heading carried "(Python)"; the Progress subsection didn't — /10x-implement matches titles exactly.
- **Fix**: Dropped "(Python)" from the body heading.
- **Decision**: FIXED

### F4 — Delivery apply path cited bench prior art over the existing production wrapper

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 #1
- **Detail**: `applyGeneratedPlacements` (`src/_pages/plan-detail/api/placements.ts:106-116`) already wraps the `apply_generated_placements` RPC in the same slice, integration-tested, used by the history reconciler.
- **Fix**: Phase 4 #1 now points at the existing domain function instead of re-deriving the region shape from `bench/import-generated.experiment.ts`.
- **Decision**: FIXED

### F5 — Barrel-safety rule overstated the precedent

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details ("Barrel client-safety")
- **Detail**: The barrel already exports `api/solver-transport` (`index.ts:80`); only `astro:env/server`-touching modules are excluded. The "api modules must not be barrel-exported" rule could prompt an implementer to remove the existing export.
- **Fix**: Restated the rule as "modules importing astro:env/server (or composing one that does) stay off the barrel"; noted the solver-transport export must stay.
- **Decision**: FIXED

### F6 — Clean-label lookup into `stages` needs shape guards

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 #2
- **Detail**: `stages` shape varies (single completeness report on infeasible/unknown with `best` dropped; tiers 1+4 only in repair mode) — the tier-5 entry must be found by `tier === 5`, never array index, with absence handled.
- **Fix**: Added the lookup + "label unavailable" guard to Phase 4 #2 and its Contract line.
- **Decision**: FIXED
