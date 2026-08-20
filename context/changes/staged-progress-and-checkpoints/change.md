---
change_id: staged-progress-and-checkpoints
title: Staged progress and checkpoints
status: plan_reviewed
created: 2026-08-19
updated: 2026-08-19
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
