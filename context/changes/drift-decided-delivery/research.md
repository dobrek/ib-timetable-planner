---
date: 2026-08-28T09:11:28+02:00
researcher: Dobromir Kropielnicki
git_commit: 9d53c6ed6ee8a56ebbe40087df45c17e4b8c55fd
branch: main
repository: dobrek/ib-timetable-planner
topic: "Feasibility and challenges of implementing roadmap slice S-306 (drift-decided delivery)"
tags:
  [
    research,
    codebase,
    s-306,
    cp-sat,
    generation-jobs,
    drift,
    delivery,
    snapshot-hash,
    plan-comparison,
    dominance,
    headless,
    notification,
  ]
status: complete
last_updated: 2026-08-28
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Corrected two claims during /10x-frame: drift frequency (§5) and the stale verified-but-empty hazard (§8)."
---

# Research: Feasibility of implementing S-306 (drift-decided delivery)

**Date**: 2026-08-28T09:11:28+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `9d53c6ed6ee8a56ebbe40087df45c17e4b8c55fd`
**Branch**: `main`
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check the feasibility and challenges of implementing **S-306 — drift-decided delivery**
(`context/foundation/roadmap.md:200-210`): "unchanged source auto-updates; changed source yields a
new plan reviewed on the comparison page". PRD refs FR-306, FR-307, FR-313, US-301, US-303.

Scope agreed before research (all four dimensions): the drift-detection and delivery-decision
mechanics, the comparison page as the review surface, headless delivery and where the oracle runs,
and coupling to the adjacent slices S-303/S-304/S-305/S-310.

## Summary

**S-306 is feasible, and the mechanical half is unusually well pre-paid.** Four predecessor slices
deliberately shaped the ground for it: the schema columns exist (`delivery`, `notified_at`,
`delivered_plan_id`), two foreign keys are `on delete set null` *specifically* so S-306 can delete
the working clone, the delivery chain is already parameterized over its payload, the oracle already
runs server-side in that chain, `courseId` translation is a **no-op** in the apply-to-source
direction, and the plans-hub indicator union was shaped to accept `{ kind: "proposal" }` without a
retrofit. The drift predicate itself is one SHA-256 comparison against a baseline nothing can
rewrite. If S-306 were only "compare a hash and branch", it would be a small slice.

**It is not a small slice, and the roadmap's `Unknowns: —` is the most misleading line about it.**
Research surfaced six challenges the roadmap does not name, two of which change the slice's shape:

1. **The headless trigger does not exist, and the blocker is identity, not scheduling.** Delivery
   today fires on an SSR page visit. There is no cron, no queue, no `scheduled` handler, no DO
   alarm, no `pg_cron`. Adding a clock is easy; giving it a database identity is not — the Worker
   holds only the publishable key, `createClient` is request-and-cookie-bound, and `anon` is revoked
   on every domain table. The codebase states this gap in its own docblock
   (`src/_pages/plan-detail/api/generation-delivery.ts:28-34`).
2. **"Dominance information" does not exist anywhere in the repo**, and the comparison page is
   deliberately architected to make judgement impossible — a principle restated in five files and
   physically enforced by its data shape. FR-306's "no new side-by-side surface" is true and cheap;
   "with dominance information" is a net-new capability that reverses a recorded design decision.

Both are *decisions* rather than walls. But they are the two the plan must settle before it can
estimate anything, and neither appears in the roadmap's Unknowns.

**The sharpest single finding:** the PRD is internally ambiguous about what "headless" means, and
the two readings imply very different slices. FR-313's clause — the oracle runs server-side "so
headless delivery is verified without a browser open" — is about *where the oracle executes*, and
**S-301 already satisfies it**. The roadmap's S-306 Outcome sentence ("no browser needs to be open")
reads far stronger. Meanwhile the PRD's own Primary Success Criterion #5 says "on return the
finished proposal is there" — which is the *weak* reading, explicitly. The weak reading makes S-306
a medium slice built entirely out of existing parts. The strong reading adds a credential-design
sub-project roughly the size of F-301 — and, critically, **S-310 (completion email) is unsatisfiable
under the weak reading**, because an email that only sends when you come back and load the page
defeats the "kick it off and walk away" purpose it exists for.

**A second finding worth carrying into planning** — ~~under real usage the auto-apply branch will be
the *rare* one~~ — **was wrong; see the correction at §5 below.** Drift is the *rare* case, not the
common one, and auto-apply would fire on the majority of runs.

### Pre-paid vs. net-new, at a glance

