# Board View-State Convention Rewrite — Plan Brief

> Full plan: `context/changes/board-view-state-store/plan.md`
> Frame brief: `context/changes/board-view-state-store/frame.md`

## What & Why

Rewrite the state-management convention instead of introducing a store. The frame found: **the convention (`ui-conventions.md:219-235` + the `PlannerGrid.tsx:17-25` docblock) is factually stale and states no adoption threshold or lane-choice rule — while the real per-flag authoring cost sits mostly outside the transport it debates**, in per-flag origin/persistence ceremony, control-surface widening, and transport-independent derivation plumbing.

## Starting Point

The section bans Context and selector stores in one breath, and cites a `useCellWiring` memo, a `PairedPlannerGrid`, and a "changes every drag tick" premise — all contradicted by current code (the first two were deleted in unify-views; `dropHints` changes at drag start/clear only). The stale text already propagated three false premises into this change's own notes. The frame refuted the store remedy at its own scope: ~1 of ~8 chain edit sites saved, on a one-island page where the rule's store exception doesn't apply.

## Desired End State

Every artifact stating the rule is verifiable against live code. The next "should this be a store?" challenge is answered by an explicit trigger checklist (with the current board as the worked example concluding "spread"), a lane-choice rule tells a new flag's author which of the four transport lanes to use, and `lessons.md` guards against convention amendments silently outliving their mechanisms.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Remedy | Convention rewrite, not store introduction | Store saves ~1 of ~8 sites at its own stated scope; no adoption trigger is met today | Frame |
| Scope | Plan-detail board only | User narrowed pre-dispatch; convention section is the board's rule | Frame |
| Artifacts | All three carriers + a lessons.md entry | Fixes every copy of the stale claims and captures the drift class that caused them | Plan |
| Rule shape | Trigger checklist + worked example | Closes future debates by checklist, matching the doc's rule+example style | Plan |
| Cost centers | Named in convention; follow-up noted in change.md, no new change folder | Keeps the evidence where the next author looks without committing unscoped work pre-lens | Plan |
| Research-doc handling | Dated addendum, not in-place rewrite | Research docs are dated snapshots; §4's directive stays correct, only its rationale updates | Plan |

## Scope

**In scope:**
- `ui-conventions.md` §"State management" rewrite (+ one-line stale-symbol fix at line 24)
- `PlannerGrid.tsx:17-25` docblock correction (comment-only)
- Dated addendum to `planner-board-search-discovery/research.md` §4 trap note
- New `lessons.md` entry (convention-amendment drift class)
- Follow-up recommendation recorded in `change.md`

**Out of scope:**
- Any store/Context/Jotai introduction
- Refactoring the measured cost centers (persistence micro-modules, control slot, derivation seams)
- Opening a follow-up change folder; touching the lens feature plan

## Architecture / Approach

Docs-and-comments only, zero runtime change. Phase 1 fixes the two normative sources atomically (they cite each other — same commit). Phase 2 propagates to the research note, adds the lesson, and records the follow-up. Verification is grep assertions plus `pnpm check`/`pnpm lint` proving the comment edit is inert.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Rewrite the normative sources | Accurate convention section + docblock, trigger checklist, lane rule, worked example | Threshold wording reads as false precision if numbers aren't honest |
| 2. Propagate & capture the lesson | Research §4 addendum, lessons.md drift-class rule, follow-up note | Lesson written incident-level instead of class-level |

**Prerequisites:** None — all evidence gathered in the frame; no running services needed.
**Estimated effort:** Single session (~1-2 hours), two small commits.

## Open Risks & Assumptions

- The rewritten checklist's thresholds are judgment calls grounded in today's measurements (~15 sites, 5 micro-modules); they should be presented as evidence-dated, not eternal.
- Assumes the lens change proceeds with the spread (per its own research) — if it pivots, the worked example needs a revisit, which the follow-up note anticipates.

## Success Criteria (Summary)

- No stale symbols or false frequency claims remain in any of the three carriers (grep-verified).
- A reader can resolve every claim in the rewritten section to a live symbol at the cited file:line.
- The next flag author can pick a transport lane, and the next store debate can be settled, from the convention alone.
