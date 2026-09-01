---
date: 2026-08-31T15:22:09+02:00
researcher: Dobromir Kropielnicki
git_commit: ff609de271ed7a5a02ffb19ca79bffcbb08e834b
branch: main
repository: ib-timetable-planner
topic: "F6 polling-store extraction feasibility, and the proposal provenance note's lifecycle"
tags: [research, codebase, polling-store, generation, proposal, provenance, shared-lib]
status: complete
last_updated: 2026-09-01
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Impact check after `generation-deletion-integrity` shipped and archived — F6 unaffected, three provenance findings narrowed, Q3 largely closed, one new residual defect on the hub badge; then Q2 decided and this change scoped to eviction-then-F6"
---

# Research: shared polling store + proposal provenance lifecycle

**Date**: 2026-08-31T15:22:09+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `ff609de271ed7a5a02ffb19ca79bffcbb08e834b`
**Branch**: `main`
**Repository**: `ib-timetable-planner` (github.com/dobrek/ib-timetable-planner)

## Research Question

Two halves, scoped into one change:

1. **Feasibility of F6** — extract a shared polling-store factory (`src/shared/lib/polling-store.ts`) and rebase `job-progress-store.ts` and `use-pending-proposal.ts` on it. Queued from `context/archive/2026-08-25-drift-decided-delivery/follow-ups/review-fixes.md:5-15`.
2. **The UI challenges around it** — in the author's words: *"it's not clear when this note about the original plan disappears for the user. Maybe we need some kind of acknowledgement that, when the user confirms, it's no longer visible. At the same time it could also solve the problem when the user decides to remove the original plan so we do not have a link to non-existing things."*

Persistence model for any acknowledgement was to be researched both ways (DB vs per-device) with a recommendation.

> **Scope note (2026-08-31).** The deletion-integrity defects this research uncovered were split into
> their own change, `context/archive/2026-08-31-generation-deletion-integrity/`, since they share no code with
> either the polling store or the provenance note. What remains here is F6 plus the note's lifecycle.

## Summary

**F6 is feasible and low-risk, but the payoff is smaller than the follow-up implies.** ~55 lines of genuinely common lifecycle machinery are maintained twice. Parameterising the 9 real differences needs **4 required + 3 optional** options (the follow-up guessed 3), there are exactly **two consumers in `src/` and no third in sight**, and the factory's own test suite (~150-200 lines, non-optional) makes the change net-negative on LOC. It is an OBSERVATION-severity dedup on N=2, not a defect. Recommend proceeding **with an explicit abandon gate**, and fixing the follow-up's two wrong details: the path violates the folder-with-barrel house style, and `refresh` would ship unused.

**The note has no disappearance rule at all** — no TTL, no cron, and it is unaffected by rename, board edits or `notified_at`. It renders on any delivered proposal for as long as its job row exists. That much of the premise holds.

**The "link to non-existing things" premise does not.** `generation_jobs.plan_id` is `ON DELETE CASCADE`, so deleting the source takes the job row with it and the note simply stops rendering — link and row die together, and no dangling link is reachable. That is **correct cleanup, not damage**: the strip's purpose is navigational (its docstring calls the link *"the only route back to the source"*), FR-307 says a delivered proposal **is an ordinary plan**, and `pending-guards.ts:95-98` already treats an orphaned clone as disposable. Initially filed as a defect ("D1") and downgraded on review.

**The one surviving reference to a deleted source is the clone's NAME** — `generation-job.ts:140` sets `Proposal — ${planName}` on the `plans` row, which outlives everything else. It is a stale reference, visible on the hub and in the page heading, and it is also — usefully — the informational residue that a denormalised provenance column would have provided, freely editable by the author (`rename-plan.ts` refuses renames only while *pending*). No change proposed.

**Two genuine deletion defects were found and became a separate change — shipped and archived 2026-08-31.** Deleting a *delivered proposal* flips its `succeeded` job to `failed` (confirmed by reproduction), and deleting a *stale-running source* strands the clone permanently pending. Both live in `context/archive/2026-08-31-generation-deletion-integrity/` — they share no code with the polling store or the note, and an acknowledgement would not have fixed either: acknowledgement controls *visibility*, those are *referential integrity*, and the worse of the two fires on the **source** plan, which never renders the note at all.

**Recommended persistence: a new `generation_jobs.provenance_acked_at timestamptz`** — not `localStorage`, and not a reuse of `notified_at`. It costs one migration with **zero** GRANT/RLS/SQL-function changes, rides the existing `STATUS_COLUMNS` projection at no extra query, and dies with its subject via the same cascade (so no orphaned flag can exist).

**One hard constraint on the whole UI half: FR-308 mandates the note.** Verbatim (`prd.md:465-472`): *"all other status lives on the proposal row and the proposal's own page — progress while pending, provenance ('Generated from <source> at <time>') once delivered."* So "dismiss it forever" contradicts a shipped requirement as literally written. The workable design is **degrade, not delete** — plus a deliberate FR-308 re-grounding, which is established house practice (FR-311 and FR-313 were both re-worded in place).

---

## Detailed Findings

### 1. F6 — the polling-store extraction

#### 1.1 What is actually shared

Mechanical diff of the two factory bodies (`job-progress-store.ts:61-145` vs `use-pending-proposal.ts:59-147`): 38 identical lines, but comment-free the divergent **code** is only 9 sites. Byte-identical today: `let timer` / `let inFlight` / `listeners`, the `publish` body, the `tick` skeleton (guard → `inFlight = true` → `try` → empty `catch` → `finally { inFlight = false; syncTimer() }`), all 8 lines of `syncTimer`, `listen`/`unlisten`, the entire returned `subscribe` and `dispose`, and the module-level `isVisible` one-liner.