| S-306 needs                          | State today                                                                                                        | Cost      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------- |
| A drift baseline nothing can rewrite | `generation_jobs.snapshot_hash`, written once at enqueue; the solver's UPDATE grant deliberately omits it          | free      |
| Re-derive the T1 hash                | the enqueue path re-run read-only (`assembleSource` → `computeSnapshotHash`); needs extraction from a private const | small     |
| Apply to the **source**              | `apply_generated_placements` + typed wrapper exist; translation is a no-op in this direction                       | small     |
| Delete the clone after auto-apply    | delete primitive exists in 4 call sites; FKs are `set null` *for this*                                             | small     |
| Mark how it was delivered            | `delivery text` column exists, no CHECK — "S-306's to declare"                                                     | 1 migration |
| Proposal badge on the hub            | `PlanIndicator` union pre-shaped for `{ kind: "proposal" }`                                                        | small     |
| Deep-link to the comparison page     | both ids in hand at the strip; `?plans=<source>,<proposal>` gives the right wording direction                      | one-line  |
| Server-side oracle in the pipeline   | shipped in S-301 — do not re-plan it                                                                               | free      |
| **A completion clock**               | **nothing exists**; no cron/queue/alarm/`scheduled`                                                                | **large** |
| **A session-free DB identity**       | **does not exist**; both obvious sources are documented posture violations                                         | **large** |
| **Dominance information**            | **does not exist at any layer**; wire contract excludes the input it needs                                         | **large** |
| A drift banner the author can see    | the page's existing `DriftBanner` renders **nothing** on a source-vs-clone pair                                    | medium    |
| An "adopt" mechanism                 | undefined in the entire record; page has zero mutation wiring                                                      | medium    |
| A notification event                 | `notified_at` unused; no decision on event-vs-render                                                               | medium    |
| E2E for Generate                     | owned by S-306 by explicit resolution; lane has no DB access                                                       | medium    |

## Detailed Findings

### 1. What S-306 inherits — the delivery pipeline is built, correct, and idempotent

The chain from a terminal row to a board on a plan already exists end to end in
`src/_pages/plan-detail/api/generation-delivery.ts`:

| Step                          | Location                                        |
| ----------------------------- | ----------------------------------------------- |
| stale-row reclaim CAS (S-304) | `generation-delivery.ts:114`, `:143`            |
| deliverability gate           | `:132-134`                                      |
| heavy payload read            | `:343-358` (`snapshot` + `result`\|`checkpoint`) |
| **server-side oracle**        | `:185` → `run.ts:17-32`                          |
| `courseId` translation        | `:198` → `course-map.ts:30-60`                   |
| atomic apply                  | `:212`, `:262-274` → `placements.ts:112-133`     |
| delivered marker CAS          | `:213`, `:378-386`                               |
| orphan-clone sweep            | `:124`, `:177`, `:192`, `:407-411`               |

It is idempotent under concurrent invocation (the marker is a compare-and-set, and two tabs firing
is documented as the normal case), crash-safe (the marker is written last), and the narrow-projection
discipline is treated as correctness-adjacent rather than an optimisation.

**S-304 already made the completion branch three-way, which pre-pays S-306's structure.** Delivery
accepts `succeeded`, and `interrupted`-with-checkpoint (the checkpoint is a full `GenerationResult`,
shape-identical to `result`, so no payload branching is needed). This means S-306's drift check is a
*decision placed before an existing pipeline*, not a new pipeline. It also means the drift branch has
to be made for **three** delivery-eligible terminal states once S-305 lands `stopped`, not one.

**`courseId` translation is a no-op in the apply-to-source direction.** The snapshot is assembled and
hashed from the *source* (S-301's id-space decision, forced by `clone_plan` re-minting every course
UUID — measured 0 of 84 survive). So `result.placements[].courseId` are already source-space UUIDs,
and the oracle at `:185` already verifies against that same source-space snapshot. `buildCourseIdMap`
exists *only* to bridge into the clone. Applying to the source needs no translation and no
re-verification redesign.

### 2. Challenge A — the headless trigger: no clock, and no database identity for one

**The trigger today is an SSR page render.** `src/pages/plans/[id]/index.astro:29-38` calls
`checkGeneration` in the page frontmatter. The only other invocations are the strip's manual Refresh
button and the read-back immediately after clicking Generate. The plans-hub poll explicitly refuses
to deliver — its projection does not even include `result` or `snapshot`, so it cannot deliver by
accident (`src/_pages/plans-list/api/generation-status.ts:8-12`).

Consequence, stated concretely: with the tab closed at minute 3 of a 12-minute solve, the solver
writes `succeeded`, and then **nothing happens**. The oracle has not run. The clone holds only the
author's pins. The hub, if reloaded, says "Finished — open plan" pointing at the *source* — and the
comment explains why: delivery happens on a visit to the source. **The UI instructs the human to be
the trigger.** There is a durable, unbounded catch-up (the next render delivers, however much later),
so nothing is lost — but this is *deferred* delivery, not *headless* delivery.

**Background-execution infrastructure available today: none.** Verified directly against
`wrangler.jsonc` — the file has `main`, `compatibility_*`, `assets`, `observability`, `containers`,
`durable_objects`, `migrations`, `dev`, and no `triggers`, `crons`, or `queues` key. `src/worker.ts:29`
exports `{ fetch }` only, and `ExportedHandler` in `src/cloudflare-env.d.ts:70-72` models only `fetch`.
`ctx.waitUntil` is typed but never called anywhere in `src/`. `pg_cron`/`pg_net`/`pgmq` are absent —
`moddatetime` is the only `create extension` in the whole migration tree. There are no Supabase Edge
Functions.

