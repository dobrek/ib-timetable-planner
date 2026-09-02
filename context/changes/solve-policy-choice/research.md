---
date: 2026-09-02T12:00:10+02:00
researcher: Dobromir Kropielnicki
git_commit: 240d640b68ad687995c56f7c1c678e444b5ea0a8
branch: main
repository: ib-timetable-planner
topic: "Feasibility and UI challenges of shipping solve-policy-choice as roadmap task S-307"
tags: [research, codebase, solver, cp-sat, contracts, generation, ui, roadmap, s-307, fr-302]
status: complete
last_updated: 2026-09-02
last_updated_by: Dobromir Kropielnicki
---

# Research: Feasibility and UI challenges of S-307 `solve-policy-choice`

**Date**: 2026-09-02T12:00:10+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `240d640b68ad687995c56f7c1c678e444b5ea0a8`
**Branch**: `main` (in sync with `origin/main`)
**Repository**: `dobrek/ib-timetable-planner`

> References are local `file:line` throughout, because the consumer of this document is `/10x-plan`
> and a local path is what an implementer greps. The commit is pushed, so any reference converts to a
> permalink with the prefix
> `https://github.com/dobrek/ib-timetable-planner/blob/240d640b68ad687995c56f7c1c678e444b5ea0a8/`.

## Research Question

Check the feasibility and the UI challenges of implementing `solve-policy-choice` as roadmap task
S-307 — the slice that lets an author choose the solve policy when launching a CP-SAT job (clean mode
the shipped default; canonical lexicographic order and the teacher/student trade-off as selectable
alternatives), and which since 2026-08-28 also *solely owns* dominance-checking.

Scope agreed before research: assess dominance fully **and** judge whether it belongs in S-307;
inventory the UI challenges **and** propose concrete launch-surface shapes.

## Summary

**S-307 is feasible, and the mechanism half is substantially cheaper than the roadmap prices it — but
the slice as chartered contains one part that should not ship with it, and the UI half carries a
shipped-copy correctness bug that nobody has costed.**

Four headline findings.

1. **The roadmap's Risk note is ~50% stale.** Written 2026-08-11, it says `SolveConfig` has "no
   tier-order and no hard/soft field" and that `solve_staged` hardcodes the ladder. Since then S-301
   added `clean_mode` — which *is* the hard/soft field — and `_run_ladder` already takes the tier
   sequence as a parameter (`solve.py:543-551`), proven in production by `solve_repair` passing a
   sparse, reordered `(0, 3)` at `solve.py:452`. Only **tier order at the call sites** is genuinely
   missing. Realistic engine cost: **~30–50 lines in one file plus a test module**. And one of the
   three product policies — "canonical lexicographic order" — needs **zero new engine code**: it is
   `clean_mode=False`, already implemented and tested (`test_solve.py:211-217`), merely unreachable
   because `runner.py:260` hardcodes `True`.

2. **The carrier is settled, and it reverses an F-302 decision that must be re-opened on the record.**
   An optional `policy` on `SolveRequest` is "additive-and-optional" per the contract's own rule
   (`contracts/README.md:144-145`), so **no `formatVersion` bump is forced** — S-303's `stoppedBy` is
   the worked precedent. The alternatives are both worse: the row is unreadable to the solver by
   design (SELECT is column-scoped to exactly five columns, with `policy` explicitly in the "lost"
   list), and env vars are per-deployment, not per-launch. But F-302 research *rejected* the wire
   route on "two copies that can disagree" grounds. That objection is answerable — write both from
   one validated value — and answering it explicitly is part of the slice.

3. **The UI is the harder half, and the sharpest item is a copy bug the slice creates.**
   `describeCleanLabel`'s `not-clean` branch currently reads *"No clean board was possible for this
   catalog."* That is true only because every run is clean-mode. The moment a non-clean policy is
   selectable, the sentence is a lie. `clean-label.ts` must take the policy as an input, or be
   re-worded. Six further challenges are inventoried in §5, including a live-gating race, an
   accessibility gap the picker would inherit, and the "stage N of 10" denominator that four surfaces
   depend on.

4. **Dominance does not belong in S-307 — split it out.** It has **no producer** (one policy per job,
   one board per job, one active job per plan — nothing to be strictly worse *than*) and **no
   consumer** (its only plausible surface refuses to judge, in 11 files, enforced by a type with no
   numeric field and a test assertion, and the author has said on the record that the board is what
   makes them confident). Two of the three premises in the roadmap's own costing are false (§7.2).
   Where a dominance-shaped check *does* have a real, already-broken consumer is checkpoint
   monotonicity — a different slice.

**Recommended scope for S-307** — the mechanism (ladder-order + clean on/off through `SolveConfig`),
the wire widening, a launch-time picker, a reproducibility flag on `cli.py`, and the `clean-label`
correction. Drop dominance. That leaves a slice comparable in size to S-305 and clearly smaller than
S-303. §9 states it as a checklist.

## Detailed Findings

### 1. What "policy" actually means — the evidence base

The whole FR rests on one measurement: the POC's **three-board frontier**
(`context/archive/2026-07-15-poc-cp-sat-backend-service/results.md:122-152`), which solved the
identical golden instance under three objective policies:

| tier (lower = better) | Expert (golden, **incomplete**) | canonical order | clean (teacher-first) | student-first |
| --- | ---: | ---: | ---: | ---: |
| unplaced | residue open | 0 | 0 | 0 |
| interior holes | 0 | 0 | 0 | 0 |
| occupied slots | 95 | 95 | **93** | 97 |
| **teacher gaps** | **74** | 95 | 75 | 124 |
| soft warnings | — | 3 | **0** | **0** |
| **student gaps** | 612 | 824 | 765 | **579** |
| doubles deficit | — | 220 | 216 | **180** |
| late starts | — | 2 | 2 | **0** |
| Friday tail | — | 34 | **32** | 36 |
| golden-band | — | 11 | 11 | **5** |