| # | Difference | Hub | Pending | Parameterise as |
|---|---|---|---|---|
| D1 | Snapshot type | `ReadonlyMap<string, GenerationIndicator>` | `GenerationJobView \| null` | generic `<T>` — free |
| D2 | Server snapshot | derived (`indexByPlan(initial)`) | passthrough | **no option** — derive at the call site, factory always gets `T` |
| D3 | Equality | `sameIndicators` (22 lines, Map-walk) | `sameView` (12 lines, null-aware) | required `isEqual(a, b)` |
| D4 | Extra tick bail | `planIds.length === 0 && activeJobIds === 0` | absent | fold into `read` (return `current`) — ⚠️ **untested branch today** |
| D5 | The request | `fetch({ jobIds, planIds })`, built from the snapshot | `check(planId)`, ignores snapshot | required `read: (current: T) => Promise<T>` |
| D6 | Publish input | `merge(snapshot, fetched)` — terminal memory | replace | same `read` callback returns the *next snapshot* |
| D7 | `shouldRun` domain half | `some(isActiveIndicator)` | `!announced && snapshot !== null && isActiveJobStatus(...)` | required `isActive(snapshot: T)`; `announced` stays slice-local closure state |
| D8 | `onVisibilityChange` | **unconditional** tick (rule 5 discovery) | gated on `!announced` | optional `tickOnVisible?` defaulting to unconditional |
| D9 | `announced` / `onDelivered` latch | absent | fires **after** `publish`, **outside** the `listeners.size > 0` guard | optional `afterTick?(next: T)` |

**Minimum honest surface: `{ initial, isEqual, read, isActive, afterTick?, tickOnVisible?, intervalMs? }`** — 4 required + 3 optional. The follow-up's `{ shouldRun, tick, initial }` is short by `isEqual` and both hooks. The follow-up also asks for a `refresh` export; **neither store has one today**, so it would ship unused unless the slices re-export it.

#### 1.2 The "both suites green unchanged" guard is achievable

Both suites drive the exported factory and the public `subscribe`/`getSnapshot`/`getServerSnapshot`/`dispose` surface only. **No test reaches into internals** — nothing inspects `timer`, `inFlight`, `announced`, or `listeners`.

- `job-progress-store.test.ts` — 285 lines, 15 tests, jsdom via a per-file `// @vitest-environment jsdom` docblock (the `unit` project is node-only and the `dom` project is `*.test.tsx` only — `vitest.config.ts:16-43`). Fake timers + a redefined `document.visibilityState` + real dispatched `visibilitychange` events.
- `use-pending-proposal.test.ts` — 156 lines, 8 tests, **node environment, no `document`**. So `listen`/`unlisten` are no-ops and `isVisible()` short-circuits. **The pending store's entire visibility path is untested.**

Three constraints fall out, and they are the real risk register for this refactor:

1. **`job-progress-store.test.ts:167` and `:266` hard-pin D8.** Test 9 discovers a job started in another tab with nothing active — it ticks *only* because `onVisibilityChange` is ungated. Test 15's own comment says so: *"A terminal-only snapshot runs no timer (rule 1), so drive one tick through the visibility path."* Any factory that gates visibility on `shouldRun()` breaks both.
2. **D9's ordering has no test.** Folding the latch into `read` fires `onDelivered()` *before* `publish` — navigation before the final snapshot lands — and both suites stay green. This is the one correctness trap; it argues for a real `afterTick` hook over the clever fold.
3. **The pending suite covers none of the centralised visibility machinery** (no `document`), so the factory's own suite is not optional — it is the whole point.

#### 1.3 There is no third consumer

`setInterval` appears in **exactly two places in `src/`** — the two stores. So does `visibilitychange`. Other `useSyncExternalStore` sites are all mutation- or storage-driven with no timer: `use-hydrated.ts:21`, `plan-detail/lib/board-zoom.ts`, `shelf-pinned.ts`, `drag-hint-mode.ts`, `history-store.ts:31-51`. And `use-generation-job.ts:24-26` **explicitly refuses** to become one: *"Nothing here loops, and S-303 deliberately did not change that."*

Note the record *pre-authorised* the move — `context/archive/2026-08-19-staged-progress-and-checkpoints/research.md:689`: *"A new poll store lands in `plans-list` (**or `shared/lib` if the strip later wants it too**)"* — and there is **no recorded objection** anywhere to sharing them.

#### 1.4 Two corrections to the follow-up's spec

**Path.** `src/shared/lib/` holds 14 entries, **all directories, zero bare `.ts` files**. The invariant pattern is `<folder>/index.ts` (pure barrel) + `<concept>.ts` + co-located `<concept>.test.ts`, and all 215 `@/shared/lib/*` imports across `src/`, `bench/` and `e2e/` resolve to a folder barrel with **zero deep paths**. So the conforming location is `src/shared/lib/polling-store/{index.ts, polling-store.ts, polling-store.test.ts}` — not the bare file the follow-up names.

**Steiger headroom.** `fsd/shared-lib-grouping` fires above 15 children (read from `@feature-sliced/steiger-plugin/dist`). At 14, adding `polling-store/` lands on **15 — the last free slot**, silent but with zero headroom after. A prior follow-up hit this exact wall (`context/archive/2026-06-13-teacher-availability/follow-ups/review-fixes.md`), so confirm with `pnpm steiger` before committing rather than trusting the arithmetic.

Other gates: `fsd/insignificant-slice` cannot fire (`shared` is unsliced); `fsd/no-public-api-sidestep` would flag `@/shared/lib/polling-store/polling-store` but not the barrel; `fsd/forbidden-imports` means **the factory may import nothing from `entities`** — so `isActiveJobStatus` (`entities/timetable/model/generation/job-status.ts:27`) reaches it only as the body of the `isActive` closure, and `isActiveIndicator`, `IndicatorsByPlan`, `sameIndicators`, `sameView`, `merge`, `reloadIntoBoard` all stay in their slices. ESLint's `consistent-type-definitions: ["error", "type"]` applies to the options shape.

#### 1.5 Feasibility verdict

Comment-free line accounting: **~55 lines deleted twice (≈110)**, ~55 + ~35 added in `shared` (≈90), plus ~150-200 of new test. Each call site trades ~55 lines for ~15-20 of closure wiring — a **~35-line saving per slice**, not the ~90 the review's comment-inclusive count suggests.

For: the `inFlight` + `syncTimer` + listener-lifecycle interaction is the subtle part and is maintained twice — a bug fixed in one is not fixed in the other today. The `read`/`isEqual`/`isActive` triple is an honest seam that leaves a genuinely domain-free lifecycle behind.

