<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Generation Engine Hardening & Search Upgrades

- **Plan**: context/changes/generation-engine-hardening/plan.md
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-07-12
- **Verdict**: APPROVED (PASS with 2 minor warnings)
- **Findings**: 0 critical  1 warning  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated gate (re-run this session)

- `pnpm check` — 0 errors / 0 warnings / 0 hints ✅
- `pnpm lint` — clean ✅
- `pnpm steiger` — clean ✅
- `pnpm test` — 1218 passed / 138 files ✅
- `pnpm build` — clean ✅
- Manual criteria: all 11 Progress items `[x]` with cited evidence (Playwright preview flows; bench dp1 50 / dp2 46 @ 9.2 s, 0 blocking).
- Post-triage re-run (after F1/F2/F4 fixes): `check` 0/0/0, `lint` clean, `test` 1218 passed.

## Verified-correct (plan's flagged high-risk items)

Checkpoint is `generated.slice()` copy · LNS never mutates incumbent · flagged-edge delta semantics (edge→interior only) · `removeWhere` throws on not-found · clique node-cap enforced with implicit greedy fallback · index rebuild is exact-inverse · all loops terminate · `maybeYield` time-slices at 25 ms · fuzz uses seeded `mulberry32` (no `Math.random`) · Workers-safe (no Node APIs).

## Findings

### F1 — Fail-fast precondition runs outside the worker try/catch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/model/generation/generate.worker.ts:36-40
- **Detail**: The Phase-1 precondition `verifyGeneration(snapshot, [])` ran before the `try` block. A synchronous throw there escapes `void run(...)` as an unhandled rejection — no `done`/`error` posted, so the hook hangs in the running state with no message, contradicting the engine path's "any throw → posted error" design.
- **Fix**: Move the precondition inside the existing `try` so a verify throw posts `{ kind: "error" }` like every other failure.
- **Decision**: FIXED — precondition relocated inside `try` (generate.worker.ts).

### F2 — `lowerBound` doc asserts an inequality that only holds when complete

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/entities/timetable/model/generation/types.ts:64-66
- **Detail**: `lowerBound` = max-weight conflict-clique hours; it lower-bounds occupied slots only when every clique course is fully placed. On an incomplete/infeasible instance (`unplaced > 0`), `occupiedSlotsAfter` can be strictly below `lowerBound`. The doc stated `occupiedSlotsAfter ≥ lowerBound` unconditionally. Latent — no consumer reads `lowerBound` yet, but the fuzz suite exercises infeasible instances.
- **Fix**: Soften the comment to state the `unplaced == 0` precondition and the clamp requirement for future consumers.
- **Decision**: FIXED — doc comment updated (types.ts).

### F3 — Cancel/yield granularity coarser than 25 ms during clique + stages 2–5

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance/Concurrency)
- **Location**: greedy.ts:163-166 (clique) · stages 2–5 (~506-602)
- **Detail**: The exact clique B&B and construction stages 2–5 run synchronously with no interior `maybeYield()`/`stopped()` check — yields live only at loop boundaries and stage 6's descent. Cancel latency is bounded by one construction pass (+ one clique solve), not the ~25 ms slice. At n≈40 this is well under the ~100 ms target (abort test resolves < 2 s), so no impact today; latent only for a much larger/denser catalog.
- **Fix**: None required at current sizes; if large catalogs appear, add a `stopped()`/`maybeYield` hook to the stage-2/5 cell loops and periodically inside the clique search.
- **Decision**: SKIPPED — no impact at current sizes; revisit if catalog size grows.

### F4 — One raw guarded `splice` bypasses the `removeWhere` helper

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: greedy.ts:714-716 (migration-rollback path)
- **Detail**: Phase 2.3 routed the four unguarded `splice(findIndex,…)` sites through `removeWhere` (throws on not-found). The migration-rollback path still used a raw `generated.splice(at, 1)` guarded by `if (at !== -1)`. Correct and safe as written, but the one removal not going through the throwing helper — the silent-drop class the phase closed could quietly reappear here in a future edit.
- **Fix**: Route the rollback removal through `removeWhere` (unindex becomes unconditional, matching the forward path).
- **Decision**: FIXED — rollback removal routed through `removeWhere` (greedy.ts).
