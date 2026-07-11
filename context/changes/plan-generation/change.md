---
change_id: plan-generation
title: Plan generation
status: preparing
created: 2026-07-11
updated: 2026-07-11
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