Against: N=2 with no growth signal; the option count (7) is longer than the per-site dedup; and unifying D8 converts two inline "why" comments about *different* rule sets (hub has 5, pending has 3) into a boolean flag — a documentation loss.

**Verdict: feasible, worth doing, but gate it.** Write the factory and its suite first, rebase, then check the acceptance bar *before deleting anything*: if `job-progress-store.ts` is not obviously easier to read than its current 193 lines, close F6 as WONTFIX and leave a cross-reference comment at each site instead. Also: the factory must not change the 5 s / active-only / visibility-aware / idle-issues-nothing shape, because the parked push-based-progress decision rests on it (`roadmap.md:297`).

---

### 2. The provenance note — what it is, and when it disappears

The note is `ProposalStrip` inside `GenerationStatusStrip.tsx:119-141`: *"Generated from **&lt;source name&gt;** at &lt;time&gt;"*, the name linking to `/plans/{job.sourcePlanId}`, plus the clean label or a halted-stage summary. It renders iff `state.status === "tracking"` **and** `job.role === "proposal"` **and** `job.delivered`.

Its own docstring states why it matters (`GenerationStatusStrip.tsx:113-117`): *"a proposal is named `Proposal — <source>` only until the author renames it, after which nothing else on the page records which plan it was solved from."* That is confirmed by the schema — **`plans` has no provenance column and no self-reference** (`Relationships: []` in `database.types.ts:487-513`); `clone_plan` copies only `(name, slot_grid_preset)`. The job row is the sole record.

**Answer to "when does it disappear": there is no expiry rule at all.** No TTL, no cron (`wrangler.jsonc` declares no triggers; no migration schedules cleanup; `pg_cron` unused). It survives reloads, renames and board edits indefinitely. `notified_at` being stamped does **not** hide it — nothing in `GenerationJobView` or the strip reads that column.

The complete set of things that *do* stop it rendering:

- **A newer job on this plan outranks it.** `pickJob` (`generation-delivery.ts:212-215`) prefers the plan's own job while active **or while `delivered_plan_id is null`**. Generating *from* a delivered proposal therefore hides the provenance while the new solve runs — and **permanently** if that new job ends `failed`, or halted with no checkpoint, because `delivered_plan_id` then stays null forever. Pinned as intended by `generation-delivery.integration.test.ts:371-405` (*"Its failure outranks provenance too"*).
- **The job row is gone** → `checkPlan` returns null → `idle` → no strip. The realistic route is deleting the source plan (§3).
- **The job is detached** (`proposal_plan_id = null`) by the translation-mismatch branch (`generation-delivery.ts:309-327`). Pre-delivery only, but it leaves a live, non-pending, board-carrying clone with **no provenance and no reachable job at all**.
- **A transient `checkPlan` throw** at render time (`index.astro:41-45` catches to null) — that page load only.

So the author's observation is exactly right, and understated: the note has no disappearance rule, *and* the three ways it currently does disappear are all accidents rather than design.

**Where else the source is referenced from a proposal** — only three surfaces, all fed by the same `GenerationJobView`: this strip; `PendingProposalPage.tsx:80` ("Open the source plan", id only, no name); and `SweptProposalNotice.astro:31`. **The hub renders no source name or link at all** — `describeGenerationIndicator` (`plan-indicators.ts:104-129`) produces an `href` only. Plan comparison has no source-plan concept.

---

### 3. Deletion, as far as the note is concerned

Full analysis, the confirmed reproduction and the fixes now live in
`context/archive/2026-08-31-generation-deletion-integrity/research.md`. What matters *here* is only what the
note's design has to assume:

```sql
-- supabase/migrations/20260810200122_generation_jobs.sql:57-98
plan_id           uuid not null references plans(id) on delete cascade,
proposal_plan_id  uuid          references plans(id) on delete set null,
delivered_plan_id uuid          references plans(id) on delete set null,
```

1. **The note cannot outlive its source.** `plan_id` cascades, so deleting the source deletes the job
   row, and `checkPlan` — which finds a proposal's job only via `proposal_plan_id` — returns null.
   Pinned by `src/test/generation-jobs.integration.test.ts:111-119`. So the acknowledgement design
   never has to handle a note pointing at a missing plan: that state is unreachable.
2. **Provenance is therefore already self-cleaning**, and correctly so (see Summary). The clone's name
   carries the residue.
3. **The note can also disappear for a second reason**, which the acknowledgement design *does* have to
   account for: `pickJob` (`generation-delivery.ts:212-215`) prefers the plan's own job while active or
   while `delivered_plan_id is null`. Generating *from* a delivered proposal hides its provenance for
   the duration — and permanently if that new job ends `failed`. Pinned as intended by
   `generation-delivery.integration.test.ts:371-405` (*"Its failure outranks provenance too"*). An
   acknowledgement flag must not be confused with this: the note can be absent without being dismissed.

---

### 4. The acknowledgement — persisted vs per-device

#### 4.1 `notified_at` already exists, and is the wrong lever to reuse

`generation_jobs.notified_at` means, precisely, *"an in-app view of the DELIVERED proposal has happened"*. One writer — `markNotified` (`generation-delivery.ts:195-209`), fired on any proposal-role `checkPlan` where the job is delivered and the column is null, plain update, best-effort. One reader — `surfacedJobsFor` (`plans-list/api/generation-status.ts:89`), whose third disjunct `and(delivered_plan_id.not.is.null,notified_at.is.null)` keeps the hub's *"Ready — open"* badge durable across reloads. The solver cannot write it (excluded from the column-scoped grant at `20260810200931:62-74`).

Semantically it *is* an acknowledgement, but reusing it is wrong on three counts: it clears on the **first** view (a provenance note plausibly wants to survive several); it is owned by a different consumer whose duration is deliberately short; and **S-310's emailer is slated to become a second writer** (`prd.md:505-512`), so its value can be set by something other than a human reading the page.

#### 4.2 Persisted — recommended

```sql
alter table public.generation_jobs
  add column provenance_acked_at timestamptz;
```

