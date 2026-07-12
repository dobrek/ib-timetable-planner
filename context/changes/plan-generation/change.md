---
change_id: plan-generation
title: Plan generation
status: impl_reviewed
created: 2026-07-11
updated: 2026-07-12
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Our application is an advanced assistant that helps users build a timetable plan. Some elements are automated, like finding courses that can be run in parallel or having instant feedback about violating constraints like teachers' availability, students' intersection, etc. However, the whole process of making the final plan is in the hands of the user. 

I want to explore an algorithm or process that could enhance automation, allowing us to generate a plan that finds the optimal solution. The user reviews the outcome and can make minor changes if needed.

## Planning session note (2026-07-11) — decisions to carry into /10x-plan

The planning session split this change: **rule capture was extracted to
`context/changes/day-scoped-course-rules/` (planned, prerequisite)** — the
`finishes_early` flag + CRUD, the blocking edge-of-day rule, and the warn-level 2/day
spread cap all ship there first. Re-run `/10x-plan plan-generation` after that change
completes. Decisions made in this session (beyond what frame.md/research.md record):

1. **Slot metric — per cohort, floor on each.** Each cohort's board counts its own
   occupied (day, period) cells; parity = neither cohort exceeds its manual plan's
   count; the objective minimizes the sum. No trading one cohort's regression for the
   other's gain.
2. **Objective priority — parity qualities first.** Completeness > hard rules >
   day-edge qualities (free slots at day edges, student day compactness) > slot-count
   reduction > teacher compactness / balanced daily load. A 48-slot plan with clean day
   edges beats a 46-slot plan with mid-day holes.
3. **finishes_early is a HARD rule** (author, supersedes the research follow-up's
   soft-objective formalization): validated like a collision in the core (blocking), a
   hard constraint in the generator model — a flagged course that can't sit at a
   student's day edge stays **unplaced** rather than placed mid-day.
4. **2/day cap**: hard in the generator model; warn-level in the interactive core
   (ships in the extracted change).
5. **Review UX v1**: `finishes_early` badge on chips/cells + a solve summary panel
   (slots per cohort vs manual best, unplaced count, budget used). Explicitly NOT
   selected: visual highlight of newly generated placements. Baseline stands: optimistic
   apply as one undo entry, unplaced-courses list, discard via undo.
6. **Engines — ship the spike winner only.** Spike both (or-tools-wasm CP-SAT + pure-TS
   greedy) behind one `generatePlan()` port; one engine goes to production; the loser is
   not maintained (port keeps the door open).

Remaining scope for this change once the prerequisite lands: `generatePlan(snapshot,
pins, config, budget)` port + snapshot assembly; Phase-0 spike + engine decision
checkpoint; production Web Worker seat with progress + cancel (10–30 s budget); atomic
`apply_generated_placements` RPC (delete-unpinned + bulk insert, one undo entry);
toolbar "Generate" button; review affordances (badge + summary panel); PRD amendment
reversing the auto-placement non-goal (`prd.md` Non-Goals + `roadmap.md` Parked).

Verified codebase facts worth keeping (from this session's exploration):

- **No COOP/COEP or any custom response-header config exists** — insertion points are
  `src/middleware.ts` (mutate `response.headers` after `next()`) or a `public/_headers`
  file (supported by the Workers assets binding). Needed only if CP-SAT wins (WASM
  threads).
- **No Web Worker exists anywhere in src/** — worker seat, Vite `?worker` wiring, and
  the progress/cancel protocol are all greenfield.
- **Toolbar seat**: `src/_pages/plan-detail/ui/PlannerBoard.tsx:262-298` — the
  `trailing` fragment of `PlanSummaryBar` (next to `ExportMenu`, `BoardSettingsMenu`).
- **Long-compute UX precedent**: `GroupingStalePanel.tsx` / `useRecomputeGroupings`
  (busy guard, inline `role="alert"` error, no toast).
- **Types regen**: `pnpm exec supabase gen types typescript --local` →
  `src/shared/api/database.types.ts` (archived docs cite the old `src/lib/` path).

## Phase 2 spike record (2026-07-11) — engine measurements & verdict

**Verdict: the pure-TS greedy engine ships.** CP-SAT (`or-tools-wasm@0.9.1`) fails three of
the four bars; per the plan's auto-rule the TS engine ships, the CP-SAT lane is not landed
(`or-tools-wasm` never entered `package.json`), and **no COOP/COEP headers ship** (the
middleware change was CP-SAT-only).

### or-tools-wasm CP-SAT measurements (Node 24, Apple Silicon, spike in scratchpad)

- Module load 8 ms; toy model (30×12) solves OPTIMAL in 228 ms — the API works.
- **No threaded build exists**: the package ships only `jspi`/`asyncify` single-thread wasm
  variants (no pthread artifacts, no `SharedArrayBuffer` use), so COOP/COEP would buy
  nothing. The research premise "WASM threads behind COOP/COEP" does not hold for 0.9.1.
- Real catalog (39+42 courses, 116+134 hours, joint two-cohort model, ~25.5k bools):
  default search finds **no feasible solution in 60 s** (hard-hours variant) or places
  19/250 rows (soft-completeness variant, 20 s). With `PARTIAL_FIXED_SEARCH` + a decision
  strategy it completes both cohorts but at **50/49 occupied slots, with zero improvement
  from 30 s → 60 s** (bar: ≤ 48/cohort in ≤ 30 s) → **bar 2 FAIL**.
- `onSolution` callbacks flush only when the solve returns (nothing streams mid-solve) →
  no usable progress signal (**bar 4 FAIL**) and cancel-keep-best would require blind
  time-slicing (**bar 3 FAIL**). Bar 1 (dev/preview worker load) was left untested — moot.

### TS greedy engine (shipped: `engines/greedy.ts`)

GRASP over a conflict-clique backbone: near-max-weight clique laid one-hour-per-cell,
most-remaining-first packing into used cells, depth-bounded randomized ejection-chain
repair, flagged edge-or-unplaced pass, slot-count descent by emptying cells, interior-hole
migration to day edges. Benchmark (`pnpm bench:generation`, real catalog, 20 s budget):

- **dp1: 116/116 rows, 50 slots, 0 interior holes; dp2: 134/134 rows, 48 slots, 0 holes;
  zero blocking violations (verify judge), 0 soft warns; elapsed ≈ 20 s** (a complete
  valid board exists after the first ~1 s attempt; the rest of the budget is descent).

### Parity analysis — the dp1 open question (for checkpoint 2.8)

- The manual plan's **per-cohort** occupied-slot counts are not recoverable locally: the
  seed carries no manual board, no `finishes_early` flags, and no availability rows. The
  frame records a single figure — "48 of 50".
- dp1's **conflict-clique lower bound is exactly 48** (an 11-course clique totalling 48
  hours), so 48 would be the theoretical optimum. CP-SAT warm-started **from** the greedy
  board (dp1 in isolation, 90 s) reaches **49** (proven bound 46) and relaxing the 2/day
  cap to 3 does not unlock 48 — dp1 = 48 appears unreachable (or near-unreachable) under
  the current hard-rule regime (hard 2/day cap + zero-blocking, incl. overlap-absorbed
  student conflicts).
- The benchmark therefore pins the shipped envelope **dp1 ≤ 50, dp2 ≤ 48** and the author
  should confirm at the checkpoint: the real manual per-cohort counts, and whether dp1's
  bar should be 49/50 given the bound analysis (or the rule regime revisited).