The three policies, defined exactly (`results.md:165-169`):

- **canonical** — no clean constraint, expert-elicited tier order.
- **clean** — `softHits` hard-constrained, then `holes → slots → teacher → student`.
- **student-first** — `softHits` hard-constrained, then `holes → student → slots → teacher`.

Four things follow that shape the slice:

- **"The dial" is a two-position switch in the evidence, not a continuum.** There is exactly one
  measured alternative ordering. `grep "dial"` across `context/` returns only the POC's "product
  dial" phrasing and the FR sentences echoing it. No intermediate points exist.
- **The trade-off is real and quantified**: student-first buys **186** student gap-slots for **49**
  teacher gap-slots versus clean (`results.md:186-189`).
- **The expert has already answered the trade-off.** Forced choice 5.6 —
  `context/archive/2026-07-12-generation-quality-tuning/research.md:523-524` — teacher comfort
  outranks student comfort, labour-law backed. So student-first is offered *against* the elicited
  preference; its legitimate counterweight is caveat 5.7 (`research.md:528-529`): the teacher-gap
  metric sees only the two DP boards, so some measured windows are not really windows.
- **Non-determinism is comparable in magnitude to the policy effect.** Two clean solves under
  identical settings landed at teacher 60/student 889 and teacher 75/student 765 — *"both valid,
  neither dominating the other"* (`results.md:197-200`). At `DEFAULT_WORKERS = 8`
  (`settings.py:32`) a fixed seed does not buy reproducibility. **A single run per policy is not
  evidence**, and this constrains how S-307 can be acceptance-tested (§8, Open Question 4).

The tier vocabulary already exists author-facing: `tier-labels.ts:25-37` maps the engine's names to
`completeness / unplaced / holes / total slots / teacher holes / soft hits / student holes / doubles /
late starts / Friday tail / golden band`. A picker gets its nouns for free.

### 2. Feasibility A — the engine mechanism (small, and mostly already built)

**What the roadmap claims vs. what is true today** (`context/foundation/roadmap.md:234`):

| Roadmap claim (2026-08-11) | Status on `240d640` |
| --- | --- |
| tier order is a hardcoded tuple literal (`objective.py:55-66`) | **TRUE**, now at `objective.py:59-70` |
| `solve_staged` hardcodes the ladder as `range(1,10)` (`solve.py:152`) | **MISLEADING** — now the module constant `_LADDER_TIER_INDICES` at `solve.py:150`, **passed as an argument** into `_run_ladder(…, tier_indices, …)` (`solve.py:543-551`) |
| `SolveConfig` has no tier-order and **no hard/soft field** | **HALF FALSE** — it carries `clean_mode` (`solve.py:136`), `targets` (`:142`) and `hooks` (`:144`) |

**`_run_ladder` makes no ordering assumption.** Every use of the index was checked:
`for offset, idx in enumerate(indices)` (`solve.py:571`) keeps position and identity separate;
`tier = objective.tiers[idx]` (`:579`) is an identity lookup; the clique cut fires on tier identity
(`if idx == 2`, `:581-582`); `StageEvent` reports tier number *and* position separately (`:586`);
targets are keyed by tier number (`:599`); hardening `tier.var <= best` (`:616`) is order-agnostic by
construction. **A permuted `tier_indices` would work today with no change to `_run_ladder` at all.**

**Clean mode as shipped** is a hard constraint at the feasibility stage, gated by one flag:
`_feasibility(...)` adds `soft_hits == floor` (`solve.py:417-419`) using the aux-var-free linear form
`soft_hits_terms` (`objective.py:176-211`) that exists precisely for this. Note it is `== floor`, not
`== 0` — pins on soft cells are irreducible. **FR-302's own wording (`prd.md:318-320`,
"clean mode (`softHits ≡ 0`)") is therefore imprecise and should be trued up.**

**The insulation discipline S-307 must obey.** `parity()` (`solve.py:192-211`) and `evaluate_board()`
(`:214-227`) take **no config**, which is why `clean_mode` and `targets` are invisible to the 10/10
objective-parity gate — stated three times in-code (`solve.py:132-135`, `:138-141`, `:143`). Keep the
tier **tuple** canonical and permute only the ladder's **visit order**, and the gate, the goldens and
`test_objective.py:24`'s `SEED_OBJECTIVE` stay untouched by construction. Reordering
`build_objective` instead would break the gate at `solve.py:208` and every positional index.

**Concrete edits (~30–50 lines, one file):**

| # | file:line | change |
| --- | --- | --- |
| 1 | `solve.py:144` | add `ladder: tuple[int, ...] \| None = None` + insulation docstring |
| 2 | `solve.py:240`, `:358` | `_LADDER_TIER_INDICES` → `config.ladder or _LADDER_TIER_INDICES` |
| 3 | `solve.py:151` (+ readers `:258, :284, :304, :335, :378`) | derive `_FULL_LADDER_STAGES` from the effective ladder, or tier 1's `total` lies for any non-length-9 ladder |
| 4 | new | validate the sequence is a **permutation** of the canonical indices |
| 5 | `runner.py:257-272` | read the request policy into `SolveConfig` beside the existing `clean_mode` / `targets` |