- **Zero GRANT/RLS/function work.** `authenticated` already holds table-wide `select, insert, update, delete` on `generation_jobs` (`20260617171048:14-16`, inherited by a table created later), and the app already UPDATEs this table from three call sites. The RLS policy is column-agnostic (`for all to authenticated using (true) with check (true)`). `solver_job_writer` is column-scoped in both directions, so the new column is invisible and unwritable to the solver **by default** — the correct posture with no migration work, and the exact-list pins in `solver-credential.integration.test.ts:211-217` assert *granted* lists, not the table's full column set, so they need no edit. `anon` stays revoked. No SQL function touches `generation_jobs` at all.
- **Zero extra queries.** It rides the existing narrow `STATUS_COLUMNS` projection (`generation-delivery.ts:114-115`) that `checkPlan` already fetches, straight into `GenerationJobView`.
- **Cascade alignment is exactly right.** The note dies with the source (§3); an ack on the job dies with it, so no orphaned flag can ever exist. On `plans` it would outlive its subject — a `true` on a plan with no note left to dismiss.
- **`notified_at` is the direct precedent** on the same table: nullable `timestamptz`, "the author has seen this", written from the same `checkPlan` path. A timestamp beats a boolean for the same reason.
- Deploy friction is low: CI's `deploy` job runs `supabase db push` on every merge to `main`. The one manual step is regenerating `src/shared/api/database.types.ts` by hand (no `gen:types` script exists), which `pnpm check` catches if forgotten.

Total: one migration (mostly header prose, per house style), one column threaded through `STATUS_COLUMNS` → `StatusRow` → `GenerationJobView` → `toView`, one dismiss Action in `createGenerationActions` (`generation-actions.ts:19-28`) shaped like `checkPlan`, a types regen, and a conditional in `ProposalStrip`.

#### 4.3 Per-device (localStorage) — cheaper, but the wrong storage class

The house pattern is three near-identical module-scoped stores — `drag-hint-mode.ts`, `board-zoom.ts`, `shelf-pinned.ts` (all under `src/_pages/plan-detail/lib/`, **not** `shared/lib` as several docs still cite) — each exporting `read*`/`write*`/`subscribe*`, guarded by `typeof window` **plus** try/catch per `lessons.md:40-45`, paired with `useSyncExternalStore` in `ui/chrome/board-disclosure.ts:21-32`, server snapshot always the in-code default, keys named `planner-<kebab>`, values validated on read.

It fits mechanically and breaks four ways:

1. **Unbounded per-entity keys.** All three precedents are device-wide singletons; `board-zoom.ts:2-3` says so outright (*"no Supabase, never plan-scoped"*). A `planner-provenance-dismissed:<planId>` key makes storage a growing UUID map with no deletion hook — `delete-plan.ts` is server-side and the hub never touches storage, so every deleted plan leaves a permanent tombstone.
2. **The listener set is per-key.** Dynamic keys force a keyed registry — a genuinely different module, not a fourth copy.
3. **Wrong semantics.** Zoom/hint/pin are cosmetic and reversible; losing them costs nothing. Losing "I have seen this" resurrects a dismissed note on every new browser and every private window, forever, on every plan.
4. **SSR flash.** The server snapshot must be "not dismissed", so a dismissed note renders for one frame on every load. The cookie route (`palette-collapsed.ts`, read at `index.astro:72-75`) avoids the flash but is still per-device and would need a per-plan cookie — worse.

The relevant house rule is already written down, in `palette-collapsed.ts:9-10`: *"per lessons.md, Actions transport app-data mutations, not per-device cosmetic prefs."* An acknowledgement is app data.

#### 4.4 No dismissal precedent survives in the tree

The only user-facing "Dismiss" string is a dialog close button (`TeacherAvailabilityDialog.tsx:122`). Historic dismissible panels (`GenerationSummaryPanel`, *"ephemeral, auto-dismissed on next edit"*) belonged to the deleted greedy path (`context/archive/2026-07-11-plan-generation/plan.md:548-553`). **Nothing in the CP-SAT record discusses dismissing, hiding, or expiring an advisory** — `notified_at` is the only "stop announcing" mechanism, and the strip's terminal behaviour was specified as *"render nothing"*, never *"dismissible"*.

---

### 5. Constraints that bound the design

- **FR-308 requires the note** (`prd.md:465-472`). Its re-grounding note explains the intent: *"the result belongs on the row it is about."* A pure "dismiss forever" contradicts it as written. **Degrade rather than delete** — collapse the strip into a smaller, non-strip provenance affordance once acknowledged — satisfies the requirement's substance, and the change should re-ground FR-308's wording explicitly. That is established practice here: FR-311 and FR-313 were both re-worded in place.
- **Retention was deliberately punted, and deletion is the sanctioned act** (`context/archive/2026-08-25-drift-decided-delivery/plan.md:107-108`): *"No retention policy for proposals — the author keeps them and cleans up by hand (their stated preference); Delete is the act."* Deleting a proposal is the sanctioned workflow, so the acknowledgement must not assume a long-lived note.
- **FR-312 permits polling here structurally, and the reason must survive F6** (`drift-decided-delivery/plan.md:76-78`): *"A pending page has no board, so the FR-312 argument against polling on the plan page does not apply to it."* The factory must not alter the 5 s / active-only / visibility-aware / idle-issues-nothing shape.
- **E2E coupling.** `e2e/specs/generation.spec.ts` asserts `toContainText("Generated from ${plan.name}")` on the proposal and `toHaveCount(0)` for the source strip after delivery, and its teardown deletes the proposal **before** the source with the comment *"deleting the source while its job row is alive is exactly what `assertNoActiveJob` refuses."* Any note redesign touches this spec — the assertion has to follow whatever Q2 decides.
- **`shared/lib` is at 14 of a 15 ceiling** (§1.4).
- **No FR governs plan deletion or proposal retention**, and no roadmap slice owns it — S-305 (stop button), S-307 (policy), S-308 (budgets), S-310 (email) are all elsewhere. So this work is unclaimed rather than colliding.

---

## Recommendation

What remains in this change is two independent pieces: the note's acknowledgement (`GenerationStatusStrip`, `generation-delivery`, one migration) and F6 (the two stores). They share no files.