Two primitives are *nearly* there. `SolverContainer` already runs a timer-driven, request-free
callback (`onActivityExpired`, `src/solver-container.ts:81-95`) — live proof the DO wakes on a timer
with no request — though it deliberately does not override `alarm()` (`:78-79`), and
`@cloudflare/containers` ships a first-class `Container.schedule()` the SDK recommends over raw
alarms, currently unused.

**But the clock is the easy half. The hard half is identity.** The only client factory is
`createClient(requestHeaders, cookies)` (`src/shared/api/supabase.ts:6-25`) — request-and-cookie-bound
by construction. Every domain table's RLS is `for all to authenticated`, and `anon` is revoked at the
grant layer. The Worker's secrets are `SUPABASE_URL`, the **publishable** `SUPABASE_KEY`, and
`SOLVER_MACHINE_PASSWORD` (which the README is explicit the Worker never uses itself — it is a
courier). So a `scheduled()` handler would produce an `anon` client that cannot read
`generation_jobs`, let alone write `placements`.

**The solver cannot do the delivery — this architecture is definitively ruled out**, on four
independent grounds, and the first is decisive: `solver_job_writer` cannot *see* `plan_id` or
`proposal_plan_id` (both are outside its column-scoped SELECT grant), so it does not know which plan
its job belongs to. The privileges are measured, not assumed —
`src/test/solver-credential.integration.test.ts:188-244` asserts the role holds **zero** privileges
on `public.plans`, exactly five readable and eleven writable columns on `generation_jobs`, and
`rolbypassrls = false`. `apply_generated_placements` is `security invoker` with an explicit
*"Do NOT switch to DEFINER"* in its header, so even calling it would fail on `placements`.

#### The requirement ambiguity that must be settled first

| Reading                                                      | Source                                                        | What S-306 costs                          |
| ------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------- |
| **Weak** — the oracle runs server-side; the author's next visit is the clock | FR-313's literal clause; PSC #5 *"on return the finished proposal is there"* | medium slice, entirely existing parts     |
| **Strong** — delivery happens with no tab open anywhere       | roadmap S-306 Outcome, *"no browser needs to be open"*        | + a clock **and** a new machine principal |

FR-313's *location* requirement is **already satisfied by S-301** — do not re-plan it. What is
unresolved is whether S-306 owes a real actor.

**Candidate architectures, costed:**

- **A. Deliver from the `/plans` hub poll.** Cheapest by far; the poll already runs every 5 s while a
  job is active, on a page the author *is* looking at, with the author's own session. The in-code
  objection (concurrency, delivering from a page the author is not watching) is materially weaker
  than when written — the delivered-marker CAS makes concurrent delivery safe, and the module itself
  now says two-tab racing "is the normal case rather than an edge one". **Still requires a browser**,
  so it satisfies only the weak reading — but it shortens the delivery latency from "next visit to
  the source plan" to "≤5 s while any hub tab is open", which is most of the perceived benefit.
- **B. Cron trigger + a machine identity.** The conventional answer, and the one that also subsumes
  S-304's reclaim-on-visit hack and unblocks S-310. Needs `triggers.crons` in `wrangler.jsonc`, a
  `scheduled` export, an extension to the hand-written `cloudflare-env.d.ts` (**never run
  `wrangler types`**), and — the real cost — a database identity. The repo already has the pattern:
  a machine Auth user + Custom Access Token Hook + a narrow Postgres role, exactly as
  `solver_job_writer` was built. **The recorded objection is about reusing the solver's credential,
  not a prohibition on a second machine principal** — so this is priced, not forbidden. The shape
  worth pricing is a *narrow `security definer` delivery RPC* + a role whose only privilege is
  EXECUTE on it, which keeps the role from needing blanket write on `placements`/`plans`/`courses`.
  Note `20260812141459:51-53` already flags `security definer` as the priced-but-deferred escape for
  this class of problem.
- **C. DO alarm / `Container.schedule()`.** No new binding or wrangler config, and the DO already
  holds `SUPABASE_URL`/`SUPABASE_KEY`. But the delivery core lives in `_pages/plan-detail/api/` and
  `src/solver-container.ts:11-15` forbids anything in the FSD layers importing it — the DO importing
  *downward* is architecturally backwards, so the delivery core would have to move. **And the
  identity problem is unchanged.**
- **D. Solver callback to a Worker endpoint.** Immediate, no timer — but the identity problem is
  unchanged, it needs a `PUBLIC_PREFIXES` widening in `src/middleware.ts:7-11` plus shared-secret
  auth, and it breaks exactly when the container dies, which is the case S-304 exists for. It needs
  the timer fallback anyway, so it is B or C plus surface.
