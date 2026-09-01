# Stop & keep (S-305) — Plan Brief

> Full plan: `context/changes/stop-and-keep/plan.md`
> Research: `context/changes/stop-and-keep/research.md`

## What & Why

Roadmap slice S-305 (PRD FR-305, US-302): the author can stop a running generation job and keep
the best checkpointed board, delivered onto the proposal clone rather than discarded. The
affordance must honestly name what is kept — the last *completed* stage's board, not the in-flight
stage. This is also a retirement precondition (S-309): greedy's cancel affordance was deleted with
nothing yet replacing it.

## Starting Point

Three prior slices pre-paid the expensive half: the `stop_requested_at` column, the `'stopped'`
status, the solver's stop latch with a documented second-producer seam, and a delivery chain that
already accepts a `stopped` row with a checkpoint (two passing integration tests against hand-made
rows). **What is missing is the producer**: nothing polls the flag, nothing writes it, and no UI
offers a stop. Zero migrations, zero wire-contract changes, zero delivery work.

## Desired End State

On a pending proposal page, an active job shows **Stop & keep**. A confirm step names the stage
being kept ("the board from stage k of 10", or "nothing yet") and is honest that stopping takes up
to a few minutes. Confirming stops a queued job immediately (app-side), or flags a running one —
the solver observes the flag within 15 s via its heartbeat, interrupts the solve, writes
`stopped`, and the page delivers the checkpoint board and navigates to it. A stop that races
completion just yields the full board.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Stop poll transport | Piggyback the 15 s heartbeat PATCH (`select=id,stop_requested_at`) | Zero extra requests, no new grant, terminal rows stop answering by construction | Research |
| Terminal-status keying | The latch, never the transcript | An async stop reads back as `"budget"`/nothing in the transcript — a scan would write `succeeded` over a stop (S-304's CRITICAL finding) | Research |
| Affordance placement | Pending proposal page only | It already polls and already holds `checkpointStageIndex` — the hub would cost a projection widening + a pinned-test edit | Plan |
| Stop on a `queued` row | App-side CAS `queued→stopped`, fallback to flag write | Works even with a dead/cold container; the row takes the existing sweepable path | Plan |
| Stop interaction | Confirm step naming the stage | FR-305's obligation lands at the moment of decision; latency honesty has a natural home | Plan |
| Wedged stop (dead container) | Reclaim keeps writing `interrupted`; copy differentiates | Purely cosmetic (delivery identical); avoids reopening S-304's stabilised reclaim CAS | Plan |
| Latency copy | Budget-derived, qualitative ("a few minutes") | Hardware-independent and always true; M-series measurements must not ship | Plan |
| Adjacent true-ups | PRD FR-305 + roadmap in-slice; strip stopped/interrupted vocabulary split | Docs stop lying when the slice ships; the strip split is load-bearing for the wedged-label choice | Plan |

## Scope

**In scope:** solver poll→latch→`stopped` producer (4 small Python edits); the missing live
`stop_search()` test; `stopGeneration` domain + action + client; `stop_requested_at` in the
pending-page projection (+ `sameView`); Stop & keep button with confirm + "Stopping…" state;
stopped/interrupted copy split; PRD/roadmap/comment drift sweep with a grep gate.

**Out of scope:** migrations, wire-contract changes, delivery changes, hub affordance or
projection widening, reclaim changes, solver claim-CAS changes, edits to applied migrations,
push/Realtime, un-stop.

## Architecture / Approach

App writes `stop_requested_at` (the author's authenticated session is the only legitimate writer —
the solver is barred from the column at the grant layer). The solver's existing heartbeat returns
the flag in the same round-trip, fires the existing latch with reason `"requested"`, and the
worker's existing latch-keyed terminal write maps it to `stopped`. Delivery is untouched: a
`stopped` row with a checkpoint flows through the existing verify → translate → apply chain; one
without a checkpoint is swept like a failed job.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Solver: the stop producer | Flag → latch → `stopped` row; the missing live `stop_search()` test | Breaking `progress`'s never-raises contract; live-solve test flakiness |
| 2. App: the stop write path | `stopGeneration` action (CAS + fallback) + flag in the view | The queued-CAS/claim race; `sameView` omission silently freezing the UI |
| 3. UI: affordance + vocabulary | Confirm-step button, "Stopping…", honest copy, strip true-up | Copy honesty (C1/C7): promise only what the mechanism does |
| 4. Docs & drift sweep | PRD/roadmap true-ups, eight comment fixes, grep gate | Missing a falsified comment (highest-frequency finding in this slice family) |

**Prerequisites:** none open — S-303 done; S-304/S-306 shipped. Local stack + `mise run solver:dev` for manual verification.
**Estimated effort:** ~2–3 sessions across 4 phases; Phase 1 is the largest.

## Open Risks & Assumptions

- Worst-case stop latency is ~5 minutes (unproductive stage burns its full budget + 15 s poll);
  the UX mitigates by copy, not mechanism — if that disappoints, push (Realtime) is the recorded
  upgrade path, out of scope here.
- A stop cannot reach a dead container; the row lands `interrupted` after the 5-minute grace and
  only the copy tells the author their stop was received (accepted trade-off, decision Q4).
- The live-solve test's timing assertion must be generous enough to survive CI hardware variance.
- No per-author ownership exists — any authenticated user can stop any job; copy must not imply
  otherwise (single-tenant app, consistent).

## Success Criteria (Summary)

- The author can stop a running generation and end up on the delivered checkpoint board, with the
  affordance having named exactly the stage that was kept.
- A stop on a queued job terminalises it cleanly and sweeps the clone; a stop racing completion
  yields the full board without an error.
- Both new tests (poll→latch→`stopped`; live `stop_search()`) and every existing pin stay green;
  no grant widened; no doc left claiming S-305 is future work.