1. **The acknowledgement first** — `provenance_acked_at`, a dismiss Action, and a degraded (non-strip) provenance affordance, with FR-308 re-grounded in the same commit. Open question Q2 gates the exact UI, so this cannot start until that is settled.
2. **F6 second**, behind the readability gate in §1.5. It is queued review work with no dependency on the note, so it can also run first if Q2 stalls.

**Explicitly not doing:** denormalising the source name to keep provenance alive after the source is deleted. The link is navigational, the target is gone, and the clone's own name already carries the informational residue.

**Sequenced elsewhere (now DONE — shipped and archived 2026-08-31, see the follow-up section):** the two deletion defects were `context/archive/2026-08-31-generation-deletion-integrity/`. They touch `generation-delivery.ts`, `job-delivery.ts` and `pending-guards.ts` — no overlap with either item above — so the two changes are independent and can land in either order.

## Code References

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/`

**The polling stores**
- [`src/_pages/plans-list/model/job-progress-store.ts:61-145`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/_pages/plans-list/model/job-progress-store.ts#L61-L145) — hub store; rules 1-5 in the docblock
- [`src/_pages/plan-detail/model/generation/use-pending-proposal.ts:59-147`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/_pages/plan-detail/model/generation/use-pending-proposal.ts#L59-L147) — pending store; `announced` latch at `:73`, `:90-93`
- [`src/_pages/plans-list/model/job-progress-store.test.ts:167`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/_pages/plans-list/model/job-progress-store.test.ts#L167) and `:266` — the two tests that pin the ungated visibility tick
- [`src/_pages/plan-detail/model/generation/use-generation-job.ts:24-26`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/_pages/plan-detail/model/generation/use-generation-job.ts#L24-L26) — the deliberate non-consumer
- [`steiger.config.ts`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/steiger.config.ts) — `fsd.configs.recommended`, run with `--fail-on-warnings`

**The provenance note**
- [`src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:119-141`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx#L119-L141) — `ProposalStrip`; the rename argument at `:113-117`
- [`src/_pages/plan-detail/api/generation-delivery.ts:212-215`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/_pages/plan-detail/api/generation-delivery.ts#L212-L215) — `pickJob`, the role/precedence rule
- `generation-delivery.ts:212-215` — `pickJob`, which can hide provenance behind a newer job
- `generation-delivery.ts:195-209` — `markNotified`, the only `notified_at` writer
- [`src/_pages/plan-detail/model/generation/use-generation-job.ts:30-34`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/_pages/plan-detail/model/generation/use-generation-job.ts#L30-L34) — the three-state machine; `tracking` is decided purely by SSR's `checkPlan`
- [`src/pages/plans/[id]/index.astro:37-122`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/pages/plans/%5Bid%5D/index.astro#L37-L122) — the only load site for the initial `GenerationJobView`; the board / pending / swept branch
- `src/_pages/plans-list/api/generation-status.ts:89` — `surfacedJobsFor`, the only `notified_at` reader

**Deletion + schema**
- [`supabase/migrations/20260810200122_generation_jobs.sql:36-41`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/supabase/migrations/20260810200122_generation_jobs.sql#L36-L41) — the FK-asymmetry rationale, in the migration's own words
- `20260810200122_generation_jobs.sql:57-98` — the table; `plan_id … on delete cascade` at `:60-62`
- [`src/_pages/plans-list/api/delete-plan.ts:22-26`](https://github.com/dobrek/ib-timetable-planner/blob/ff609de271ed7a5a02ffb19ca79bffcbb08e834b/src/_pages/plans-list/api/delete-plan.ts#L22-L26) — the two guards, both live-or-deliverable only
- `src/_pages/plans-list/api/pending-guards.ts:29-33` — `assertNoActiveJob`'s docstring, citing the cascade
- `src/_pages/plans-list/api/plan-actions.integration.test.ts:291-296` — *"ALLOWS deleting the source once its job is terminal"*
- `src/entities/timetable/model/generation/job-delivery.ts:35-37` — `isDeliverableJob`, which reads `delivered_plan_id is null`
- `src/_pages/plans-list/ui/DeletePlanDialog.tsx:38-60` — the confirmation copy that never mentions generation

**Precedents for the acknowledgement**
- `src/_pages/plan-detail/lib/board-zoom.ts`, `drag-hint-mode.ts`, `shelf-pinned.ts` — the three localStorage singletons
- `src/_pages/plan-detail/lib/palette-collapsed.ts:9-10` — *"Actions transport app-data mutations, not per-device cosmetic prefs"*
- `src/shared/lib/use-hydrated/use-hydrated.ts:16-21` — the server-snapshot idiom
- `src/_pages/plan-detail/api/generation-actions.ts:19-28` — where a dismiss Action would go

## Architecture Insights

- **`delivered_plan_id` conflates a fact with a link.** `delivered = row.delivered_plan_id !== null`, but the column is `ON DELETE SET NULL` — so deleting the produced plan erases the *fact of delivery* along with the *pointer to it*. `delivery` (`null | 'proposal'`) is the fact that actually survives. The visible symptom is analysed in `generation-deletion-integrity`.
- **The cascade asymmetry is deliberate and correct, but incompletely reasoned through.** The migration argues the job must outlive the plans it *produced*; nobody asked what happens when it does not outlive the plan it *came from*. That asymmetry is precisely where provenance lives.
- **The only durable provenance is a row nobody thinks of as provenance.** `plans` has no self-reference; the clone's name is renameable; the hub renders no source name. Everything rests on `generation_jobs.plan_id` — a column whose stated purpose is job ownership.
- **Two guards, two shapes.** The delete path guards *liveness* (`assertNoActiveJob`) and *pendingness* (`assertNotPending`) but has no concept of *referential aftermath* — what a delete leaves behind for a row that is already finished.
- **FSD layer direction makes the F6 seam clean by force.** `shared` cannot import `entities`, so `isActiveJobStatus` can only reach the factory as a closure — which is exactly the right shape anyway. The constraint is doing design work here.

## Historical Context (from prior changes)

- `context/archive/2026-08-25-drift-decided-delivery/change.md:16-46` — the binding "the proposal is a plan" decision and the equivalence argument that retired merge/auto-apply. Do not re-litigate merge, the drift gate, dominance, or auto-apply.
- `context/archive/2026-08-25-drift-decided-delivery/plan.md:472-497` — §6 "The strip, split": *"The source shows only what is the source's to show; the proposal shows provenance."*
- `context/archive/2026-08-25-drift-decided-delivery/plan.md:107-108` — retention explicitly out of scope; Delete is the act.
- `context/archive/2026-08-25-drift-decided-delivery/reviews/impl-review.md:79-87` — F6 itself (OBSERVATION / MEDIUM), the only deferred finding of nine; F1-F5 and F7-F9 all shipped in the S-306 PR. F1 and F3 (`:25-37`, `reviews/plan-review.md:47-56`) are the closest prior art for the deletion defects now tracked separately — both are *narrower* versions of the same class, caught at review time.
- `context/archive/2026-08-19-staged-progress-and-checkpoints/research.md:302-313` — the React 19 `set-state-in-effect` wall that makes `useSyncExternalStore` the required polling idiom; `:689` pre-authorises a `shared/lib` home for the store.
- `context/archive/2026-08-19-staged-progress-and-checkpoints/research.md:338-376` and `plan.md:621` — the FR-312 render-contention argument and the diff-level success criterion that retired it structurally.
- `context/archive/2026-06-13-teacher-availability/follow-ups/review-fixes.md` — the prior `fsd/shared-lib-grouping` wall.
- `context/foundation/ui-conventions.md:227-234` — the store adoption-trigger checklist; trigger 3 (*five persistence clones, "no felt consolidation pain yet — watch it"*) is the adjacent, larger duplication family F6 does **not** address.

## Related Research

- `context/archive/2026-08-31-generation-deletion-integrity/research.md` — **split out of this document.** The two deletion defects, the confirmed D2 reproduction, and the FK fact/link conflation in full.
- `context/archive/2026-08-25-drift-decided-delivery/research.md` — §5 (falsified in place by `frame.md:87-89`), open questions 8 (proposal retention) and the `notified_at` "no writer, no reader" note at `:394`.
- `context/archive/2026-08-19-staged-progress-and-checkpoints/research.md` — the poll-location decision, in full.
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md:200` — `notified_at`'s origin as an S-310 forward reservation.