**Constrain policies to permutations, not subsets.** That keeps ladder length at 9 (+ tier 1 = 10
stages), which keeps `LADDER_TIER_COUNT = 10` and every "stage N of 10" reader intact (§5, C6).

**Tests to edit:** `test_service.py:509-523` (`test_every_solve_requests_clean_mode`, asserts
`== [True]`) becomes policy-parameterized; `test_service.py:541-543` asserts the exact stage
sequence and needs relaxing under a permutation. `src/test/solver-transport.integration.test.ts:107`
(`toHaveLength(LADDER_TIER_COUNT)`) survives a permutation unchanged. Of `test_objective.py`'s 16
tests, 14 are name-keyed via `_tiers()` (`:27-38`) and immune; only the two parity tests are
order-bound, and the design above keeps them out of the diff.

### 3. Feasibility B — the carrier (wire, and why not the row)

`SolveRequest` today is `{formatVersion, snapshot, warmStart?}` with `additionalProperties: false`
(`contracts/generation-wire.schema.json:222-236`). An unknown key is a **422** at request time —
`app.py:286-294` validates the raw body against the schema itself, pinned by `test_service.py:373-384`.

**No `formatVersion` bump is forced.** `contracts/README.md:144-145`: *"Additive-and-optional changes
(a new optional property, a widened enum on a value the peer already tolerates) do not bump it."* The
worked precedent is S-303's `stoppedBy` (`README.md:151-155`). One constraint: a **float would force a
bump** (`README.md:115`), so the policy must be an enum or integers — never a `0.5` "dial position".

**The snapshot hash is unaffected.** `computeSnapshotHash` digests `canonicalizeSnapshot(snapshot)`
only (`wire.ts:105-108`; Python `wire.py:57-67`), and the binding check compares only that
(`runner.py:227-246`). So policy on the envelope does not touch drift semantics, and the recorded
cross-language digest (`bench/contract-parity.test.ts:56` / `test_contract.py:47`) stays valid.

**Both canonicalizers are explicit whitelists** — `toWireSolveRequest` (`wire.ts:153-159`) and
`canonical_solve_request_json` (`wire.py:125-131`) construct their object literally. **A field added
to the type alone is silently dropped.** Both must be edited or the picker is a no-op.

**Why not the job row.** `generation_jobs.policy` exists (`20260810200122_generation_jobs.sql:65`,
`jsonb not null`) but the solver **cannot read it**: SELECT was revoked table-wide and re-granted
column-scoped to `id, status, snapshot_hash` (`20260812141459_solver_select_column_scope.sql:71-72`)
plus `heartbeat_at, stop_requested_at` (`20260820075348:33`). `policy` is named in that migration's
**"lost"** list at `:41`. Two exact-list integration pins police it
(`src/test/solver-credential.integration.test.ts:213-219`, `:224-236`). Widening costs a migration, a
policy re-create (the policy name literally counts columns), and two pinned-test edits — and reverses
a least-privilege decision argued at length. **Reject.**

**Why not env.** `SOLVER_WORKERS` / `SOLVER_STAGE_TARGETS` are read once at import
(`settings.py:104-116`) and documented as *"Overridable per deployment, not per request"*
(`settings.py:31`). A per-launch author choice has no env expression. (Note also that
`solver-container-env.ts:25-43` forwards six keys and `SOLVER_STAGE_TARGETS` is not among them, so
even that knob does not reach production.) **Reject.**

**The decision this reverses, and how to answer it.**
`context/archive/2026-08-11-solver-service-transport/research.md:503-506` rejected an additive
`policy?` on the envelope: *"policy already lives in `generation_jobs.policy` (`jsonb not null`), so
putting it in the envelope as well would create two copies that can disagree … One authoritative home
is better."* The answer S-307 should record: **derive both from one validated value at one call site**
— `startGeneration` validates the author's choice once, writes it to `policy` (the audit record its
own comment says S-307 owns, `generation-job.ts:168-170`) and passes the same object to
`dispatchSolveJob` (`:218-220`). Optionally have the service echo the effective policy into the row
it already writes, closing the loop. Without that, the row and the wire can silently disagree —
`snapshot_hash` binds the snapshot, not the policy (`runner.py:227-246`).

**Goldens.** An *omitted* optional key leaves all three fixtures byte-identical and needs no
regeneration. If S-307 follows the README's own fixture doctrine (`:163-168` — `warmStart` is
non-empty "on purpose … a fixture without it would leave the omit-when-absent rule ungated") and puts
`policy` in `solve-request.json`, regeneration is required but **cheap and CP-SAT-free**:
`bench/generate-contract-goldens.experiment.ts:61-81` derives the solve-request golden from the other
two. Two side effects to handle: the README sentence calling `warmStart` "the envelope's **only**
optional key" retires, and **no policy sub-field may be named `name`** —
`contract-parity.test.ts:127` greps the raw bytes for display-text keys.

### 4. Feasibility C — the app thread (no migration, 13 hops, all small)

**No migration is needed.** Five migrations touch `generation_jobs` and only the first creates
columns; there is no `ALTER TABLE generation_jobs ADD COLUMN` anywhere. That was deliberate —
`20260810200122_generation_jobs.sql:5-7`: *"the column set below is forward-designed from all ten, so
those slices ship behaviour, not migrations."*

The dispatch chain, from click to wire:

`GenerateButton.tsx:48` → `use-generation-job.ts:87-102` (`launch()`) → `generation-client.ts:8-14`
→ `generation-actions.ts:21-24` → `generation-job.ts:56` (`startGenerationInput = z.object({ planId:
z.uuid() })`) → `:163-171` (the `policy: { clean: true }` literal) → `:218-220`
(`dispatchSolveJob(jobId, { formatVersion: 1, snapshot })`).

