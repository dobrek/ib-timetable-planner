---
change_id: staged-progress-and-checkpoints
title: Staged progress and checkpoints
status: implementing
created: 2026-08-19
updated: 2026-08-20
archived_at: null
---

## Notes

### 2026-08-19 — Decision: the job progress UI splits by cost, and FR-308 needs no amendment

**FR-308 is satisfied by the existing static strip.** `GenerationStatusStrip` already renders status
plus `formatStarted(job.createdAt)`, SSR'd from the plan page frontmatter, so "the source plan shows
an advisory 'proposal in progress from <time> state' indicator" is true today. **No PRD amendment.**
The strip is left as-is — S-303 does *not* upgrade it in place, which makes its own
`"S-303 upgrades it in place"` docstring stale prose to true up rather than work to do.

**The live polled progress moves to the plans list instead** (FR-304's surface), as one entry in a
new `indicators: PlanIndicator[]` field on `PlanRow`. Reasons, in order of weight:

1. **It retires the slice's largest risk structurally.** Research rated the poll-inside-the-board
   island as orange and *unprovable by reading*: FR-312 isolation depended on the React Compiler
   memoizing a ~5-level identity chain with zero `React.memo` in the codebase. `PlansHub` is the only
   island on its page and has no board — the question disappears instead of needing a tripwire.
2. **It costs one query.** `generation_jobs … .in("status", ["queued","running"])` returns at most one
   row per plan by construction of the `generation_jobs_active_per_plan` partial unique index; the
   existing `1 + 3N` count fan-out is untouched.
3. **Build the slot, ship one occupant.** Exactly one indicator in S-303. `PlanRow`'s docstring
   records that derived quality metrics (valid/complete/used slots) were **explicitly deferred**, and
   most other candidate indicators are derived — i.e. per-plan board computation. The generation
   badge is uniquely cheap because it reads a durable indexed row. The list shape exists so later
   slices can add to it; S-303 does not pay for an unvalidated framework.

**Still true after the move:** the React 19 wall. `react-hooks/set-state-in-effect` applies to any
island, so `useSyncExternalStore` over an external store remains the required polling idiom — the
relocation shrinks the blast radius, it does not change the shape.

**Noted, not scoped:** a second cheap non-derived indicator is latent — "proposal" (this plan is a
generated clone). `plans` has no lineage column, so clones are indistinguishable in the hub while the
README warns they accumulate in production; `generation_jobs.proposal_plan_id`/`delivered_plan_id`
would come back on the *same* query. That belongs to S-306 — the indicator type should be able to
accept it without a retrofit.

See `research.md` § "Follow-up Research 2026-08-19" for the evidence.

### 2026-08-20 — Implementation record: what S-303 decided while building

**Clause 5 was renamed, not dropped.** The roadmap and PRD promised "the incumbent board + objective
tuple" per checkpoint. The solver cannot produce a true 10-tuple mid-ladder — that needs a separate
`evaluate_board` re-solve over the incumbent — so the checkpoint stores a full `GenerationResult`
(the same shape and the same `wire_result(to_generation_result(...))` path the terminal write uses)
plus the per-stage `best`/`bound` already in the transcript. Roadmap and PRD FR-303 are trued up to
say so; "strictly better" became **never worse**, which is what tier hardening actually guarantees.

**Targets ship latent.** `SOLVER_STAGE_TARGETS` (`tier=value[,tier=value]`, tiers 2–10) is empty by
default and empty means byte-for-byte the pre-S-303 ladder. Values are S-308's to measure: a target
is an objective VALUE and so hardware-independent, but the wall clock it saves is not, and no M-series
number may become a container's budget. Verified live on the seed fixture — a tier-6 target of 1050
ended that stage at 2.11 s of its 10 s budget with `stoppedBy: "target"`, and the next stage
warm-started from it. Worth recording for S-308: at a 10 s stage budget the seed reaches totalSlots
95–97 and studentHoles ~983–1036, so a target must be set *above* what the budget actually reaches
or it simply never fires (95 on tier 3 did not).

**`stopReason` and `stoppedBy` were widened together, bump-free.** `stopReason` gains `target` and
`interrupted`; `StageReport` gains optional `stoppedBy` (`budget | target | cancelled`). Both are
additive-and-optional, so `formatVersion` stayed at 1 and the goldens are byte-identical — the worked
example now recorded in `contracts/README.md`'s Versioning section. The result-level reason is
**derived** from the stages rather than chosen: cancelled wins outright; else target only if every
non-optimal stage reached its target; else budget.

**A cancellation ends the run.** Plan-review F6: without a break, one `should_stop` would cascade
through every remaining tier, each recording `cancelled` and burning a solve and a PATCH. The ladder
now breaks after a cancelled stage, and Mode A returns its complete-but-unoptimised board if the
feasibility solve itself is cancelled. The between-stages window is microseconds, so no pre-stage
poll was added — the next stage's first hinted solution catches it at the cost of one short solve.

**The poll gained a discovery read.** Plan-review F1: seeding the store from SSR alone leaves the
realistic two-tab flow broken — a hub open when Generate is pressed elsewhere has no job id, nothing
active, and so never starts a timer. A tab returning to the foreground now makes one read keyed by
the page's plan ids. The 5 s timer stays active-only; an idle hub still issues nothing.

**`suppressHydrationWarning` was the wrong fix for the start time, and the browser said so.**
Plan-review F2 proposed `<time dateTime suppressHydrationWarning>`. It silences the warning by
KEEPING the server's text, so a reader two hours ahead of UTC was shown 08:29 for a job they started
at 10:29 — verified in the browser during the Phase 5 walkthrough. Replaced with a `useHydrated`
store (`useSyncExternalStore`, server snapshot `false`): the instant always sits in `dateTime`, and
the readable time appears once there is a reader whose zone we know. Zero console errors after.

**Grants were pre-paid.** One migration adds SELECT on `heartbeat_at` (S-304's widened claim CAS) and
`stop_requested_at` (S-305's stop polling) and renames the policy honestly — one migration and one
test edit instead of three of each. UPDATE on `stop_requested_at` is deliberately withheld: the app
asks for the stop, the solver only observes it.

### Hand-offs

- **S-304** — `heartbeat_at` now renews per stage event (coarse: Mode A can run 300 s between
  renewals). The SELECT grant its widened claim CAS needs is already in place. Still owed: a timer
  thread for finer resolution, SIGTERM checkpointing, and the reclaim half — widening
  `status=eq.queued` so a row left `running` by a dead container is recoverable. Observed twice
  during this change's manual verification: killing the solver mid-solve wedges the row, and the
  `generation_jobs_active_per_plan` index then refuses the next Generate on that plan.
- **S-305** — the seam is wired and tested: `SolveHooks.should_stop` (engine honours it and breaks the
  ladder), `registry.attach_solver` (live handle, latest wins), `stoppedBy: "cancelled"` and
  `stopReason: "cancelled"` in contract, `stop_requested_at` readable. Owed: the button, the write,
  and the predicate that polls the column.
- **S-306** — `PlanIndicator` is a one-member discriminated union shaped to accept
  `{ kind: "proposal" }` without a retrofit; `proposal_plan_id`/`delivered_plan_id` come back on the
  same query the hub already makes.
- **S-308** — `SOLVER_STAGE_TARGETS` is the knob; the seed-fixture numbers above are the starting
  point, and the container's 4 workers are what the real ones must be measured on.