## Open Questions

**Resolved 2026-08-31** (during the walk-through; kept for the record):

- **~~Q1 — should provenance survive the source's deletion?~~ NO.** The link is navigational, FR-307 makes a delivered proposal an ordinary plan, and `pending-guards.ts:95-98` already treats an orphaned clone as disposable. The clone's name carries the informational residue. Denormalisation dropped; D1 downgraded to correct behaviour. (Note: storing provenance *on the job* could never have worked — that row cascades away with the source. Only a column on the surviving `plans` row would have, and it is not wanted.)
- **~~Q3 — per-job or per-plan acknowledgement?~~ PER-JOB**, and it is forced. `generation_jobs_active_per_plan` means every Generate creates a new row, so a regeneration should produce fresh provenance; putting the column on `generation_jobs` makes it per-job by construction.
- **~~Q4 (D2 fix shape)~~ and ~~Q5 (test placement)~~ — moved** to `context/archive/2026-08-31-generation-deletion-integrity/research.md` along with the defects themselves. Both were resolved there: a predicate change with no migration, and integration tests rather than a new E2E spec.
- **~~Q7 — should F6 leave room for the five localStorage clones?~~ NO — unrelated.** They share only the listeners-Set + `subscribe`/`getSnapshot` skeleton; they have no timer, no async, no `inFlight` and no visibility handling. F6's entire subject is absent from all five. A shared base would be a thinner `createExternalStore` — a different refactor, already tracked separately as `ui-conventions.md` adoption-trigger 3.

**Still open:**

1. **~~Q2 — what does "acknowledged" hide?~~ THE STRIP ENTIRELY** (decided 2026-09-01). Not a collapsed affordance — acknowledged means the proposal page is visually an ordinary plan. Two consequences the note's plan must carry: FR-308 needs **re-grounding, not re-wording** (this is the one option its substance does not survive — see §5, and contrast FR-311/FR-313 which were re-worded in place); and the clone's `Proposal — <source>` name becomes the **only** surviving record of provenance for an acknowledged plan, which retroactively raises the stakes on the "no change proposed" verdict about that name in the Summary. §4.2's `provenance_acked_at` recommendation is unaffected — a persisted dismissal still needs the column.
2. **Q6 — what closes F6 as WONTFIX, and who decides?** *(de-risked 2026-09-01: the eviction fix is now phase 1 and ships independently, so a WONTFIX on the extraction costs nothing but the extraction.)* §1.5 proposes post-rebase readability of `job-progress-store.ts`, which is a judgement rather than a metric. May be a manufactured question — "just do it" is a legitimate answer for queued review work.
3. **Does the acknowledgement need to distinguish "dismissed" from "outranked"?** `pickJob` can hide the note because a newer job exists (§3.3). If the author later deletes that newer job's proposal, the note returns — dismissed or not. Whether a stamped `provenance_acked_at` should survive that round trip is a design decision, not a code one.

---

## Follow-up Research 2026-09-01T10:57:06+02:00 — impact of `generation-deletion-integrity`

**Git commit**: `1ab083079596127d96f38f7d2c453ba188a11474` · **Branch**: `main`

**Trigger**: "the change *drift-decided-delivery* has been just implemented and archived — check if
this affected our research."

**First, the identity.** `drift-decided-delivery` was archived on **2026-08-29** at `ff609de` — the
exact commit this document already pins, so it was fully accounted for when the research was written.
The change that shipped *after* it is **`generation-deletion-integrity`** (`48f723b`…`1ab0830`,
archived `2026-08-31T21:04:41Z`, now `context/archive/2026-08-31-generation-deletion-integrity/`) —
the very defects §3 split out of this document. Everything below is about that one.

### Verdict in one line

**The F6 half is untouched and every finding in §1 still verifies exactly. The provenance half moved:
three statements are now narrower, Open Question 3 is largely closed, one new by-design "no note" path
exists, and the shipped change left one residual defect that belongs to *this* change because its fix
is a `merge`-semantics change.**