Three seams are already shaped for this: `startGenerationInput` is Zod (so a picker form gets its
types free, per `ui-conventions.md:129-140`); `start?: (planId) => Promise<GenerationJob>`
(`use-generation-job.ts:45`) is already injectable for tests; and `policy` is `not null` and written on
every insert, so the audit record exists and only needs a vocabulary.

One unused channel already open: `StartGenerationResult` carries `autoParked`
(`generation-job.ts:60-65`) which `use-generation-job.ts:96` discards. If a launch flow ever wants a
post-dispatch confirmation panel, it costs nothing.

### 5. The UI challenges

The launch surface today is **one button, one click, zero configuration** —
`GenerateButton.tsx:9-13` calls itself *"The zero-config toolbar Generate affordance"*. Seven
challenges, ordered by how much they can hurt.

**C1 — `describeCleanLabel` starts lying the moment a non-clean policy is selectable.**
`clean-label.ts:58-69`, the `not-clean` branch: *"Not clean — N hours sit on soft cells (M of them
pinned). **No clean board was possible for this catalog.**"* That claim is sound only because every
run is clean-mode today. Choose canonical and it is false — the board is not clean because the author
asked for a policy that does not require it. The label is a **derived read**, computed from
`stages[tier===5].best` versus a recomputed floor (`clean-label.ts:44-54`), and is rendered on the
proposal's provenance line (`GenerationStatusStrip.tsx:137`). **`clean-label.ts` must take the policy
as an input, or the sentence must be re-worded.** This is a shipped-copy correctness regression the
slice creates, and nothing in the roadmap or FR-302 costs it.

*(Adjacent, and worth fixing in the same breath: `deriveCleanLabel` reads tier-5 `best` as if it were
the finished board's `softHits`, but hardening is `tier.var <= best` (`solve.py:616`), so `best` is an
upper bound. A board that stages 6–10 improved to genuinely clean can be labelled `not-clean` today.)*

**C2 — the gating inputs are live, and a dialog held open can go stale.**
Generate has four disable reasons, ranked in `use-cohort-board-state.ts:129-136`: `generating`
(a live job, outranks the rest since S-306), `violations`, `complete`, then `busy`. All derive from
live board state — optimistic-write settlement, live placements, live collision maps. A dialog
interposed between click and dispatch must **re-check at confirm**, not only at open: the board can
gain a blocking violation or become complete while the author reads the policy copy. The precedent for
doing this well is `StopAndKeep`, whose copy is live off the polled snapshot by design
(`StopAndKeep.tsx:38-41`).

**C3 — the picker would inherit an accessibility gap.** All six Generate states share the constant
accessible name `"Generate plan"`; every reason lives on `title` only, which is mouse-hover-only —
**a screen-reader user gets no disabled reason today** (`GenerateButton.tsx:33-45`, `:53`). Meanwhile
ARIA *is* the e2e contract: `ui-conventions.md:93-100` requires user-perceivable state expressed via
ARIA and names `aria-checked` on `ToggleGroup type="single"` as the house idiom for an A/B choice.
Shipping a richer launch surface on top of that gap is a knowing choice; a dialog is the cheapest
place to fix it.

**C4 — naming the trade-off honestly is the hardest copy problem in the slice.** Three sub-problems:

- *A "dial" implies a continuum the mechanism does not have.* One measured alternative exists (§1).
  A `Slider` would be copy out-promising the mechanism — the exact failure `lessons.md`'s convention
  rule and S-305's *"no measured latency number in shipped copy"* discipline
  (`stop-and-keep/plan.md:109-110`) guard against. **The control must be discrete.**
- *The options must not read as ranked.* The expert already answered teacher-vs-student. Labelling one
  option "better" invites the author to read a preference as a verdict. The house style is to state
  the **consequence, not the mechanism** — `ClonePlanDialog.tsx:115`: *"On, the copy opens warm. Off,
  only the catalog travels and the board starts empty."*
- *The numbers that would make the choice meaningful cannot be quoted.* The 186-for-49 trade is one
  catalog, one machine, one run — and same-policy variance is comparable (§1). Shipped copy stays
  qualitative; numbers are S-308's to measure.

**C5 — "stage N of 10" is load-bearing in four places.** `LADDER_TIER_COUNT = 10`
(`tier-labels.ts:23`) feeds the hub badge (`plan-indicators.ts:195-196`), the pending page
(`PendingProposalPage.tsx:167-168`), the halted summary (`GenerationStatusStrip.tsx:189`) and the
Stop & keep confirm (`StopAndKeep.tsx:137`). Its own docstring already flags the risk:
*"If S-307 ever dispatches repair, this constant stops being a constant and the denominator moves onto
the job row beside `stage_index`."* **Constraining policies to permutations avoids all of it.** Note
the *order* of stage names still changes — "stage 4 of 10 · teacher holes" will name a different tier
under a different policy, which is correct and even informative.

**C6 — showing the policy afterwards is a 5-file plumb per surface, with a silent-failure mode.**
Nothing renders `policy` today; it is in neither projection (`generation-status.ts:37-38`,
`generation-delivery.ts:122-123`) and in neither view type. Worse, **both projections have an equality
gate that drops unnamed fields silently** — `job-progress-store.ts:116-137` (`sameIndicators`) and
`use-pending-proposal.ts:124-139` (`sameView`), the latter documented as a trap at `:120-123`:
*"Every field the page renders must be named here, in the same commit that adds it."* Recommendation:
show it on **one** surface only — `GenerationStatusStrip.tsx:136-138`, which is already the
provenance line, already role-gated to the proposal, and already an either/or slot.