- **E. Solver-driven delivery.** Ruled out (above).

**Recommendation for the plan:** settle the reading out loud, the way S-304 settled its
reclaim-actor question. Option A satisfies the weak reading cheaply and honestly; if the strong
reading is wanted, price B as its own phase and be explicit that S-310 depends on it.

### 3. Challenge B — "dominance information" does not exist, and the review surface forbids judgement

The *surface* is genuinely free. `src/_pages/plan-comparison/` is 26 files / ~1,400 LOC: an SSR'd,
N-plan (capped at 8), URL-addressable route at `/plans/compare?plans=<uuid>,<uuid>[,…]`, with 42
metric rows across four scoreboard sections, the `verifyGeneration` oracle verdict per plan, catalog
warnings, and five-number distributions. Per-plan error isolation and the 404/503/empty-state matrix
are done. It needs **no structural change** to show a source beside its proposal, and
`?plans=<source>,<proposal>` even makes the source the wording reference, so the copy reads in the
right direction.

**The content FR-306 names is the problem.** `grep -rin "dominan\|pareto"` across `src/`,
`services/`, `contracts/` and `bench/` returns: a CP-SAT presolve log line in a fixture, the word
"dominant" describing tier priority in a comment, and a CSS rule. **There is no dominance code at any
layer.** The nearest primitive, `compareObjectives`, is *lexicographic* — a different relation, which
will happily call A "better" when A is worse than B on eight of ten tiers.

Three hard blockers:

- **Neither side of the wire produces an objective tuple for a board.**
  `contracts/generation-wire.schema.json:180` is explicit that the 10-tuple objective "is NOT part of
  it — that is bench transport", and the per-stage `best`/`bound` are documented as upper bounds
  under `tier_k <= best_k` hardening, "not the finished board's objective". The source plan was never
  solved at all. **Both tuples would have to be computed app-side.**
- **The machinery is reachable but unwired.** `scoreCandidate` (`objective.ts:98`) is exported
  through the entity barrel (`src/entities/timetable/index.ts:32`, via `export * from
  "./model/generation/objective"`), and `LoadedPlan` already carries `snapshot` and `board`. The
  missing input is `remaining: Map<string, number>`, which the bench derives from solver diagnostics
  a persisted plan does not have — it would need re-deriving from `analyzePlan`'s
  `completeness.unplaced`. Today `scoreCandidate`'s only callers are the greedy engine and one bench
  experiment — **and S-309 deletes greedy**, so the plan must decide whether `objective.ts` is engine
  code or product code.