### 1. F6 — re-verified, nothing moved

Neither store was touched (`git diff ff609de..HEAD` lists no `job-progress-store.ts` and no
`use-pending-proposal.ts`). Re-verified at `1ab0830`:

- `job-progress-store.ts:61-145` and `use-pending-proposal.ts:59-147` — same ranges, same bodies. The
  **D1-D9 table, the 4-required + 3-optional surface, and both corrections in §1.4 stand as written.**
- `job-progress-store.test.ts:167` / `:266` still pin the ungated visibility tick (D8).
- `setInterval` — still **exactly two** non-test sites in `src/`; `visibilitychange` — still two.
  `use-generation-job.ts:24-26` is still the deliberate non-consumer. **§1.3 "no third consumer" holds.**
- `src/shared/lib` — still **14** children. The 15-child `fsd/shared-lib-grouping` ceiling and its
  "last free slot" arithmetic in §1.4 are unchanged.

**One thing F6 must now carry that it did not before.** D6 ("Publish input — `merge(snapshot, fetched)`,
terminal memory") stopped being a neutral dedup detail. The shipped change added a *drop* at the
indicator mapping edge whose intended effect depends on merge semantics that do not deliver it — see §5.
Whatever `read: (current: T) => Promise<T>` seam F6 lands, it has to be able to express **eviction**,
not just union, or it freezes today's bug into the shared factory.

### 2. `pickJob` changed — §2 bullet 1 and §3 item 3 are now narrower

`pickJob` is at **`generation-delivery.ts:217`** (was `:212-215`) and its test is now two conditions:

```ts
const undelivered = asSource !== null && asSource.delivered_plan_id === null && asSource.delivery === null;
if (asSource && (isActiveJobStatus(asSource.status) || undelivered)) return asSource;
```

- **Fixed:** the sub-case where a *delivered* newer job's proposal was deleted re-nulled
  `delivered_plan_id`, made the newer row read as "undelivered", and permanently hid an A→B→C chain's
  "Generated from A" strip. `delivery` is durable, so that route is closed and pinned by a new A→B→C
  integration case.
- **Unchanged:** a newer job that ends `failed`, or halts with no checkpoint, still leaves `delivery`
  null and still outranks the provenance **permanently**. §2's bullet is right about the mechanism and
  now wrong about one of its two causes.

### 3. Open Question 3 is largely closed

Q3 asked whether an acknowledgement must distinguish "dismissed" from "outranked", on the premise that
*"if the author later deletes that newer job's proposal, the note returns — dismissed or not."*

That deletion round-trip no longer moves the note at all: `delivery` survives the FK, so precedence is
now stable across the proposal's deletion. (For the record the premise was also inverted — under the
pre-`1ab0830` code, deleting the newer proposal *hid* the note rather than returning it, which is
exactly the bug that was fixed.) **What survives of Q3** is only the failed-newer-job case, where the
note is hidden permanently and no acknowledgement flag is involved either way. That is a much weaker
version of the question and probably does not gate the design.

### 4. A new, by-design "no note" path — `releaseOrphanProposal`

§2 listed four ways the note stops rendering. There is now a fifth, and unlike the detach branch it is
reachable through an ordinary flow:

- **`src/_pages/plan-detail/api/release-orphan-proposal.ts`** (new, barrel-exported at `api/index.ts:12`),
  called from **`src/pages/plans/[id]/index.astro:60-66`** on the one path where `checkPlan` returned
  null *cleanly*. It lazily un-pends a proposal clone that no job row references, guarded by
  `stalenessCutoff` on the plan's own `created_at` and by a defensive `proposal_plan_id` re-check.

So deleting the source of a **stale-running** solve now leaves a former proposal that is an ordinary,
editable, board-carrying plan with **no job row and therefore no provenance at all** — silently, by
decision (`plan.md:87` "No notice on orphan release"). Previously it was a permanently-pending page.

**Consequence for the acknowledgement UI:** "there is no note because there is no job" is now a normal
resting state reachable by two ordinary flows, not an anomaly. A dismiss affordance must not imply the
note was ever there. It does **not** change §4.2's storage recommendation — an ack on a row that does
not exist cannot be orphaned.

### 5. NEW RESIDUAL DEFECT — the mapping-edge drop does not heal the open hub tab

The shipped change added, at `plan-indicators.ts:161-183`, a drop of the delivered-then-deleted shape
(`delivery !== null && delivered_plan_id === null`). Its plan and its docblock both claim the drop
*"heals `refreshKnown`, which is unfiltered by design: an already-open hub tab tracking the jobId stops
badging on its next tick, no reload needed"* (`plan.md:212-216`; `plan-indicators.ts:145-148`). **It does
not, and `merge` is the reason.**

`merge` is union-biased by design — *"a plan the fetch did not mention keeps what it had, which is what
makes terminal memory work"* (`job-progress-store.ts:150-163`):

```ts
const merge = (current, fetched) => new Map([...current, ...indexByPlan(fetched)]);
```

Dropping a row at `toGenerationIndicator` removes it from `fetched`; it does **not** remove the
remembered entry keyed by the same source plan. Both read paths now filter the row out
(`surfacedJobsFor` at `generation-status.ts:98`, the mapping edge at `plan-indicators.ts:161`), so the
tab is told *nothing* about that job ever again and rule 4 keeps the last badge forever. Two orderings,
both stale, one worse:

| Ordering | What the open tab shows | Extra damage |
|---|---|---|
| Job goes terminal, tab ticks once, *then* the proposal is deleted | **"Ready — open"**, `href` = `/plans/<deleted proposal>` | a live link to a plan that no longer exists |
| The proposal is deleted before the tab's next tick | **"Generating — stage N"**, frozen | the snapshot never learns the job went terminal, so `shouldRun()` stays true and the tab polls every 5 s **forever** |

**Scope is narrow but real.** A delete performed on the hub itself is safe: `useConfirmAction` calls
`refreshPage()` → `navigate()` (`shared/lib/forms/refresh-page.ts`), and no island in `src/` uses
`transition:persist`, so `PlansHub` remounts and the store is rebuilt from fresh SSR. The defect needs a
**second surface** — a delete from the plan-detail page, or a second hub tab.

