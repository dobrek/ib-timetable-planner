---
change_id: generation-engine-hardening
title: Generation engine hardening & search upgrades
status: implemented
created: 2026-07-12
updated: 2026-07-12
archived_at: null
---

## Notes

Follow-up to `plan-generation` (implemented 2026-07-11). A critical review of the shipped
GRASP engine (`src/entities/timetable/model/generation/engines/greedy.ts`, 2026-07-12,
in-session) found one confirmed correctness bug and several design flaws:

1. **Confirmed bug (reproduced with a throwaway test)**: placing non-flagged courses can
   box in existing flagged (`finishes_early`) rows — pins included — making them strictly
   interior for a shared student. The engine reports a complete board, `verifyGeneration`
   rejects it wholesale with `early-finish-edge`, and restarts cannot save it because the
   in-engine objective has no term for flagged violations (boxed and valid boards score
   identically; strict `<` keeps deterministic attempt 1). Repro: flagged pin at (1,2) on a
   1×4 grid with two single-hour same-student courses — engine packs periods 3 and 1.
2. Scalar score tier bleed: `studentHoles` (realistically > 100) outvotes the `slots × 100`
   tier, violating the documented objective ordering.
3. No intra-attempt best tracking: stage-6 descent + failed stage-7 migration can return a
   worse board than the constructive stages built; the board is scored once, at attempt end.
4. Cancel/progress dead zone: `runAttempt` is fully synchronous; attempt 1's descent holds
   the worker thread for ~40% of the budget, during which the cancel message cannot even be
   dispatched (`signal.aborted` physically cannot flip) and no progress ticks fire.
5. Search-quality: restarts discard all learned structure (LNS would convert budget into
   monotone improvement), `studentHoles` is never optimized by any move, the greedy clique
   could be exact (n≈40, once per call) for a provable bound + early exit, plus minor leaks
   (dp1 always seeds first, stage-6 candidate filter wastes slots on flagged-containing
   cells, stage-7 tries only the first interior hole, unguarded `splice(findIndex)` sites).

Decisions made in the planning session (2026-07-12): one change with correctness-first
phases; hard placement-time edge guard (matches the `plan-generation` decision that
`finishes_early` is a HARD rule); fail-fast precondition when pins alone already carry
blocking violations; hybrid search loop (few seeded restarts, then LNS destroy-and-repair);
stagnation-based early stop; property-based fuzz harness with verify-as-oracle. Benchmark
bars stay at dp1 ≤ 50 / dp2 ≤ 48 (no tightening in this change).

## Benchmark results (post-implementation, local Supabase, 2026-07-12)

`pnpm bench:generation` on "Seed Plan A" after all five phases, 20 s budget:

- **dp1**: 116 rows placed, **50 slots** (bar ≤ 50), 0 unplaced, 0 day-edge holes.
- **dp2**: 134 rows placed, **46 slots** (bar ≤ 48), 0 unplaced, 0 day-edge holes.
- **elapsed 9.2 s** (stagnation stop — well below the 20 s budget), 0 soft availability warns, 0 blocking violations.

Bars hold with margin on dp2 (46 vs 48); dp1 sits exactly on its bar (50). Elapsed dropping to
~9 s confirms the LNS + stagnation early-exit. These numbers are the reference for future
bar-tightening (roadmap checkpoint 2.8), still deferred per this change's scope.
