# Frame Brief: Drift-decided delivery (S-306)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

The delivery model S-306 specifies — clone the plan at enqueue, solve on top of it, then let a
drift check decide automatically between auto-applying to the source and leaving a new plan —
carries costs and gaps that look disproportionate: a session-free write credential the project
has consistently refused, a dominance capability that exists nowhere, an "adopt" step that was
never defined, and an auto-apply branch whose value is in question.

## Initial Framing (preserved)

- **User's stated cause or approach**: the model automates a decision that should be the author's,
  and it materialises a mutable clone up front — before anyone has decided they want one.
- **User's proposed direction**: don't clone at enqueue. The job row *is* the proposal, rendered
  read-only. On completion the author explicitly chooses: merge into the original (when feasible),
  keep as a separate plan, or discard.
- **Pre-dispatch narrowing**: during a solve the author **leaves the source plan alone**; reviewing
  every result before it touches the plan **is the point, not a cost**; and of the three candidate
  drivers the author had **not separated them** — which is what this frame did.

## Dimension Map

1. **The delivery decision** — automating a choice the author wants to make themselves. ← reframe lands here
2. **The delivery artifact** — eager materialisation of a mutable clone nobody asked for. ← initial framing
3. **The trigger** — nothing notices completion; the clock and identity are the true gap.
4. **The review surface** — the author is handed a decision they cannot conclude. ← breaks hardest
5. **The requirement text** — the cost is an artifact of reading an inconsistent spec.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. The decision automation is the origin** | Auto-apply is the *sole* named beneficiary of "headless" (`prd.md:396-401`); it alone requires the session-free **write** identity the project refused twice by name (`archive/2026-08-20-job-aware-container-lifecycle/research.md:260-266`), the must-have clock, the TOCTOU exposure on a blind region replace, and the reason the `is_optional` digest gap is a safety hole (`wire.ts:151`). The pre-Socrates recommendation *was* a manual "Apply to source" button gated by the same drift check (`post-poc-cp-sat-refactoring-plan/research.md:292`); the reshape into auto-apply is one sentence with **no stated benefit** (`prd.md:338-343`). The persona line (`prd.md:125`), PSC #5 (`prd.md:154`) and the north star (`roadmap.md:24`) all still describe author-decides. Nothing else depends on it: S-305, S-309, FR-304/308/312 unaffected; only US-303 and PSC #4 are casualties. | **STRONG** |
| **2. Eager materialisation is the origin** | Between enqueue and delivery the clone has **no reader**: the poll projection omits `proposal_plan_id` (`generation-status.ts:29`), the strip guards on `job.delivered` (`GenerationStatusStrip.tsx:51`), the hub links to the source on purpose (`plan-indicators.ts:91-95`), the enqueue action returns the id and the client discards it (`use-generation-job.ts:94-97`), and the solver **cannot read the column at all** (`20260812141459…sql:41,71-72`). Meanwhile it is a visible, editable, deletable plan that can destroy a 20-minute solve (`impl-review.md:39`), generating 6 deletion sites across 2 duplicated definitions plus 2 unsweepable orphan classes. Lazy materialisation was called *coherent* twice and rejected in one clause on roadmap-wording and slice-boundary grounds — both now expired (`archive/2026-08-12-first-verified-proposal/change.md:111-114`). **Counter:** the eager clone is the only durable T0-faithful copy of the *display* catalog; `generation_jobs.snapshot` carries no `name`/`level`/`group_index` (`wire.ts:47-62`). | **STRONG** |
| **3. The trigger is the origin** | Verified during research: no `triggers`/`crons`/`queues` in `wrangler.jsonc`, `worker.ts:29` exports `fetch` only, no `pg_cron`/`pg_net`, no Edge Functions; `createClient` is request-and-cookie-bound (`shared/api/supabase.ts:6-25`). Real, but **downstream** — the must-have clock exists to serve auto-apply. Remove auto-apply and only S-310's **read-only** notifier clock remains. | **WEAK (derivative)** |
| **4. The review surface is the origin** | At the decision moment the author gets a link plus **one of ten objective tiers** (`GenerationStatusStrip.tsx:51-71`, `clean-label.ts:32`). Zero references to `/plans/compare` anywhere in `plan-detail/` — the only route in is hand-picking two plans by name on the hub. On a source-vs-clone pair the drift banner renders **nothing** (`plan-comparison.integration.test.ts:110-131`, `DriftBanner.tsx:29-30`), because a board-only edit moves `snapshot_hash` but not the catalog fingerprint — the very difference that triggered the branch is unrepresented. The page has **one** interactive element in the whole slice, a help popover (`MetricHelp.tsx:19`). "Adopt" has 12 prose occurrences and zero definitions. **Counter (accepted):** the *information* exists and is apples-to-apples — 42 rows from the same pure `analyzePlan`, plus a per-plan oracle verdict, with the flattery trap already closed (`PlanComparisonPage.tsx:87-93`). So the defect is **not** missing information; it is no route in, no voice on this pair, and no act to conclude with. | **STRONG** (mechanism corrected) |
| **5. The requirement text is the origin** | The gap is real — FR-313's subordinate clause vs the roadmap's standalone sentence (`roadmap.md:202`), PSC #5's weak reading, "polling + in-app now" (`prd.md:608-612`). But "on completion" is stated four times across three documents and never hedged, the Socrates resolution *deliberately deleted* the human trigger, and the weak reading **falsifies US-303's Given/When/Then** (it yields different verdicts, not just later ones). Adopting it in full removes exactly one of four costs. | **WEAK** |

## Narrowing Signals