**It is this change's to fix, not a re-opening of the archived one.** The server-side half of the fix
shipped and is correct; what is left is a `merge`/eviction semantics question in `job-progress-store.ts`
— the exact file F6 rewrites, and the exact seam (D6) F6 has to parameterise. Fixing it inside F6 costs
nothing extra; fixing it separately means touching `merge` twice.

**Note the irony worth recording**: §"Summary" concluded the author's *"link to non-existing things"*
premise **does not hold**, and for the provenance note that remains true — `plan_id` cascades, link and
row die together. It turns out to hold, narrowly, for a *different* surface (the hub badge, in RAM, in
an already-open tab), and it was introduced the day after this research was written.

### 6. Facts and citations that moved

| §  | Cited as | Now | Status |
|----|----------|-----|--------|
| §2, §3.3, Code References | `generation-delivery.ts:212-215` (`pickJob`) | `:217` | moved **and changed** — see §2 above |
| §4.1, Code References | `generation-delivery.ts:195-209` (`markNotified`) | `:200` | moved only; §4.1's analysis is unchanged |
| §4.2 | `generation-delivery.ts:114-115` (`STATUS_COLUMNS`) | `:117` | moved only; still the projection `provenance_acked_at` would ride |
| §2 | `generation-delivery.ts:309-327` (detach branch) | `:316-341` | moved only |
| §2, §4.1 | `generation-status.ts:89` (`notified_at` reader) | `:98` | moved; the third `.or` arm is byte-identical, §4.1 stands |
| Summary, Q1 | `pending-guards.ts:95-98` (orphan clone disposable) | `:99-102` | moved; and the orphan is now *usable*, not only disposable (§4) |
| §3, Code References | `job-delivery.ts:35-37` (`isDeliverableJob`) | `:61-64` | moved **and changed** — now also requires `delivery === null` |
| Code References | `plan-indicators.ts:104-129` (`describeGenerationIndicator`) | `:107-129` | moved only |
| §3, Code References | `generation-delivery.integration.test.ts:371-405` | shifted (+117 lines in the file) | the "failure outranks provenance too" pin still exists |
| Code References | `plan-actions.integration.test.ts:291-296` | shifted (+42 lines) | still present |
| §1.4, §5 | `src/shared/lib` at 14 of 15 | unchanged | ✓ |
| §5 | `e2e/specs/generation.spec.ts` coupling | unchanged | ✓ file not touched |
| §4.2 | solver grant / `solver-credential.integration.test.ts:211-217` | unchanged | ✓ no migration shipped |

### 7. What did **not** change, and is worth stating

- **§4.2's `provenance_acked_at` recommendation stands in full.** No migration landed;
  `delivery` was already a column (`20260810200122_generation_jobs.sql:94`, vocabulary added by
  `20260828093000`) and already in both `STATUS_COLUMNS` projections. Zero GRANT/RLS work, one column
  on the existing projection, cascade alignment — all unchanged.
- **§4.1 (`notified_at` is the wrong lever) is unchanged** — still one writer, one reader.
- **§4.3 (localStorage is the wrong storage class) is unchanged.**
- **§5's FR-308 constraint is unchanged**, and so is the "degrade, not delete" conclusion.
- **The clone's NAME as the surviving residue is unchanged** — and the archived change leaned on the
  same argument to justify a silent orphan release (`plan.md:87`).

### 8. One insight to restate rather than repeat

Architecture Insight #1 said *"`delivered_plan_id` conflates a fact with a link… `delivery` is the fact
that actually survives."* That is no longer an observation — it is **shipped and enforced**:
`isDeliverableJob`, `pickJob`, `surfacedJobsFor` and `toGenerationIndicator` all consult `delivery`, and
`GenerationJobDelivery` (`job-delivery.ts:33`) is a write-side vocabulary type. That gives §4.2 a fresh
in-table precedent for "a column recording a fact no foreign key can reach" — which is exactly the shape
`provenance_acked_at` would be.

### Open Questions after this pass

1. **~~Q3~~ — largely closed** (§3). Only the failed-newer-job case survives, and it involves no ack flag.
2. **NEW Q8 — how should the poll evict?** The hub store has no way to say "this job is gone, forget it".
   Candidates: a tombstone in the fetcher's return, a `read` that returns the *whole* next snapshot
   (which D6's proposed `read: (current: T) => Promise<T>` seam already permits), or keeping the row and
   giving it a badge-less terminal shape. **This is the design call that decides whether F6's seam is
   union or replace**, so it should be answered *inside* F6 rather than before it.
3. **Q2 (what "acknowledged" hides) and Q6 (F6's WONTFIX gate) are untouched** by this change.

---

## Decisions 2026-09-01 — scope for the plan

Settled with the author after the impact check above. These are inputs to `/10x-plan`, not findings.

**1. This change is now `eviction fix → F6`, two phases, in that order.** The provenance note is
**parked** — it is a separate piece with no shared file (per the Recommendation section), and parking
it keeps a day-old regression off a UX decision's critical path.

- **Phase 1 — eviction, in place.** Fix `merge` in today's `job-progress-store.ts:162` so a remembered
  entry whose job was refreshed and deliberately omitted is dropped rather than kept. Ships on its own,
  gated on nothing. Answers Q8 for the *current* store; the answer then becomes phase 2's constraint.
- **Phase 2 — F6, behind §1.5's readability gate.** The shared factory's `read`/merge seam (D6) must
  **preserve phase 1's semantics**, which turns Q8 from an open design question into an acceptance
  criterion. If the gate fails, phase 2 closes WONTFIX and phase 1 still stands.

The ordering is deliberate: the alternative (fold eviction into the D6 seam) is cheaper *if* F6 ships,
but makes a shipped regression hostage to an abandon gate the research itself recommends keeping.

**2. Q2 is decided — acknowledged hides the strip entirely.** See Open Questions above. Not in this
change's scope; recorded so the note's plan starts from a settled premise and re-grounds FR-308
rather than re-wording it.

**3. Q6 is not a blocker.** "Just do it, with post-rebase readability as a phase-2 success criterion"
is the answer. Phase 1 makes the gate cheap to honour.