**C7 — remembering the choice has four options, and one is clearly best.**
`ui-conventions.md:219-234` warns that a sixth per-flag persistence micro-store would trip store
adoption trigger 3 (five `useSyncExternalStore` clones already exist under `plan-detail/lib/`).
Options: per-device `localStorage` (cheapest, but follows the laptop not the plan); cookie + SSR seed
(only justified when it affects first paint — it does not); `sessionStorage` per plan
(`lens-session.ts`, but a solve is a rare 12–20-minute act and forgetting between sessions is a real
cost); or **seed the picker from the previous job's `policy` column** — durable, per-plan, survives
device changes, needs no new storage module and no sixth clone, and makes the audit column earn its
keep, which is exactly what its own comment says S-307 is for.

*Two smaller items.* `e2e/specs/generation.spec.ts:49` selects `getByRole("button", { name: "Generate
plan" })` — keep that accessible name on whatever becomes the trigger. And a new dialog flow should
prefer the `{ error }` return shape over generation's current throw-on-error client, per
`ui-conventions.md:217`, or record why not.

### 6. Three concrete launch-surface shapes

Every primitive needed already exists in `src/shared/ui/` — `AlertDialog`, `Dialog`, `Form`,
`Select`, `Slider`, `Tabs`, `ToggleGroup`, `Popover`, `DropdownMenu` (with `DropdownMenuRadioGroup`).
Only `RadioGroup` and `Tooltip` are absent, and **neither is needed**: `ui-conventions.md:98` names
`ToggleGroup type="single"` (which Radix renders with `radiogroup`/`radio` semantics —
`toggle-group.tsx:23`) as the project idiom, and the standing precedent for per-option explanation is
`FormDescription`, not a tooltip (`UndoRedoControls.tsx:15-18`).

**Option A — split button: `Generate` + a caret.** Primary click keeps the zero-config clean default;
the caret opens a `DropdownMenuRadioGroup` of three policies that dispatches on selection.
*For:* the default path is untouched, so no added friction for the common case and no E2E change to
the primary flow; cheapest to build; radio semantics for free.
*Against:* a menu item has room for a label, not for the consequence sentence C4 requires; a
`DropdownMenu` closes on interaction, so live-gating feedback (C2) has nowhere to live.

**Option B — `AlertDialog` confirm with a three-way `ToggleGroup` — recommended.** Generate opens a
dialog: title, a discrete three-option control, one consequence sentence per option, confirm labelled
with the chosen policy.
*For:* it is S-305's established idiom, chosen there for exactly this reason —
`StopAndKeep.tsx:46-47`: *"`AlertDialog` rather than `Dialog` because this is a decision the author has
to take deliberately."* It gives C4's copy somewhere honest to live, makes C2's re-check at confirm
natural, and fixes C3 in passing. `ClonePlanDialog` is the worked structural precedent for a launch
dialog carrying an option with a `FormLabel` + `FormDescription`.
*Against:* it converts a one-click act into two. Mitigated by seeding the choice from the previous
job's policy (C7), so the common case is Generate → Enter. `generation.spec.ts:49` needs updating.
*Why it is defensible on its own merits:* since S-306 a Generate creates a real, durable proposal plan
that accumulates, and the job runs 12–20 minutes. That is a deliberate act, not a routine one.

**Option C — a board-settings Popover section, Generate stays one click.** Rejected. It separates the
choice from the act, which is precisely what the POC warned against —
`results.md:173-174`: *"Make the tier order a first-class, explicit policy — **not a buried
constant**."* It also files a per-job decision under per-device board chrome.

**Recommendation: B**, with A as the fallback if the added step is judged too expensive — in which
case the consequence copy has to move somewhere else, and C4 is not satisfied by a menu item alone.

### 7. Dominance — assessment, and the recommendation to split

#### 7.1 Where it came from

POC finding 5 (`results.md:193-196`): the canonical campaign board *"sat off the efficient frontier"* —
CP-SAT clean dominated it on every prioritised tier — therefore *"a board should be dominance-checked
before it is presented as 'the' answer."* S-306's frame then moved the clause here by explicit author
decision (`drift-decided-delivery/frame.md:47`, `:95`, `:101`): *"Dominance is **not** what produces
confidence — it is not load-bearing for S-306 and should route to S-307 or drop."*

#### 7.2 Two of the roadmap's three costing premises are false

The Unknown at `roadmap.md:233` says both tuples must be computed app-side via `scoreCandidate`,
*"whose `remaining` input must be re-derived from `analyzePlan`'s completeness"*, and the PRD
(`prd.md:338-341`) plus `contracts/README.md:73` say a true tuple *"needs a separate `evaluate_board`
re-solve"*.

- **`remaining` needs no re-derivation.** `GenerationCohortDiagnostics.unplaced` is **required** on
  the wire (`generation-wire.schema.json:130,142`), and delivery already holds snapshot + board in
  memory at `generation-delivery.ts:295`. A 9-line fold already exists
  (`bench/export-snapshot.experiment.ts:145-153`). **Zero new round trips; `analyzePlan` is not
  needed.** (The FR-306 "~18 round trips" figure is about a *drift* signal, not this.)
- **A true tuple costs zero extra solves from tier 2 on.** All ten tier `IntVar`s live in the same
  `bundle.model` the stage just solved, and the solver object at `solve.py:615` holds the full
  solution vector; `tuple(int(solver.value(t.var)) for t in objective.tiers)` is literally what
  `parity()` evaluates at `solve.py:208`. `evaluate_board` *does* exist (`solve.py:214-227`, measured
  0.32 s) but is test-only and unnecessary here. Only the tier-1 checkpoint is genuinely uncovered,
  because `build_objective` has not run yet (`solve.py:238,352`).