- **"I leave the source alone during a solve."** Falsifies the load-bearing premise of `research.md` §5. Drift is the **rare** case; auto-apply would fire on the **majority** of runs — so the machinery is on the hot path, not an edge case.
- **"Reviewing is the point, not a cost."** Removes the only value auto-apply ever offered ("without further ceremony", US-303). Together with the above: the automation would fire often, doing something the author does not want.
- **"Mostly the board itself."** Dominance is **not** what produces confidence — it is not load-bearing for S-306 and should route to S-307 or drop. But this makes a **viewable board** the critical path, which is the eager clone's largest and previously unnamed purchase.
- **"Kept, I'll clean up later."** The author wants non-merged results to persist as plans by default. This **rules out** the proposed direction's "materialise only on keep".

## Cross-System Convention

This class of change is handled by **recorded re-grounding**, not silent reversal. There is no
precedent for overturning a Socrates resolution outright, but `prd.md`, `roadmap.md` and five
archived slices all carry explicit "Re-grounded / trued up \<date\>" notes that state what expired
and why (S-301 corrected two clauses of its own Outcome; S-304 re-grounded the containers#162
citation). The leading hypothesis matches: FR-307's premise — that removing a manual affordance is
a benefit — expired when the author said the affordance is not a cost.

## Reframed Problem Statement

> **The actual problem to plan around is**: S-306 is designed around the machine deciding delivery,
> but the author reviews every result — so the branch that will always execute is the one that was
> never specified, while the expensive machinery serves a branch the author does not want.

The three STRONG dimensions are one decision seen from three angles. Because the machine decides, it
must write unattended (→ credential, clock, TOCTOU, digest-as-safety-gate); because it writes
unattended, the target must pre-exist (→ eager clone, six deletion sites, the editable-clone hazard);
and because the automatic branch was the expected one, the review path never got a route in, a
banner, or a button. The author's two facts invert the central assumption: the exception becomes 100%
of runs. Addressed, S-306 stops being a credential-and-dominance problem and becomes a
review-and-decide problem built almost entirely from parts that already exist.

**The initial framing was half right.** Dimensions 1 and 2 are confirmed, and they are *mutually
necessary* — author-decides alone regresses clone hygiene (auto-apply was the de facto cleanup), and
later materialisation is its antidote. But the proposed direction did not name dimension 4, which
breaks hardest, and its specific form — materialise only on "keep" — is ruled out by the author's own
answers. The live materialisation question is **enqueue vs. completion**, not enqueue vs. never.

## Confidence

**HIGH** — three independent investigations returned STRONG with solicited counter-evidence weighed
in each; the two WEAK verdicts came from hypotheses genuinely tested to destruction (dimension 5 was
the "it's all a misreading" escape hatch and it failed); the narrowing signals were decisive and two
of them contradicted the user's own stated direction, which is evidence the process was not
confirming a prior.

Two errors in `research.md` were found and corrected in place: the "drift is the common branch" claim
(§5) is falsified, and the "verified-but-empty result marked delivered" hazard was already fixed in
S-301 (`impl-review.md:101-110`, `generation-delivery.ts:175-181`).

## What Changes for /10x-plan

Plan the **review-and-decide path as the only path**, not as the drifted exception. Auto-apply, the
session-free write credential and the must-have clock come off the table (S-310's read-only notifier
clock is a separate question that survives). Dominance is not load-bearing — route it to S-307. The
drift check survives, demoted from decider to gate-and-advisor, so F-301's frozen hash semantics
stand. Materialisation timing is now constrained on both sides — a viewable board and
persist-by-default — so the choice is enqueue vs. completion.

**The foundation re-grounding is done** (2026-08-28, before planning, at the author's direction).
Auto-apply removed and dominance routed to S-307, both by explicit author decision. Amended:
PSC #4; US-303 (retitled "Unchanged source merges in one confirmation" — its old Given/When was also
unsound, since "no edits during the solve" did not determine the branch); US-301; FR-306 (dominance
clause moved out, route-in and drift-signal moved in); FR-307 (rewritten — the retired Socrates
resolution preserved above the re-grounding); FR-309 (email half sharpened; the walk-away trigger
becomes S-310's, and is cheaper as a read-only identity); FR-313 (the "headless" clause read down to
its operative *location* meaning, already shipped); the Business Logic delivery rule; and the
shaping-resolutions closer. **PRD Open Question 4 opened** for materialisation timing rather than
pre-empting the plan. Roadmap: S-306 renamed and rewritten with two real Unknowns replacing `—`,
S-307 given sole ownership of dominance with its true size stated, S-310 given the inherited
trigger, plus the at-a-glance row, Stream D and the next-actions row. `/10x-plan` should now read
the amended FR-306/307/309/313 as current; the pre-2026-08-28 text survives only inside the
preserved Socrates blocks.

## References

- Research: `context/changes/drift-decided-delivery/research.md` (two claims corrected in place)
- Delivery pipeline: `src/_pages/plan-detail/api/generation-delivery.ts:28-34`, `:105-219`
- Enqueue + clone: `src/_pages/plan-detail/api/generation-job.ts:16-22`, `:110-135`
- Decision surface: `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:51-71`
- Review surface: `src/_pages/plan-comparison/` (`DriftBanner.tsx:29-30`, `metric-catalog.ts:17-22`)
- Board loader (no fetch/shape seam): `src/_pages/plan-detail/api/load.ts:50-163`
- Locked decisions to re-ground: `prd.md:331-344` (FR-307), `prd.md:246-256` (US-303), `prd.md:149-153` (PSC #4)
- Prior position: `context/changes/post-poc-cp-sat-refactoring-plan/research.md:292`
- Lazy-materialisation rejection: `context/archive/2026-08-12-first-verified-proposal/change.md:111-114`
- Investigations: four parallel hypothesis agents (dimensions 1, 2, 4, 5); dimension 3 carried
  forward from the research phase as already conclusively evidenced.