- **It reverses the page's stated purpose, restated verbatim in five files** —
  `metric-catalog.ts:20-22` ("It reports; it never judges. No pass/fail bar, no ranking, no composite
  score, no baseline-relative delta — each would smuggle back the scalar the analyzer exists to
  avoid"), `scoreboard.ts:16-19`, `compare-params.ts:6-8`, the page's own subtitle at
  `PlanComparisonPage.tsx:32` ("the numbers are the evidence; the judgement is yours"), and
  `bench/plan-quality.analyze.ts:16-18`. This is not a style preference: it is a recorded lesson (the
  "weighted-scalar tier-bleed bug"), and it is *physically enforced* — every row formats to a
  `MetricCell` that is a finished **string**, specifically so nothing downstream can subtract one row
  from another. A dominance verdict is precisely a machine judgement with a direction, and it must
  live outside that pipeline.

**Scope-ownership ambiguity, unresolved anywhere.** Dominance appears in FR-306 (S-306's) *and* in
the PRD's Business Logic and S-307's outcome ("boards are dominance-checked before presentation so a
strictly-worse board is never offered"). The two slices are parallel and both hang off S-301.
**If S-307 owns the dominance primitive, S-306's page work collapses to a deep-link plus a banner,
and "deliberately small" becomes accurate.** If S-306 owns it, the slice quietly carries an
engine-adjacent feature. Nothing in the record decides this. Resolving it in S-307's favour is the
single highest-leverage scope decision available.

#### The drift-name collision (a real UX hazard, unflagged)

The comparison page **already owns a concept called "drift", and it is not FR-307's**:

|           | comparison page                                  | FR-307 / S-306                     |
| --------- | ------------------------------------------------ | ---------------------------------- |
| Question  | are these **two plans'** catalogs equal?         | did **one plan** change since T0?  |
| Mechanism | `catalog-fingerprint.ts:23-53` over natural keys | `generation_jobs.snapshot_hash`    |
| Verdicts  | `clean` / `catalog-drift` / `incomparable`       | drifted / not drifted              |

For a source-vs-proposal pair the page's tier reads **`clean` essentially always** — the integration
suite proves a `clone_plan` copy fingerprints equal to its source. And `DriftBanner.tsx:30` renders
*nothing* on a clean tier ("A clean comparison says nothing. Silence is the signal."). So on the
drifted branch the author is sent to a page that shows **no banner at all**, while the drift that
caused the delivery decision has no representation on the screen. The honest fix is a *second*
banner — i.e. new UI, inside the "no new UI" slice.

### 4. Challenge C — the drift digest's blind spots

`computeSnapshotHash` (`wire.ts:105-108`) is SHA-256 over the canonicalized **wire** snapshot, and
the wire projection is narrower than the stored one. The semantics are deliberate and documented in
the migration header: the digest covers grid, availability, finishes-early flags, catalog **and the
board**, "because a catalog-only hash would miss the author moving a placement mid-solve, after which
auto-apply would silently overwrite their edit". F-301 flagged this as "the one place where a wrong
decision forces a non-additive migration later" — so **the semantics are frozen; S-306 cannot
redefine what drift means without a migration.**

What moves the hash: grid preset, any availability cell or severity, `finishes_early`, course hours
or week mode, a course's teacher set, a student choice, a course entering/leaving the projection, any
placement added/removed/moved/week-changed, any shelf-bundle member (as a multiset).

**What does not — and these are the hazards:**

- **`placements.is_optional` is dropped at the wire boundary** (`wire.ts:151`). An author flipping a
  pin to optional/required is invisible, so an "unchanged" verdict can auto-apply over that edit.
  Worse in the source direction: the apply is a region *replace* and generated rows hardcode
  `isOptional: false`, so the auto-apply will reset optional flags inside the replaced region unless
  the surviving-pins mechanism is repeated against the source.
- **Course `name` / `level` / `groupIndex` are invisible to the hash but *are* the natural key clone
  translation runs on.** The two failure modes are symmetric and both real: a rename leaves the hash
  clean (auto-apply proceeds) while breaking clone translation on the drifted branch; and a hash-clean
  verdict does not imply the clone is still translatable.
- Placement row identity / bundle grouping, shelf-bundle grouping, teacher/student display names,
  teacher `code`, `course_groupings.catalog_hash`, and the plan name are all invisible.

Two further mechanical gaps:

- **TOCTOU between the re-hash and the apply is unprotected.** `apply_generated_placements` takes no
  hash or version argument and is a blind region replace; `markDelivered`'s CAS protects the *marker*,
  not the write. Two-tab concurrency is an expected case. A cheap fix is an expected-hash argument on
  a new or wrapped RPC.
- **The digest answers "did it change", never "what changed".** It cannot distinguish an irrelevant
  edit from a material one — and per the blind spots above, some material edits do not move it while
  some cosmetic ones break translation.

### 5. Challenge D — ~~drift will be the common branch~~ **CORRECTED: drift is the rare branch**

> **Corrected 2026-08-28 during `/10x-frame`.** The mechanism below is accurate; the *frequency*
> conclusion drawn from it was not. Inferring "the author edits" from "any edit drifts" was an
> overreach. The author reports that during a solve they **leave the source plan alone** — so drift
> is the **rare** case and auto-apply would fire on the **majority** of runs. That makes the
> auto-apply machinery hot-path rather than edge-case, which matters *more*, not less: the author
> also reports they want to review every result before it touches their plan, so the machinery would
> fire often, doing something unwanted. See `frame.md` § Narrowing Signals and § Hypothesis 1.
> Everything downstream in this section that reasons from "the drifted branch is load-bearing"
> should be re-read with the frequency reversed.

S-301's *second* wording correction matters here as much as the first: "settles unsaved board state"
described a draft buffer that does not exist — **every board mutation persists per gesture**. Combined
with the board being inside the digest by design, this means any single edit during a 12–20 minute
solve drifts the source. Auto-apply fires only when the author touched nothing at all for the whole
run — which, per the correction above, is the normal case.

The record anticipated exactly this. The original options analysis rejected optimistic in-place apply
*as the sole mechanism* because "it makes the 20-minute run a lottery", and settled on the clone model
as the delivery mechanism **with auto-apply as a convenience on top**. FR-307's Socrates block locked
the same shape.

Two consequences for planning:

- The drifted branch is the load-bearing path, and it is the half carrying both large unknowns
  (dominance, adoption). Budget accordingly; do not let auto-apply's tidiness dominate the estimate.
- **Proposal plans accumulate, and the drifted branch creates one every time.** The README already
  warns about this for production; the auto-apply branch deletes its clone, the drifted branch does
  not, and **no retention policy exists anywhere in the record.** With drift as the common case this
  goes from a footnote to a product concern. Worth naming in the plan even if the answer is "later".

### 6. Challenge E — "adopts deliberately" has no mechanism, anywhere

US-301, FR-307, and the roadmap all say the author "adopts the result deliberately". **Nothing in the
entire record defines what adopting *is*** — a copy-back to the source, a rename, a lineage switch, or
simply "keep using the new plan and abandon the old one". The comparison page has zero interactive
controls beyond popovers and links, and no action or mutation wiring at all.

Related and still open: the `applyGeneratedPlacements` **Astro Action was deliberately kept alive for
S-306** by `clean-up-bench-generation` ("S-306 may want a client-side apply path again... If S-306
lands differently, that action is a follow-up deletion"), together with its `liveState` machinery.
S-306 is the third slice in a row to inherit that deferral and should resolve it: use it, or delete it.

### 7. Challenge F — notification: a durable event, or just a render?

There is **no notification infrastructure decision anywhere in the record.** The only prior art is one
line calling an in-app completion toast "a free by-product of polling", and the PRD's closer:
"notifications → polling + in-app now, email nice-to-have".

What exists: `sonner` v2 is a dependency, and `src/_pages/plans-list/ui/PlansHub.tsx` — the page that
already hosts S-303's job badge — already uses toasts, so the surface is prior art rather than new.
The `GenerationStatusStrip` and the hub's `PlanIndicator` are the two shipped status surfaces.
`generation_jobs.notified_at` exists and **has no writer and no reader**.

The decision S-306 owes: the roadmap says S-310 "hangs off S-306 because the completion/notification
event it extends is created there". So S-306 must create a *channel-agnostic notification event* —
something with a durable "has this been announced" marker (`notified_at` is sitting there for exactly
this) carrying the result information the PRD demands — **not merely a new label derived from
`delivery` + `delivered_plan_id`.** Choosing the render-only answer silently de-scopes S-310.

Note the coupling: a toast is "a free by-product of polling" only when a tab is open — which is the
exact case headless delivery exists to cover. **The notification question and the trigger question are
the same question.**

### 8. Smaller, but real

- **The `delivery` vocabulary migration** — the one migration this slice owes. The column is untyped
  `text` with no CHECK, and the header says the vocabulary "is S-306's to declare; it lands as a check
  then". It must span the delivery-eligible states (`succeeded`, `interrupted`-with-checkpoint, and
  `stopped` once S-305 lands) crossed with the two outcomes (auto-applied to source / left as a
  proposal). `stopped` has no producer yet — decide explicitly whether S-306's predicate shape
  includes it or whether it is S-305's to wire.
- **`delivered_plan_id` semantics on the auto-apply branch.** `deliverable()` and both status surfaces
  key off `delivered_plan_id`/`proposal_plan_id` being non-null. If auto-apply sets
  `delivered_plan_id = plan_id` and deletes the clone, the FK's `set null` applies only to
  `proposal_plan_id`, so this works — but the strip's copy and the hub's indicator both need a new
  branch, and `pnpm check` (never `pnpm build`) is the gate that will find the ~7 consumers.
- ~~**A verified-but-empty result is marked delivered.**~~ **STALE — corrected 2026-08-28 during
  `/10x-frame`.** S-301's implementation review raised this as F6 and it was **fixed in that slice**
  (`context/archive/2026-08-12-first-verified-proposal/reviews/impl-review.md:101-110`); the code
  fails the job on an empty result at `generation-delivery.ts:175-181`. This is not an outstanding
  hazard and S-306 owes nothing for it.
- **Cost on the hot path.** The T1 re-hash is a full `loadCombinedPlannerData` (~18 round trips),
  added on top of the ~124 KB snapshot read S-301's review already accepted. Fine on a visit,
  expensive on a poll. Mirror the existing discipline: re-hash only once a job is known
  deliverable-and-undelivered.
- **Where the re-hash lives.** `assembleSource` is currently a private const in
  `generation-job.ts:110-120`. Both enqueue and delivery need it, and delivery is a sibling module in
  the same segment — a small extraction, but name it in the plan so the two hashes cannot drift apart.
- **E2E for Generate is S-306's**, resolved explicitly in S-306's favour by S-302 and re-confirmed in
  the README's Known gaps. The obstacle: the E2E lane has no DB access (all 20 specs build data
  through the UI) and the seed emits two catalog-identical plans — so a *drifted* pair must be
  constructed by editing through the UI mid-job, or the lane needs DB access it does not have.
- **`generation-delivery.ts` is now the busiest seam in the change** — reclaim CAS + delivery gate +
  clean-label derivation + orphan sweep, and S-306 adds drift branch + clone cleanup + notification.
  Worth a structural pass rather than a fourth inline condition.

## Code References

**The delivery pipeline S-306 modifies**

- `src/_pages/plan-detail/api/generation-delivery.ts:28-34` — the docblock naming the trigger gap in
  the codebase's own words
- `src/_pages/plan-detail/api/generation-delivery.ts:105-129` — `checkGeneration`, the entry point
- `src/_pages/plan-detail/api/generation-delivery.ts:132-134` — `deliverable()`, the gate S-306 branches after
- `src/_pages/plan-detail/api/generation-delivery.ts:143-148` — S-304's reclaim CAS, runs immediately before
- `src/_pages/plan-detail/api/generation-delivery.ts:185` — the server-side oracle (FR-313, already relocated)
- `src/_pages/plan-detail/api/generation-delivery.ts:198` — `translateCourseIds` (clone direction only)
- `src/_pages/plan-detail/api/generation-delivery.ts:262-274` — `applyToProposal`, hard-wired to the clone
- `src/_pages/plan-detail/api/generation-delivery.ts:378-386` — `markDelivered` CAS
- `src/_pages/plan-detail/api/generation-delivery.ts:407-411` — `deleteOrphanClone`
- `src/pages/plans/[id]/index.astro:29-38` — the only production trigger: an SSR page render
- `src/_pages/plans-list/api/generation-status.ts:8-12` — "It never delivers", and why
- `src/entities/timetable/model/generation/run.ts:17-32` — `runVerifiedGeneration`, pure, workerd-safe

**Drift mechanics**

- `src/_pages/plan-detail/api/generation-job.ts:110-120` — `assembleSource`, the template for the T1 re-hash
- `src/_pages/plan-detail/api/generation-job.ts:119`, `:148` — the only write of `snapshot_hash`
- `src/entities/timetable/model/generation/wire.ts:99-108` — the digest and its stated rationale
- `src/entities/timetable/model/generation/wire.ts:151` — `toWirePin` drops `isOptional` (blind spot)
- `supabase/migrations/20260810200122_generation_jobs.sql:36-41` — FKs `set null` *for S-306's clone deletion*
- `supabase/migrations/20260810200122_generation_jobs.sql:49-55` — normative hash semantics
- `supabase/migrations/20260810200122_generation_jobs.sql:92-95` — `delivery` column, vocabulary left to S-306
- `supabase/migrations/20260810200122_generation_jobs.sql:82` — `notified_at`, unused
- `services/solver/src/cpsat_service/runner.py:209-228` — the snapshot **binding** check (not a drift check)

**Why the solver cannot deliver**

- `src/test/solver-credential.integration.test.ts:188-244` — measured privileges: zero on `public.plans`
- `supabase/migrations/20260812141459_solver_select_column_scope.sql:71-72` — `plan_id` not readable
- `supabase/migrations/20260711202237_apply_generated_placements.sql:20-29` — `security invoker`, "Do NOT switch to DEFINER"

**Background execution (all absent)**

- `wrangler.jsonc` — verified: no `triggers`, `crons`, or `queues` key
- `src/worker.ts:29` — `{ fetch }` only; `src/cloudflare-env.d.ts:70-72` models only `fetch`
- `src/solver-container.ts:78-79` — `alarm()` deliberately not overridden; `:81-95` the working timer callback
- `src/shared/api/supabase.ts:6-25` — the only client factory, request-and-cookie-bound

**The review surface**

- `src/pages/plans/compare.astro` — the route, `?plans=<uuid>,<uuid>[,…]`
- `src/_pages/plan-comparison/model/metric-catalog.ts:16-22` — "It reports; it never judges" + `MetricCell` enforcement
- `src/_pages/plan-comparison/model/drift-tier.ts:23-25` — the *other* drift concept
- `src/_pages/plan-comparison/model/catalog-fingerprint.ts:23-53` — natural-key, cross-plan, board-blind
- `src/_pages/plan-comparison/ui/DriftBanner.tsx:30` — renders nothing on a clean tier
- `src/entities/timetable/model/generation/objective.ts:98` — `scoreCandidate`, barrel-exported at `index.ts:32`
- `contracts/generation-wire.schema.json:180` — the objective tuple is explicitly not on the wire
- `src/_pages/plans-list/model/plan-indicators.ts:18-19` — union pre-shaped for `{ kind: "proposal" }`
- `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:51-70` — one success shape today

## Architecture Insights

- **The gap is one component wide, and it is a clock plus an identity — not a pipeline.** Everything
  upstream (solver, row, heartbeat) and everything downstream (verify → translate → apply → mark) is
  built, correct, idempotent and crash-safe. This is a good position to plan from, provided the plan
  does not mistake the missing component for a small one.
- **Two orthogonal "drift" notions now coexist in the codebase**, answering different questions with
  different mechanisms and different verdicts. S-306 puts them on the same screen for the first time.
  Naming discipline here is not cosmetic — the existing banner going silent in exactly the case the
  author was sent to the page for is a genuine UX defect waiting to ship.
- **The "no new UI" saving is real but asymmetric.** Skipping a bespoke side-by-side view is a large,
  genuine saving. The residual — a dominance primitive that has never existed at any layer, rendered
  in a component that must sit outside a pipeline built to prevent exactly it — is not a reuse. The
  roadmap's phrase "keeping the frontend investment deliberately small" is true of the surface and
  false of the content.
- **Least privilege has been the project's consistent answer, and it is what makes headless hard.**
  Every prior credential decision narrowed reach (`solver_job_writer`'s five readable columns, the
  `anon` revocation, `security invoker` RPCs). A background actor needs reach. The `security definer`
  RPC + EXECUTE-only role is the shape that keeps faith with that posture; a broad delivery role does
  not.
- **Auto-apply is the convenience, the clone is the mechanism.** Every layer of the record says this,
  and the per-gesture persistence model makes it true in practice. A plan that treats the drifted
  branch as the exception will mis-budget the slice.

## Historical Context (from prior changes)

- `context/archive/2026-08-12-first-verified-proposal/change.md` § Decisions (2026-08-12) — the
  id-space decision, with the measurement that forced it: `clone_plan` re-mints every course UUID,
  **0 of 84 survive**, so a clone-assembled snapshot "would report drift on every run and S-306's
  auto-apply could never fire". Rejected alternatives (B: two digests; C: clone at delivery) recorded
  there too. This is the single decision S-306 most depends on.
- `context/foundation/roadmap.md:114` — both S-301 wording corrections. The second one ("settles
  unsaved board state" describes a buffer that does not exist) is what makes drift the common case.
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md` § Resolutions #1 and §7 —
  the hash-the-snapshot-not-the-catalog decision, flagged as "the one place where a wrong F-301
  decision forces a non-additive migration later"; and the origin of the drift guard as a *local
  function inside a bench experiment* (`assertCatalogMatches`), a **catalog** guard whose role — not
  whose code — S-306 promotes.
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` § Follow-up §1 — "(c) optimistic
  in-place apply with drift check … as the sole mechanism it makes the 20-minute run a lottery.
  Recommended synthesis: (b) as the delivery model, with (c) as a convenience on top."
- `context/archive/2026-08-19-staged-progress-and-checkpoints/` — the `PlanIndicator` union shaped for
  S-306; "no delivery from the poll" as a deliberate separation; the checkpoint as a full
  `GenerationResult`.
- `context/archive/2026-08-20-job-aware-container-lifecycle/` — the three-way delivery gate that
  pre-pays S-306's structure; the reclaim actor placed on-visit rather than widening the claim CAS;
  and §4's blocker note that **"a cron sweeper has no database identity today"**, with both obvious
  workarounds rejected as posture violations.
- `context/archive/2026-08-15-solver-deploy-lane/change.md` § Scope decisions (2026-08-16) — "E2E for
  Generate: deferred to S-306, not S-302… it remains open and owned."
- `context/foundation/lessons.md` — four entries bite this slice: *"A convention that cites a code
  mechanism is coupled to it"* (S-306 falsifies at least five recorded statements and owes a doc
  truth-up phase, as every predecessor slice shipped); *"Granting a role is not excluding the others"*
  (any new principal, verified with `has_table_privilege`, not by reading the migration);
  *"Astro Actions are the single transport"* (drift-check + apply is compute-that-persists and belongs
  behind an Action — a webhook is the one carve-out and must be argued explicitly); and
  *"Green build/test/lint ≠ type-safe"* (cite `pnpm check`, never `pnpm build`, in success criteria).

## Related Research

- `context/archive/2026-08-20-job-aware-container-lifecycle/research.md` — the closest sibling in both
  shape and method (a feasibility dossier for the preceding slice); its §4 identity analysis transfers
  directly to S-306's trigger question.
- `context/archive/2026-08-12-first-verified-proposal/research.md` §B, §E — the source-vs-clone id
  space, and "the drift guard is experiment-only".
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md` — hash semantics and the
  column shapes S-306 consumes.
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` — the delivery-model options analysis.

## Open Questions

Ordered by how much they change the slice.

1. **Which reading of "headless" does S-306 owe?** Weak (server-side oracle + a client-triggered
   clock — already 90% built) or strong (an actor that delivers with no tab open — needs a new machine
   principal)? Note S-310's completion email is unsatisfiable under the weak reading, so this decision
   silently decides S-310's fate too.
2. **Who owns the dominance primitive — S-306 or S-307?** Both FRs claim it; the slices are parallel.
   Assigning it to S-307 collapses S-306's page work to a deep-link plus a banner.
3. **What does "adopt deliberately" mean mechanically?** Undefined in the entire record, and the
   comparison page has no mutation wiring at all.
4. **Is the notification a durable event or a render?** `notified_at` exists and is unused; the
   render-only answer de-scopes S-310.
5. **What is the `delivery` vocabulary**, across three delivery-eligible statuses × two outcomes — and
   does S-306's predicate include `stopped`, or is that S-305's to wire?
6. **Is `is_optional` drift accepted, or closed?** Options: widen the wire pin (a `formatVersion`
   decision under `contracts/README.md`'s bump policy), add a second app-side digest beside the
   contract one, or accept it explicitly with a comment. Related: a course rename leaves the hash clean
   while breaking clone translation.
7. **What guards the TOCTOU window** between the T1 re-hash and the apply — an expected-hash argument
   on a wrapped RPC, or nothing?
8. **Retention for proposal plans**, now that the drifted branch is the common one and creates a plan
   every run.
9. **Use or delete the `applyGeneratedPlacements` Astro Action** and its `liveState` machinery, kept
   alive across three slices explicitly pending S-306's shape.
10. **How does the E2E lane build a drifted pair** without DB access, given the seed's two plans are
    catalog-identical?