So "the wire excludes the tuple, therefore app-side" is a *policy* consequence of the frozen contract,
not a technical one — and a bump is a live alternative.

#### 7.3 But it has no producer and no consumer

- **No producer.** A policy is a **launch-time** choice on a single job; one active job per plan
  (partial unique index, `20260810200122:99-103`), one board per job. **With one board there is
  nothing to be strictly worse than.** S-307 as scoped does not create competing boards, and
  multi-policy parallel runs are explicitly **parked** (`roadmap.md`, Parked: *"multi-policy parallel
  runs (per-job container instances) are a later lift"*).
- **No consumer.** The only two-board surface is the comparison page, and it is built to refuse
  exactly this. The PRD says the principle is restated in five files; **it is 11**, seven in the
  comparison slice alone — `scoreboard.ts:17`, `metric-catalog.ts:19`, `extremes.ts:24`,
  `compare-params.ts:6`, `ScoreboardTable.tsx:67-69`, `MetricHelp.tsx:13`,
  `PlanComparisonPage.tsx:31-32`, plus `DriftBanner.tsx`, `analyze-plan.ts`, `bench/plan-report.ts`,
  `bench/plan-quality.analyze.ts`. It is **physically enforced** — `MetricCell = { text: string;
  href?: string }` (`extremes.ts:25`) has no numeric field, *"so nothing downstream can subtract one
  row from another"* (`metric-catalog.ts:16-17`) — and **test-enforced**
  (`PlanComparisonPage.test.tsx:65`). And the author's own position is recorded
  (`prd.md:392-394`): what produces confidence is looking at the board, not a ranking.
- **No relation exists anywhere.** A repo-wide grep for `dominat|pareto|strictly.worse` returns only
  prose. `compareObjectives` (`objective.ts:81-86`) is strictly **lexicographic** — and its own test
  pins the property that makes it unusable here: `objective.test.ts:85` asserts a board wins on tier 3
  while being 999-worse on tiers 4 and 5.

#### 7.4 Where a dominance-shaped check *would* earn its keep

**Checkpoint monotonicity — a real, already-broken invariant.** S-303's outcome sentence
(`roadmap.md:36`) and the PRD (`prd.md:700-703`) describe a "never-worse" board, but what ships is a
*box* invariant, not an ordering: hardening (`solve.py:616`) guarantees each checkpoint sits inside a
shrinking box `tier_j <= best_j`, and the checkpoint write is an **unconditional overwrite** filtered
only on liveness (`supabase.py:204-227`). Nothing reads the previous checkpoint before writing, the
column has no constraint, and **no test compares checkpoint k+1 to checkpoint k**. A stage can
therefore land lexicographically worse than its predecessor. That, plus the `deriveCleanLabel`
upper-bound read in C1, is where a true tuple and a real comparison pay for themselves — and it is
S-303/S-304 territory, not policy choice.

#### 7.5 Recommendation

**Split dominance out of S-307.** Concretely:

1. **Keep in S-307:** the mechanism, the wire widening, the picker, the `clean-label` correction.
   **Drop the dominance clause from the Outcome** and from the Unknowns.
2. **Open a small new slice** — *"true objective tuple on the wire"*: capture the tuple beside
   `_extract_board` at `solve.py:615` (zero extra solve time), carry it on `GenerationResult` behind a
   `formatVersion` bump, then use it to fix `deriveCleanLabel`'s upper-bound read and to add the
   missing checkpoint-monotonicity assertion. It is a prerequisite for any later dominance work
   regardless, and unlike dominance it has a consumer today.
3. **Re-open dominance only if multi-policy comparison ships.** At that point the substrate exists and
   the relation itself is ~40 lines.

A note for S-309 either way: after greedy is deleted, **`countInteriorHoles` (`board-shape.ts:19`) is
the only non-test runtime consumer of `objective.ts`'s 360 lines.** `scoreCandidate` and
`compareObjectives` reach zero callers. Dominance is the only thing on the table that would give
`scoreCandidate` a production caller — and if dominance splits out, S-309's honest move is to delete
them and keep the counters as product code.

### 8. Corrections the record needs

Doc drift is the highest-frequency finding in this slice family
(`stop-and-keep/research.md:294`), and this research found seven live instances:

1. **`roadmap.md:234`** — the S-307 Risk note. `SolveConfig` *does* have the hard/soft field
   (`clean_mode`); `_run_ladder` *is* order-parameterized; line numbers drifted.
2. **`roadmap.md:233`** — the dominance Unknown. The `remaining`/`analyzePlan` claim is false; "five
   files" is 11.
3. **`prd.md:338-341`** and **`contracts/README.md:73`** — "a true tuple needs an `evaluate_board`
   re-solve" is false from tier 2 on.
4. **`prd.md:708-711`** — *"Tier order and hard/soft split are request-level configuration, not hidden
   constants"* is currently false as written; S-307 is what makes it true.
5. **`prd.md:318-320`** — FR-302's `softHits ≡ 0` should read `softHits == floor`, per what S-301
   actually shipped.
6. **`20260810200122_generation_jobs.sql:14-17`** — claims the five jsonb columns' shapes "are owned by
   the frozen wire contract". Not true for `policy` today; S-307 either makes it true or corrects it.
7. **GitHub issue [#104](https://github.com/dobrek/ib-timetable-planner/issues/104)** still carries the
   text the roadmap already retracted — *"Small, additive launch-surface work — policy is already
   request-level configuration in the engine"* — with `Unknowns: —`. Also `roadmap.md:290` still says
   *"Promotes to ready once S-301 done"*; S-301 was archived 2026-08-13, so the slice is **unblocked**.

Plus the in-code docs S-307 itself invalidates: `GenerateButton.tsx:9-13` ("zero-config", "one
click"), `generation-job.ts:168-170`, `runner.py:253-260`, `test_service.py:509-512`, and README's
hosted-campaign section.

**Correction, 2026-09-02 (plan-review F1, resolved in Phase 2 §3).** C5 above read `stage_index` as
the ladder *position*; it was in fact written as the **tier** (`runner.py:341-347`, "TIER numbers …
never positions", and the four readers printed it verbatim). Under a permuted ladder that would have
made the hub count 1, 2, 6, 3, 4 … — the counter running backwards — and C5's "stage 4 of 10 ·
teacher holes will name a different tier" sentence was that positional misreading. The runner now
writes `stage_index` / `checkpoint_stage_index` from `StageEvent.position`; tier identity stays in
`stages[].tier`, where the clean label reads it. Canonical rows are byte-identical (position equals
tier), and the four readers survive unchanged.

### 9. Recommended scope for S-307

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| 1 | `SolveConfig.ladder` + call-site override + permutation validation | ~30–50 LOC + test module | §2; parity gate untouched by construction |
| 2 | Expose `clean_mode` per request (`runner.py:260`) | ~5 LOC | canonical policy needs nothing else |
| 3 | `policy?` on `SolveRequest` + both canonicalizers + both contract suites | 6 files, one commit | additive-optional, **no bump**; decide the golden-fixture question |
| 4 | Zod input → audit column → dispatch, from one validated value | ~5 files | answers F-302's "two copies" objection on the record |
| 5 | Launch picker (Option B) + tests | 1 component + test | reuses `AlertDialog` / `ToggleGroup`; keep `aria-label="Generate plan"` |
| 6 | Seed the choice from the previous job's `policy` | ~5 LOC + projection field | no sixth persistence clone |
| 7 | `clean-label.ts` takes the policy as input | small, **not optional** | C1 — otherwise the slice ships a false sentence |
| 8 | `--policy` / `--ladder` flag on `cli.py` | small | see below |
| 9 | Doc trueing (§8) | — | including issue #104 |

**Item 8 deserves its own note.** The hosted-solve campaign exists *"to test plan/policy variations
against real current data"* (`solver-deploy-lane/change.md:466-468`), but it **ships no policy
dimension** — today the only way to vary the policy is to edit `runner.py:260`. `cli.py:157-165` has
no clean flag and no tier-order flag, and `bench/` has **zero** matches for `polic(y|ies)`. So the
POC's own three-board frontier is **not reproducible with today's tooling**, and without item 8 S-307
ships a picker that nobody can validate and completes a campaign that still cannot do the thing it was
built for.

**Explicitly out of scope:** dominance (§7.5); author-configurable policy presets (already **parked**);
multi-policy parallel runs (**parked**); subset ladders (permutations only, C5); a continuous dial
(C4); numeric quality claims in shipped copy (S-308 owns values).

**Size verdict:** with dominance split out, comparable to S-305 — a few days. With dominance in, it
roughly doubles and gains a surface with no producer, no consumer, and a documented architectural
objection.

## Code References

- `services/solver/src/cpsat_engine/solve.py:121-144` — `SolveConfig`, incl. `clean_mode:136`, `targets:142`, `hooks:144`
- `services/solver/src/cpsat_engine/solve.py:150` — `_LADDER_TIER_INDICES`; `:452` — `solve_repair`'s sparse `(0, 3)`
- `services/solver/src/cpsat_engine/solve.py:543-635` — `_run_ladder`, order-agnostic; `:616` hardening `<=`
- `services/solver/src/cpsat_engine/solve.py:192-227` — `parity()` / `evaluate_board()`, config-blind
- `services/solver/src/cpsat_engine/solve.py:393-425` — `_feasibility`, clean mode as `soft_hits == floor`
- `services/solver/src/cpsat_engine/objective.py:54-71` — the canonical tier tuple; `:176-211` — `soft_hits_terms`
- `services/solver/src/cpsat_service/runner.py:253-272` — the single `SolveConfig` construction seam
- `contracts/generation-wire.schema.json:222-236` — `SolveRequest`, `additionalProperties: false`
- `contracts/README.md:137-155` — the `formatVersion` bump policy and the S-303 precedent
- `src/entities/timetable/model/generation/wire.ts:153-159` / `cpsat_engine/wire.py:125-131` — the two whitelists
- `supabase/migrations/20260812141459_solver_select_column_scope.sql:38-42` — `policy` in the "lost" list
- `src/_pages/plan-detail/api/generation-job.ts:56,163-171,218-220` — input schema, audit write, dispatch
- `src/_pages/plan-detail/ui/chrome/GenerateButton.tsx` — the whole current launch surface
- `src/_pages/plan-detail/model/use-cohort-board-state.ts:107-154` — the live disable-reason derivation
- `src/_pages/plan-detail/ui/StopAndKeep.tsx:28-48,127-141` — the S-305 dialog and its copy helpers
- `src/entities/timetable/model/generation/clean-label.ts:44-69` — the label that C1 breaks
- `src/entities/timetable/model/generation/tier-labels.ts:12-37` — `tierLabel`, `LADDER_TIER_COUNT`
- `src/_pages/plans-list/model/job-progress-store.ts:116-137` / `use-pending-proposal.ts:120-139` — the equality gates
- `src/_pages/plan-comparison/model/extremes.ts:25` — `MetricCell`, the type with no number
- `src/entities/timetable/model/generation/objective.ts:27-38,81-86,98-154` — the tuple, the lexicographic comparator, `scoreCandidate`
- `e2e/specs/generation.spec.ts:49` — the accessible name the picker must preserve

## Architecture Insights

- **Config-gating is the project's way of keeping an irreversible gate honest.** `parity()` and
  `evaluate_board()` take no config, so anything reachable only through a defaulted-off `SolveConfig`
  field is invisible to the 10/10 objective-parity gate. `clean_mode` and `targets` both used it;
  S-307's ladder field must too. Reordering `build_objective` instead of the ladder would violate it.
- **The frozen contract's real cost is bilateralism, not versioning.** Both canonicalizers are
  explicit whitelists, so any wire change is a four-file mirrored edit that must go green in both
  suites in one commit. The `formatVersion` bump — the part that *sounds* expensive — is not triggered
  by additive-optional changes.
- **Projections have silent-failure equality gates.** `sameIndicators` and `sameView` drop fields not
  named in them, so a field added to a projection but not to its gate never repaints. This is
  documented once (`use-pending-proposal.ts:120-123`) and is a standing trap for any slice that adds a
  displayed field.
- **Copy is treated as a tested contract in this codebase.** `StopAndKeep.test.tsx:6-8` — *"not 'there
  is a button' but 'the button says what stopping now would keep'"* — and every sentence has a test.
  A picker's option copy inherits that standard.
- **Affordances go where the data to explain them already lives.** S-305 put Stop & keep on the pending
  page rather than the hub for exactly that reason (`PendingProposalPage.tsx:30-33`). The launch
  picker's home follows from the same rule: the plan detail page, where the board and its deficits are.

## Historical Context (from prior changes)

- `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md:122-208` — the three-board
  frontier and the five findings that produced FR-302, including finding 1 (*"not a buried
  constant"*), finding 3 (the teacher/student trade-off), finding 5 (dominance) and finding 6
  (non-determinism).
- `context/archive/2026-07-12-generation-quality-tuning/research.md:523-529,781-783` — the forced
  choices behind the canonical order, and the one ordering claim (`softHits` vs `studentHoles`) that
  was never forced-choice-tested.
- `context/archive/2026-08-11-solver-service-transport/research.md:503-506` — the rejection of
  `policy?` on the envelope; `change.md:57-60` — the flag that S-307 is under-scoped.
- `context/archive/2026-08-12-first-verified-proposal/plan.md:73,357` — S-301 deferring the picker and
  the policy vocabulary here; `research.md:210-213,437-440` — clean mode is a hard constraint, not a
  reorder, and the config-gating discipline.
- `context/archive/2026-08-19-staged-progress-and-checkpoints/research.md:151-158` — S-303 hitting the
  same carrier problem and settling for env; `change.md:30-34` — *"does not pay for an unvalidated
  framework"*.
- `context/archive/2026-08-25-drift-decided-delivery/frame.md:47,95,101` — dominance routed here by
  explicit author decision.
- `context/archive/2026-09-01-stop-and-keep/plan.md:109-110` — no measured number in shipped copy.
- `context/archive/2026-08-15-solver-deploy-lane/change.md:466-468,488` — the campaign's purpose and
  its evidentiary charter (quality conclusions usable, timing conclusions invalid).

## Related Research

- `context/changes/post-poc-cp-sat-refactoring-plan/` — the umbrella change for this roadmap.
- `context/archive/2026-08-25-drift-decided-delivery/research.md:246-283` — the dominance
  scope-ownership analysis this document extends.

## Open Questions

1. **Is S-307 genuinely a gate for S-309?** `roadmap.md:42` and `:255` list it as a prerequisite of greedy
   retirement, and `roadmap.md:234` asserts *"it must land before retirement (FR-302 is part of the
   proposal flow FR-314 gates on)"*. But FR-314's own precondition list (`prd.md:586-590`) names only
   clique-bound extraction, a pinned CP-SAT regression baseline, and hint-free Mode A — **not FR-302**. FR-302 is must-have so it must ship before the
   change closes, but nothing in deleting greedy depends on a policy picker. De-gating would let S-309
   proceed on calibration alone. — Owner: author.
2. **Does the golden fixture carry `policy`?** The README's own doctrine says optional keys should be
   exercised by a fixture (`:163-168`); doing so retires the "only optional key" sentence and forces a
   cheap regeneration. Doing it the other way leaves the omit-when-absent rule ungated for the new
   field. — Owner: plan phase.
3. **Two policies or three?** Canonical is free (`clean_mode=False`); student-first costs the ladder
   plumbing and runs against the expert's elicited preference. Shipping a three-way picker where only
   two options have ever been validated is the *"build the slot, ship one occupant"* hazard S-303
   recorded (`staged-progress-and-checkpoints/change.md:30-34`). — Owner: author.
4. **How is "this policy produced a different board" acceptance-tested?** At 8 workers, same-policy
   variance is comparable to between-policy variance (§1). Options: assert at `workers=1`; assert on
   the *stage transcript order* rather than the board (cheap, deterministic, and directly tests the
   mechanism); or multiple runs per arm on the hosted campaign. The transcript assertion looks like
   the right unit-level answer. — Owner: plan phase.
5. **Does the service echo the effective policy back into the row?** Without it, the audit column and
   the wire can silently disagree, since `snapshot_hash` binds only the snapshot. — Owner: plan phase.
