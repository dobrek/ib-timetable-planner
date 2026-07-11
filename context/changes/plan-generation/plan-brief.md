# Plan Generation — Plan Brief

> Full plan: `context/changes/plan-generation/plan.md`
> Frame brief: `context/changes/plan-generation/frame.md`
> Research: `context/changes/plan-generation/research.md`

## What & Why

Hours of human combinatorial search-and-backtracking to assemble a two-cohort plan — to
be eliminated by a generator that produces a complete, all-rules-respecting plan at
**manual-parity quality or better** (≤ 48 occupied slots, free slots at day edges, both
captured tacit rules honored) in **minutes instead of hours**. This reverses the PRD's
standing auto-placement non-goal, whose NP-hardness premise research falsified at this
instance scale (~40 courses / 50 slots per cohort — CP-SAT territory measured in seconds).

## Starting Point

Both prerequisites shipped 2026-07-11: `day-scoped-course-rules` put the two tacit rules
into the schema and interactive validator (`finishes_early` flag + blocking edge-of-day
rule; warn-level 2/day spread cap), and `clone-plan-without-board` provides the test
bench (clone the real plan's catalog onto an empty board). The codebase already has the
feasibility oracle (`deriveCellViolations`, ~0.3 ms per full board), snapshot-cheap
optimistic state with undo, and atomic-RPC persistence patterns — only the search loop
in the middle is missing.

## Desired End State

On a plan with gaps, the author clicks **Generate** in the board toolbar; within ~20 s
(progress shown, cancellable) the board fills with placements honoring every hard rule
at ≤ the manual plan's occupied-slot count per cohort. The result is one undo press to
discard, one atomic RPC in the database, and a summary panel reports slots per cohort,
unplaced courses, and budget used. Flagged early-finishing courses carry a badge
explaining their day-edge placement.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Success bar | Time-to-parity, not optimality | The pain is search time; 48 slots is a floor, improvement is a soft prize. | Frame |
| Generation mode | Fill-the-gaps only; board placements are always pins | Removes clear-and-regenerate and pin-UI scope; empty board = full generation. | Research |
| Engines | Spike both (or-tools-wasm CP-SAT + pure-TS greedy) behind one port | Kills the only research risk before committing; loser is deleted. | Research |
| Engine winner rule | **Auto: CP-SAT if it passes all bars**, else TS greedy | Optimality proofs + native pinning favored by default; measurable bars (parity ≤48/cohort in ≤30 s, dev+preview load, cancel-keep-best, progress) decide without debate. | Plan |
| Seat | Client-side Web Worker, 10–30 s budget | Unlimited wall-clock, natural progress/cancel, zero server cost. | Research |
| Config surface | **Zero-config button** (~20 s constant budget) | Matches time-to-parity; no options UI to maintain in v1. | Plan |
| Cancel semantics | **Keep best-so-far** ("Stop & keep") | Never wastes compute; accept-and-flag renders partials; undo is the escape. | Plan |
| Dirty board | **Block until clean** — Generate disabled while blocking violations exist | Guarantees fully-valid output and simplifies the model (pins always valid). | Plan |
| Hard-rule set | 5 core constraints + 2/day cap hard + finishes-early edge-or-unplaced | Author decision: flagged courses stay unplaced rather than sit mid-day. | change.md |
| Objective order | Completeness > hard rules > day-edge qualities > slot count > compactness/balance | A 48-slot plan with clean day edges beats a 46-slot plan with mid-day holes. | change.md |
| Persistence | One `apply_generated_placements` region-replace RPC serving apply, undo, and redo | One atomic transaction; batch undo would otherwise decompose into ~N RPCs. | Plan |
| Undo granularity | One press reverts **both cohorts** (history entry extension) | History entries are cohort-scoped today; one Generate must be one undo. | Plan |
| Benchmark | **On-demand parity benchmark + fast CI smoke** on a synthetic catalog | Real criterion stays executable without slowing or flaking CI. | Plan |
| Review UX | Badge + summary panel only; no highlight of new placements | Explicitly rejected by the author in the planning session. | change.md |

## Scope

**In scope:** `generatePlan()` port + snapshot assembly + trust-but-verify judge;
two-engine spike with auto-decision checkpoint; COOP/COEP middleware (CP-SAT path only);
production Web Worker with progress/cancel; `apply_generated_placements` RPC + batch
reconcile recognizer + two-cohort undo entry; toolbar Generate button with disabled
states; solve summary panel; `finishes_early` chip badges; benchmark + CI smoke; PRD
non-goal reversal + roadmap un-park.

**Out of scope:** pinning UI / clear-and-regenerate; config UI (budget, weights);
infeasibility explanations; server-side generation; maintaining the losing engine;
grouping coupling; new Playwright specs; durable undo history.

## Architecture / Approach

Pure generator core joins the scheduling domain in
`src/entities/timetable/model/generation/` (types, deficits, verify, engines); the
worker entry, orchestration hook, and UI live in `src/_pages/plan-detail/`. Engines
consume a snapshot only (no grouping dependency) and are judged by
`deriveCellViolations` before anything touches the board. The apply path is: verify in
worker → one optimistic batch per cohort → one plan-scoped RPC → one two-cohort history
entry, with a batch recognizer so undo/redo also runs through the same RPC. Everything
engine-sized is lazy-loaded on first click.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Generator foundations | Port, snapshot, deficits, verify judge, synthetic fixtures | Deficit semantics drifting from courses-left |
| 2. Engine spike & decision ⏸ | Both engines, benchmark, COOP/COEP, auto-verdict recorded | or-tools-wasm young dep; neither engine reaching parity (escalate) |
| 3. Atomic apply + undo | Region-replace RPC, batch verb, two-cohort undo entry, recognizer | week/is_optional loss on reinsert; history invariants |
| 4. Worker seat + Generate UX | Protocol, hook, button, summary panel, badges; acceptance test | Cancel-keep-best plumbing; disabled-state correctness |
| 5. PRD & roadmap amendment | Non-goal reversed, FR registered, roadmap un-parked | — |

**Prerequisites:** local Supabase stack for integration tests and the benchmark; the
real plan present for parity measurement (via catalog-only clone).
**Estimated effort:** ~4–6 sessions across 5 phases; Phase 2 ends in a hard checkpoint.

## Open Risks & Assumptions

- `or-tools-wasm` is young (v0.9.x, single maintainer) — pinned exact, wrapped behind
  the port, spiked before anything depends on it.
- If or-tools-wasm can't run under Node, the CI smoke covers the TS pipeline only and
  the CP-SAT benchmark lane moves to a browser context (documented in the harness).
- COOP/COEP applies to every page — spike bars include auth + data-load verification in
  dev and preview; not shipped at all if the TS engine wins.
- If **neither** engine reaches parity on the real catalog, the plan stops at the
  Phase 2 checkpoint and escalates rather than shipping a below-floor generator.
- Assumes the manual plan's per-cohort occupied-slot counts are measurable at benchmark
  authoring time (the 48-slot figure from the frame).

## Success Criteria (Summary)

- On the real catalog, Generate produces a complete, zero-blocking-violation board at
  ≤ the manual plan's per-cohort slot counts within 30 s — enforced by a committed,
  runnable benchmark.
- One click to generate, one undo press to discard (both cohorts), reload-safe
  persistence via a single atomic RPC.
- The author reviews rather than assembles: summary panel + badges explain the result;
  hours of manual search become a sub-minute wait.
