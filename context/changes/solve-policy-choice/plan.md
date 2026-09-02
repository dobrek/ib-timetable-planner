# Solve-policy choice (S-307) Implementation Plan

## Overview

Let the author choose the solve policy when launching a CP-SAT job. Clean mode stays the shipped
default; the canonical lexicographic order and the student-first trade-off become selectable. The
choice rides `SolveRequest` as an additive-optional `policy` (no `formatVersion` bump), is written
to the `generation_jobs.policy` audit column from the same validated value, becomes real engine
configuration (`SolveConfig.ladder` + `clean_mode` per request), is exposed on the file-transport
CLI so the POC frontier is reproducible outside the service, and replaces the one-click Generate with a confirm dialog
whose copy states consequences rather than verdicts. The `clean-label` sentence that would otherwise
start lying ("No clean board was possible") learns whether clean was requested.

Dominance-checking is **split out** of this slice by author decision (2026-09-02): it has no
producer (one job, one board) and no consumer (the comparison page refuses to judge, type- and
test-enforced). A follow-up slice — the true objective tuple on the wire — is recorded in the
roadmap entry instead.

Roadmap: `context/foundation/roadmap.md` § S-307. PRD: FR-302. Research:
`context/changes/solve-policy-choice/research.md` (all `file:line` references below are at
`240d640`, the same commit the research was written at).

## Current State Analysis

**Engine (Python, `services/solver/src/cpsat_engine/`).**

- The tier tuple is canonical and positional (`objective.py:59-70`). `_run_ladder` takes
  `tier_indices` and makes **no ordering assumption** — position and identity are kept separate
  (`solve.py:571-586`), the clique cut fires on identity (`idx == 2`), targets are keyed by tier
  number, hardening is order-agnostic. `solve_repair` already passes a sparse, reordered `(0, 3)`
  (`solve.py:452`).
- `SolveConfig` (`solve.py:122-144`) carries `clean_mode` (the hard/soft split, defaulted off) and
  `targets`, both deliberately invisible to the config-blind `parity()` / `evaluate_board()` gate.
  It has **no ladder-order field**; `solve_staged` (`:240`) and `solve_complete` (`:358`) both pass
  the module constant `_LADDER_TIER_INDICES = tuple(range(1, 10))`.
- Clean mode is `soft_hits == floor` at the feasibility stage (`solve.py:417-419`), with an
  automatic fallback to unconstrained when infeasible (`:309`, `notes["clean_fallback"]`).
- `runner.py:257-272` is the single `SolveConfig` construction seam and hardcodes `clean_mode=True`.
- `_progress_payload` (`runner.py:338-352`) writes `stage_index` / `checkpoint_stage_index` as the
  **tier** number (`event.tier`), although `StageEvent` also carries `position` / `total` — "the human
  count ('stage 4 of 10')" (`solve.py:71-74`). The four "stage N of 10" readers
  (`plan-indicators.ts:196`, `PendingProposalPage.tsx:168`, `GenerationStatusStrip.tsx:189`,
  `StopAndKeep.tsx:137`) print `stage_index` verbatim, so tier and position coincide today only
  because the ladder is canonical.
- `cli.py:157-165` has no policy flag; `SolveConfig()`'s default makes the CLI's effective policy
  **canonical** (clean off, canonical ladder) — the opposite of the service's default.

**Contract (`contracts/`).**

- `SolveRequest` is `{formatVersion, snapshot, warmStart?}` with `additionalProperties: false`
  (`generation-wire.schema.json:222-236`); the service validates the raw body and 422s unknown keys
  (`app.py:286-294`).
- Both canonicalizers are explicit whitelists — `toWireSolveRequest` (`wire.ts:153-159`) and
  `canonical_solve_request_json` (`wire.py:125-131`). A field added to the type alone is silently
  dropped.
- Additive-optional changes do not bump `formatVersion` (`README.md:144-145`; S-303's `stoppedBy`
  is the precedent). The fixture doctrine says optional keys are exercised by a golden
  (`README.md:163-168`), and the solve-request golden is derived from the other two, CP-SAT-free
  (`bench/generate-contract-goldens.experiment.ts:61-81`).
- `snapshot_hash` digests the snapshot only (`wire.ts:105-108`), so an envelope field does not touch
  drift semantics.

**App (TypeScript).**

- Dispatch chain: `GenerateButton.tsx:48` → `use-generation-job.ts:87-102` (`launch()`) →
  `generation-client.ts:8-14` → `generation-actions.ts:21-24` → `generation-job.ts:56`
  (`startGenerationInput = z.object({ planId })`) → `:163-171` (`policy: { clean: true }` literal)
  → `:218-220` (`dispatchSolveJob(jobId, { formatVersion: 1, snapshot })`).
- `generation_jobs.policy` is `jsonb not null` and exists since the first migration; no migration is
  needed. Rows today carry legacy shapes: `{ clean: true }` from the app, `{ mode: … }` /
  `{ budgetMs, mode }` from integration fixtures.
- `checkPlan` returns the plan's latest job on **both** roles (`generation-delivery.ts:173-186`),
  and the plan-detail route seeds `initialJob` from it — so the picker can seed from the previous
  job's policy with no new query.
- `deriveCleanLabel` / `describeCleanLabel` (`clean-label.ts:44-69`): the `not-clean` branch ends
  with *"No clean board was possible for this catalog."* — true only while every run is clean-mode.
- `use-pending-proposal.ts:124-139` `sameView` / `sameCleanLabel` are equality gates that silently
  drop fields they do not name.
- Launch surface: one ghost button, `aria-label="Generate plan"`, disable reasons on `title` only
  (`GenerateButton.tsx:33-53`); e2e selects it by that name (`e2e/specs/generation.spec.ts:49`).
- Gating inputs are live: `disabledReason` ranks `generating > violations > complete`, then `busy`
  (`use-cohort-board-state.ts:129-136`).
- Primitives already in `src/shared/ui/`: `AlertDialog*`, `ToggleGroup` (`type="single"` →
  `radiogroup`/`radio`, per `ui-conventions.md:98`), `FormDescription`-style explanation
  (`ClonePlanDialog.tsx:115` precedent for consequence copy). `StopAndKeep.tsx` is the S-305 dialog
  idiom (`AlertDialog` for a deliberate act, live copy off the polled snapshot, injectable action).

## Desired End State

- An author clicking **Generate** sees a confirm dialog with a three-way choice — clean (pre-selected
  from the plan's previous job, else the default), canonical order, student-first — each with one
  consequence sentence; confirming dispatches the job under that policy. The dialog re-checks the
  live disable reasons at confirm and shows them as text (fixing the screen-reader gap in passing).
- `generation_jobs.policy` holds `{ "preset": "<clean|canonical|student-first>" }`, and the
  `SolveRequest` body carries the identical object — both written from one Zod-validated value.
- The solver runs the requested policy: `clean_mode` and the ladder visit order come from the
  request; the stage transcript on the row (`stage_index` / `stage_name` / `stages`) follows the
  policy's tier order — `stage_index` counting ladder **positions**, never tiers — so "stage 3 of
  10 · student holes" is what the hub shows under student-first and the counter never runs backwards.
- `cpsat --policy student-first …` reproduces the POC frontier from the file transport; the sidecar
  echoes the policy.
- The delivered proposal's provenance line names the policy, and a not-clean board under a
  non-clean policy says the policy did not require cleanliness rather than that none was possible.
- `formatVersion` is still `1`; both contract suites are green on a regenerated
  `solve-request.json` that carries `policy`; the 10/10 objective-parity gate is untouched.

**Verification:** `pnpm check`, `pnpm test`, `pnpm test:integration` (with a tier-1 solver up),
`mise run solver:test`, `mise run solver:check`, `pnpm test:e2e e2e/specs/generation.spec.ts`,
`pnpm steiger`, `pnpm build`; then a manual tier-1 launch under each policy.

### Key Discoveries:

- `_run_ladder` is already order-parameterized (`solve.py:543-551`); only the two call sites and
  `SolveConfig` need a field. Canonical order needs **zero** new engine code (`clean_mode=False`,
  tested at `test_solve.py:211-217`).
- Constraining policies to **permutations** of the nine ladder tiers keeps `_FULL_LADDER_STAGES`
  and the app's `LADDER_TIER_COUNT = 10` (`tier-labels.ts:23`) constant. The readers' **numerator**
  is `stage_index`, which the runner writes as the tier today; Phase 2 §3 switches it to the ladder
  **position** (`StageEvent.position`), so every "stage N of 10" reader survives unchanged and the
  counter stays monotonic under a permuted ladder (plan-review F1).
- The insulation discipline: permute the ladder's **visit order** only; never reorder
  `build_objective`'s tuple, which would break the parity gate at `solve.py:208` and every
  positional index.
- The service 422s unknown envelope keys, so the schema must widen **before** the service or the
  app can send `policy` — contract first.
- The CLI's effective default is canonical today; `--policy` must default to `canonical` to keep
  the CLI and the goldens' recorded recipe byte-for-byte.
- The POC defines student-first as *holes → student → slots → teacher* with `softHits` hard
  (`results.md:165-169`); tiers the POC does not name keep canonical relative order.
- A `name` sub-key on the wire is refused by `contract-parity.test.ts:127`'s display-text grep;
  `preset` is safe.

## What We're NOT Doing

- **Dominance** — split out by author decision. No Pareto comparator, no objective tuple on the
  wire, no comparison-page override. A follow-up slice ("true objective tuple on the wire") is
  recorded in the roadmap S-307 entry (Phase 5), which also fixes `deriveCleanLabel`'s upper-bound
  read and adds checkpoint monotonicity — both out of scope here.
- **Broad doc trueing** (PRD FR-302 `softHits ≡ 0`, `prd.md:338-341`, the migration header
  comment, GitHub issue #104's stale body) and **de-gating S-309** — not selected by the author.
  Only in-code docstrings the diff itself invalidates and the roadmap entry's Outcome/Unknowns are
  touched.
- **Service echoing the effective policy back onto the row** — not selected; both copies are
  written from one validated value at one call site instead.
- Subset ladders, a continuous "dial", author-configurable presets, multi-policy parallel runs (all
  parked or rejected by research C4/C5).
- Any numeric quality claim in shipped copy (S-308 owns values). Copy stays qualitative and never
  ranks the options.
- Showing the policy on the plans-list hub or the pending page; one surface only — the delivered
  proposal's provenance line.
- Widening the solver's column-scoped SELECT/UPDATE grants; no migration of any kind.
- Any change to `solve_repair`, `parity()`, `evaluate_board()`, `build_objective`, or the
  objective-parity goldens.

## Implementation Approach

Contract-first, then the two peers, then the UI — the same shape S-303 used, because the service
rejects unknown keys and the goldens are bilateral. Each phase is independently green:

1. Widen the contract (schema + both canonicalizers + TS vocabulary + regenerated golden), one
   commit, both suites green. The service still ignores the field; the app does not send it yet.
2. Teach the engine and service to honour it (`policy.py` presets → `SolveConfig`), and expose it
   on the CLI. The runner defaults to clean when the key is absent, so behaviour is unchanged until
   the app sends a policy.
3. Thread one validated value through the app: Zod input → audit row → wire → view → clean label.
   Callers that omit `policy` get the default, so existing tests keep passing.
4. Ship the dialog, the seeding, the provenance noun, and the e2e confirm step.
5. True up the in-code docs the diff invalidates and record the dominance split.

## Critical Implementation Details

**Insulation of the parity gate.** `SolveConfig.ladder` is read by `solve_staged` and
`solve_complete` alone, defaulted `None` (= canonical), and documented with the same insulation
note `clean_mode` and `targets` carry. `parity()` / `evaluate_board()` take no config, so the
10/10 gate cannot see it by construction — keep it that way.

**Permutation, validated at construction.** `SolveConfig.__post_init__` rejects a `ladder` that is
not a permutation of `(1, …, 9)` with a `ValueError` naming the offending sequence. That keeps
`_FULL_LADDER_STAGES == 10` invariant. Note `_LADDER_TIER_INDICES` is currently defined *after*
`SolveConfig` (`solve.py:150`); move it above the class.

**Contract before peers.** Phase 1 must land before the runner reads `policy` or the app sends it —
`app.py:286-294` 422s any key the schema does not declare.

**The stage counter is the position, not the tier.** `_progress_payload` writes `stage_index` and
`checkpoint_stage_index` from `StageEvent.position`, and `_stop_error` names the position too
("`checkpoint_stage_index` and this sentence must tell the same story"). Tier identity stays where
identity is read — `stages[].tier`, which `softHitsAchieved` / `deriveCleanLabel` key on. Under the
canonical ladder position equals tier, so today's rows, tests and goldens are byte-identical.

**Legacy audit shapes on read.** `parseStoredPolicy` maps any shape without a recognised `preset`
to `{ preset: "clean" }` — every real row to date was solved in clean mode, so that is the honest
reading, and it keeps test fixtures that write `{ mode: … }` valid.

**Equality gates.** `sameCleanLabel` must compare the new `cleanRequested` flag; `sameView` names
`policy` (immutable per row, so omission would be harmless today, but the documented rule at
`use-pending-proposal.ts:120-123` is "name it in the same commit").

**CLI default is canonical, not clean.** `--policy` defaults to `canonical` so the CLI's output is
byte-for-byte what it is today; the service's default remains clean. Both defaults are stated in
the respective docstrings.

**Copy discipline.** Every option description states a consequence of choosing it, never a
comparison, a ranking, or a number. The three-board frontier is one catalog, one run; same-policy
variance is comparable to between-policy variance (research §1).

---

## Phase 1: Contract — `policy` joins `SolveRequest`

### Overview

Add the optional `policy` object to the envelope on both sides of the wire, regenerate the
solve-request golden so the fixture doctrine holds, and gate it in both suites. `formatVersion`
stays `1`. After this phase the service accepts the key and ignores it; nothing sends it yet.

### Changes Required:

#### 1. Schema

**File**: `contracts/generation-wire.schema.json`

**Intent**: Declare the new optional property on `SolveRequest` so the service's boundary validator
accepts it and rejects malformed values with a legible error path.

**Contract**: `SolveRequest.properties.policy` — `type: object`, `additionalProperties: false`,
`required: ["preset"]`, `properties.preset.enum: ["clean", "canonical", "student-first"]`, with a
description stating the semantics of each preset in one line and that the key is omitted (never
null) when the caller wants the service default (`clean`). `SolveRequest.required` is unchanged.
No other `$defs` change.

#### 2. TypeScript vocabulary

**File**: `src/entities/timetable/model/generation/policy.ts` (new) + `policy.test.ts`; barrel
`src/entities/timetable/index.ts`

**Intent**: One module owns the preset list, the Zod schema shared by the action input and the
form, the default, the tolerant parser for the audit column, and the author-facing noun for each
preset. Lives in `entities` because both `_pages/plan-detail/api` (write side) and
`clean-label.ts` (read side) need it.

**Contract**:
- `SOLVE_POLICY_PRESETS = ["clean", "canonical", "student-first"] as const`;
  `type SolvePolicyPreset`.
- `solvePolicySchema = z.strictObject({ preset: z.enum(SOLVE_POLICY_PRESETS) })`;
  `type SolvePolicy = z.infer<…>`; `DEFAULT_SOLVE_POLICY: SolvePolicy = { preset: "clean" }`.
- `parseStoredPolicy(value: unknown): SolvePolicy` — the schema on success, `DEFAULT_SOLVE_POLICY`
  otherwise (legacy `{ clean: true }` and test shapes read as clean; documented).
- `policyLabel(preset): string` — `clean` → "clean", `canonical` → "canonical order",
  `student-first` → "student-first". Nouns only; consequence sentences live in the dialog.
- Tests: each legacy shape parses to clean; an unknown preset is rejected by the schema; labels are
  total over the enum.

#### 3. TypeScript wire

**File**: `src/entities/timetable/model/generation/wire.ts`

**Intent**: Carry `policy` on the envelope type and through the whitelist projection, omitted when
absent.

**Contract**: `SolveRequest.policy?: SolvePolicy`; `toWireSolveRequest` spreads
`{ policy: { preset } }` when defined, nothing when `undefined` — the same omit-when-absent shape
as `warmStart`. `canonicalStringify` sorts keys, so no ordering concern.

#### 4. Python wire

**File**: `services/solver/src/cpsat_engine/wire.py`

**Intent**: Mirror the projection: pass `policy` through when the key is present.

**Contract**: `canonical_solve_request_json` copies `request["policy"]` (a dict) onto the wire
object when present; docstring extended past "`warmStart` is omitted when absent" to cover both
optional keys.

#### 5. Golden regeneration

**Files**: `bench/generate-contract-goldens.experiment.ts`, `contracts/fixtures/solve-request.json`

**Intent**: Exercise the new optional key in the fixture, per `contracts/README.md:163-168`.

**Contract**: The experiment adds `policy: { preset: "clean" }` to the solve-request it derives.
Regenerate with the committed result as input so no CP-SAT run is needed:

```bash
RESULT=contracts/fixtures/generation-result.json pnpm experiment:goldens
```

`generator-snapshot.json` and `generation-result.json` must come out byte-identical (they
round-trip; assert with `git diff --stat contracts/fixtures`). Only `solve-request.json` changes.

#### 6. Both contract suites

**Files**: `bench/contract-parity.test.ts`, `services/solver/tests/test_contract.py`

**Intent**: Gate the widening bilaterally in the same commit.

**Contract**: On each side — the solve-request golden validates and round-trips to identical bytes
(existing tests, now over the new bytes); a new test asserts the golden carries `policy` (the
sibling of `…exercises_the_optional_warm_start`); a new test asserts the canonicalizer **omits**
`policy` when the input has none; a schema test asserts a preset outside the enum fails
validation at path `policy/preset`. `test_service.py`'s 422 pin (`:373-384`) gains a case for an
unknown preset.

#### 7. Contract README

**File**: `contracts/README.md`

**Intent**: The normative doc records the change the way it recorded S-303's.

**Contract**: Under *Versioning*, a dated "2026-09 (S-307)" paragraph: `SolveRequest` gained the
optional `policy` object — additive, `formatVersion` stays `1`, the solve-request golden **was**
regenerated (unlike S-303) because the fixture doctrine exercises optional keys. Under *Fixtures*,
retire "that is the envelope's only optional key" in favour of naming both.

### Success Criteria:

#### Automated Verification:

- `pnpm test bench/contract-parity.test.ts` green, including the new policy tests
- `mise run solver:test` green, including `test_contract.py`'s new policy tests and the 422 pin
- `git diff --stat contracts/fixtures` shows only `solve-request.json` changed
- `pnpm check` reports 0 errors; `pnpm lint`, `pnpm steiger` clean
- `mise run solver:check` clean (ruff + mypy --strict)

#### Manual Verification:

- `contracts/README.md` versioning paragraph reads correctly against the diff (no bump, golden
  regenerated, both optional keys named)

**Implementation Note**: This phase is one bilateral commit. After automated verification passes,
pause for confirmation before Phase 2.

---

## Phase 2: Engine + service + CLI — presets become configuration

### Overview

Make the policy real: a preset resolves to `(clean_mode, ladder)`, the ladder order flows through
`SolveConfig` into the two staged call sites, the runner reads the request's policy (defaulting to
clean), and the CLI exposes the same vocabulary so the POC frontier is reproducible from the file transport. The parity gate
is untouched by construction.

### Changes Required:

#### 1. Policy presets

**File**: `services/solver/src/cpsat_engine/policy.py` (new); tests
`services/solver/tests/test_policy.py` (new)

**Intent**: One module owns the preset → configuration mapping, shared by the runner and the CLI,
so the two transports cannot drift.

**Contract**:
- `@dataclass(frozen=True) class Policy: preset: str; clean_mode: bool; ladder: tuple[int, ...]`
- `PRESETS: Final[Mapping[str, Policy]]` with 0-based tier indices into `objective.tiers`:
  - `clean` — `clean_mode=True`, ladder `(1, 2, 3, 4, 5, 6, 7, 8, 9)`
  - `canonical` — `clean_mode=False`, ladder `(1, 2, 3, 4, 5, 6, 7, 8, 9)`
  - `student-first` — `clean_mode=True`, ladder `(1, 5, 2, 3, 4, 6, 7, 8, 9)` — holes → student
    holes → total slots → teacher holes → soft hits → doubles → late starts → Friday tail → golden
    band. The POC names only the first four; the rest keep canonical relative order.
- `DEFAULT_PRESET = "clean"` (the service default; FR-302).
- `resolve_policy(request: Mapping[str, Any]) -> Policy` — `PRESETS[request["policy"]["preset"]]`
  when present, `PRESETS[DEFAULT_PRESET]` otherwise. An unknown preset raises `ValueError` (the
  schema validator already 422s it at the boundary; this is defence in depth).
- Tests: every preset's ladder is a permutation of `range(1, 10)`; the preset names equal the
  schema's enum (read `contracts/generation-wire.schema.json` — the two lists must not drift);
  `resolve_policy` defaults to clean on an absent key.

#### 2. `SolveConfig.ladder`

**File**: `services/solver/src/cpsat_engine/solve.py`

**Intent**: Carry the ladder visit order as configuration, honoured only by the two staged
solvers, validated as a permutation, insulated from the parity gate.

**Contract**:
- Move `_LADDER_TIER_INDICES` / `_FULL_LADDER_STAGES` above `SolveConfig`.
- `ladder: tuple[int, ...] | None = None` with the insulation docstring (same paragraph shape as
  `clean_mode` / `targets`), plus `__post_init__` raising `ValueError` unless `ladder is None` or
  `sorted(ladder) == list(_LADDER_TIER_INDICES)`.
- `solve_staged` (`:240`) and `solve_complete` (`:358`) pass `config.ladder or _LADDER_TIER_INDICES`
  to `_run_ladder`. `solve_repair` is untouched (it builds its own config and passes `(0, 3)`).
- No change to `_run_ladder`, `parity`, `evaluate_board`, `build_objective`, or `_feasibility`.

#### 3. Runner reads the request policy

**File**: `services/solver/src/cpsat_service/runner.py`

**Intent**: The single `SolveConfig` seam takes `clean_mode` and `ladder` from the request instead
of hardcoding clean.

**Contract**: `_solve_and_write` receives the raw request (or the resolved `Policy`) alongside
`dump`; `SolveConfig(clean_mode=policy.clean_mode, ladder=policy.ladder, …)`. The "job %s solving
with %d workers" log line names the preset. The comment at `:257-260` is rewritten (it currently
says there is nowhere on the wire for a policy).

`_progress_payload` (`:338-352`) writes `stage_index` and `checkpoint_stage_index` from
`event.position` instead of `event.tier`, and its docstring ("TIER numbers … never positions") is
rewritten to say the opposite: the columns are ladder positions — the human count the four
"stage N of 10" readers print. `_stop_error` (`:372-390`) says
`after stage {len(result.stages)} ({last.name})` so the sentence and `checkpoint_stage_index` keep
telling the same story. Canonical output is byte-identical (position equals tier).

#### 4. CLI flag

**File**: `services/solver/src/cpsat_engine/cli.py`; tests `services/solver/tests/test_cli.py`
(new)

**Intent**: The file transport gains the same vocabulary, so the POC frontier is reproducible without
a service. (The hosted campaign varies policy through the app's dialog, not this flag — it dispatches
through the service.)

**Contract**: `--policy` with `choices=sorted(PRESETS)`, **default `canonical`** — today's CLI
behaviour byte-for-byte (`SolveConfig()` defaults to clean off). `_config` sets `clean_mode` and
`ladder` from the preset; `_config_echo` adds `"policy"`. Help text states that the service's
default differs (clean). Test: run `main` on a micro dump written with the test `builders` to
`tmp_path`, `--mode complete --policy student-first`; assert the sidecar echoes the policy and the
stage names follow the student-first order.

#### 5. Engine tests

**File**: `services/solver/tests/test_solve.py`

**Intent**: Pin the mechanism on the transcript, not the board — at 8 workers same-policy variance
rivals between-policy variance, so the board is not evidence (research OQ4).

**Contract**:
- `solve_complete` under `ladder=(1, 5, 2, 3, 4, 6, 7, 8, 9)` on a micro snapshot reports stage
  names `["completeness", "holes", "studentHoles", "totalSlots", "teacherHoles", "softHits", …]`
  with `position` sequential `1..10` and `tier` following the ladder (+1).
- A non-permutation (`(1, 2, 3)`, a duplicate, an out-of-range index) raises `ValueError` at
  `SolveConfig(...)` construction.
- `SolveConfig().ladder is None` and the default transcript order is unchanged (the existing
  `test_full_ladder_is_monotonic_and_complete` keeps asserting ten stages).
- `solve_repair` with a permuted `ladder` still reports its two stages `(unplacedTotal,
  teacherHoles)` — the field does not leak into repair.

#### 6. Service tests

**File**: `services/solver/tests/test_service.py`

**Intent**: The wrapper-level proof that the wire policy becomes the solve's configuration.

**Contract**: `test_every_solve_requests_clean_mode` (`:509-523`) becomes a parametrised
`test_the_request_policy_becomes_the_solve_config` over the three presets plus the absent key,
recording `(config.clean_mode, config.ladder)` and asserting them against `PRESETS`. The stage
order pin (`:541-543`) keeps its `range(1, 11)` assertion — `_micro_request` sends no policy, so
position equals tier — but its message "TIER numbers, in order" becomes "ladder positions, in
order". Its sibling under `student-first` asserts the starts' `stage_index` is still `1..10` while
`stage_name` for the second and third starts are `holes`, `studentHoles`, and that each
completion's `checkpoint_stage_index` equals its position — the pin that the counter never runs
backwards.

### Success Criteria:

#### Automated Verification:

- `mise run solver:test` green — `test_policy.py`, `test_cli.py`, the new `test_solve.py` and
  `test_service.py` cases included
- `test_objective.py` unchanged and green — the parity suite stays exact 10/10
- `mise run solver:check` clean (ruff, mypy --strict over `src/` and `tests/`, shellcheck)
- `pnpm test:integration src/test/solver-transport.integration.test.ts` green with a tier-1 solver
  up (no policy sent yet; proves the default path is unchanged)

#### Manual Verification:

- `uv run cpsat --input <dump> --output /tmp/x.json --mode complete --policy student-first`
  prints stages in student-first order and the sidecar's `config.policy` reads `student-first`

**Implementation Note**: Pause for confirmation before Phase 3.

---

## Phase 3: App — one validated value, three destinations

### Overview

The author's choice enters through the Zod input once and is written to the audit row and the wire
from the same object — the answer, on the record, to F-302's "two copies that can disagree"
objection. The view learns the policy, and the clean label learns whether clean was requested.

### Changes Required:

#### 1. Input, audit write, dispatch

**File**: `src/_pages/plan-detail/api/generation-job.ts`

**Intent**: Validate once, write twice from the same value.

**Contract**: `startGenerationInput = z.object({ planId: z.uuid(), policy:
solvePolicySchema.default(DEFAULT_SOLVE_POLICY) })` — a default keeps every existing caller
valid. `insertJob` writes `policy: input.policy`; `dispatch` sends
`{ formatVersion: 1, snapshot, policy: input.policy }`. The comment at `:168-170` ("S-307 owns what
goes here") is replaced by one stating the invariant: row and wire are written from this one
validated object, and nothing else may write either.

#### 2. Client

**File**: `src/_pages/plan-detail/api/generation-client.ts`

**Intent**: The client wrapper takes the policy.

**Contract**: `startGeneration(planId, policy: SolvePolicy)`.

#### 3. View gains `policy`; delivery passes it to the label

**File**: `src/_pages/plan-detail/api/generation-delivery.ts`

**Intent**: The view carries the job's policy for the picker seed and the provenance line; the
label derivation knows whether clean was requested.

**Contract**: `STATUS_COLUMNS` gains `policy`; `StatusRow.policy: unknown`, parsed by
`parseStoredPolicy` at the same place `stages` is parsed (`:478-479`). `GenerationJobView.policy:
SolvePolicy`. Both `deriveCleanLabel` call sites (`:358`, `labelOf` `:519`) pass the row's policy.
The `GenerationJobView` fixtures in six test files gain `policy: DEFAULT_SOLVE_POLICY` —
`StopAndKeep.test.tsx`, `PendingProposalPage.test.tsx`, `GenerateButton.test.tsx`,
`GenerationStatusStrip.test.tsx`, `use-cohort-board-state.test.tsx`, `use-pending-proposal.test.ts`
(11 literals) — a required view field fails `pnpm check` (3.3) until every literal carries it.

#### 4. Clean label learns the policy

**File**: `src/entities/timetable/model/generation/clean-label.ts` + `clean-label.test.ts`

**Intent**: Stop the `not-clean` sentence lying under a non-clean policy (research C1).

**Contract**: `deriveCleanLabel(stages, floor, policy: SolvePolicy)`; the `not-clean` variant gains
`cleanRequested: boolean` (`policy.preset !== "canonical"` — clean and student-first both request
it). `describeCleanLabel` on `not-clean`: when requested, today's sentence; when not, *"Not clean —
N hours sit on soft cells (M of them pinned). The canonical order policy does not require a clean
board."* (noun via `policyLabel`). Tests: both sentences; `clean` and `clean-at-floor` are
policy-independent.

#### 5. Equality gates

**File**: `src/_pages/plan-detail/model/generation/use-pending-proposal.ts`

**Intent**: Honour the documented rule.

**Contract**: `sameCleanLabel` compares `cleanRequested` on `not-clean`; `sameView` compares
`policy.preset`.

#### 6. Integration tests

**Files**: `src/_pages/plan-detail/api/generation-enqueue.integration.test.ts`,
`src/test/generation-proposal.integration.test.ts`

**Intent**: Prove the invariant end to end.

**Contract**: Enqueue — the row's `policy` equals `{ preset: "clean" }` by default (`:116`
updated), and with `policy: { preset: "student-first" }` both the row and the body the injected
transport received carry the identical object. Proposal chain (needs the solver) — launch under
`student-first` and assert the delivered row's `stages[1..2].name` are `holes`, `studentHoles`:
the only test that proves app → wire → engine agree on the policy.

### Success Criteria:

#### Automated Verification:

- `pnpm test` green — `clean-label.test.ts`, `policy.test.ts`, `use-pending-proposal.test.ts`,
  `generation-delivery`/`enqueue` unit paths
- `pnpm test:integration` green with a tier-1 solver up (`SOLVER_MAX_CONCURRENT_JOBS=2`), including
  the student-first chain assertion
- `pnpm check` 0 errors; `pnpm lint`, `pnpm steiger` clean

#### Manual Verification:

- In Supabase Studio, a job launched from the (still one-click) button shows
  `policy = {"preset":"clean"}` on its row

**Implementation Note**: Pause for confirmation before Phase 4.

---

## Phase 4: UI — the launch dialog and the vocabulary

### Overview

Replace the one-click Generate with an `AlertDialog` confirm carrying a three-way `ToggleGroup`,
one consequence sentence per option, live re-gating at confirm, seeded from the previous job's
policy. The delivered proposal's provenance line names the policy. The e2e generation spec learns
the confirm step. The trigger keeps `aria-label="Generate plan"`.

### Changes Required:

#### 1. Hook takes the policy

**File**: `src/_pages/plan-detail/model/generation/use-generation-job.ts`

**Intent**: `launch` carries the author's choice to the client.

**Contract**: `launch(policy: SolvePolicy)`; `start?: (planId, policy) => Promise<GenerationJob>`.
`GenerationControls` (`use-cohort-board-state.ts`) inherits the new signature with no other change.

#### 2. The dialog

**File**: `src/_pages/plan-detail/ui/chrome/GenerateButton.tsx` + `GenerateButton.test.tsx`

**Intent**: The deliberate-act idiom from `StopAndKeep`, applied to launch.

**Contract**:
- The existing ghost button becomes the `AlertDialogTrigger`, keeping `aria-label="Generate plan"`,
  its disabled reasons and its `title`s exactly as today (existing tests keep passing).
- `AlertDialogContent`: title ("Generate a proposal"); a description stating that the solve runs
  on the server for minutes and lands as a new proposal plan; a `ToggleGroup type="single"` with
  `aria-label="Solve policy"` and three items (`clean`, `canonical`, `student-first`) whose labels
  are `policyLabel(...)`; beneath it, the selected option's consequence sentence
  (`FormDescription`-style muted text, `ClonePlanDialog.tsx:115` idiom). Each sentence states a
  consequence — what the board will and will not do — never a comparison, ranking, or number.
  Radix emits `""` on re-press; ignore it (`WeekToggle.tsx` idiom).
- Confirm button (`AlertDialogAction`) labelled `Generate — <policyLabel>`; cancel closes.
- **Live re-gating**: the dialog receives `disabledReason` / `busy`; when either is non-null while
  open, the confirm is disabled and the reason is rendered as visible text with `role="status"`
  (the same strings the trigger's `title` uses). This is the screen-reader-perceivable reason the
  trigger never had.
- **Seeding**: on open, the selection initialises to `state.job.policy.preset` when
  `state.status === "tracking"`, else `DEFAULT_SOLVE_POLICY.preset`. Initialise on **open**, not
  on mount, so a job read back after a launch seeds the next open.
- Confirm calls `launch({ preset })` and closes; the trigger then shows "Starting…" as today.
- Tests (copy is a tested contract, `StopAndKeep.test.tsx:6-8`): the default is checked
  (`aria-checked`) when there is no previous job; the previous job's preset is checked when there
  is one; each option's sentence appears when selected; the confirm's name follows the selection;
  confirm calls `launch` with the chosen policy; a `disabledReason` arriving while open disables
  confirm and shows its text; the trigger's existing five states are unchanged.

#### 3. Provenance line

**File**: `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx` +
`GenerationStatusStrip.test.tsx`

**Intent**: The one surface that shows the policy afterwards (research C6).

**Contract**: `ProposalStrip`'s first span becomes *"Generated from <source> at <time> · <policyLabel>
policy"*. Test: the label appears for a non-default preset. The hub and the pending page are
untouched.

#### 4. E2E

**File**: `e2e/specs/generation.spec.ts`

**Intent**: The spec follows the new two-step launch.

**Contract**: After `generate.click()` (`:51`), locate the `alertdialog`, assert the `radio` named
"clean" has `aria-checked="true"`, click the button named `/^Generate — /`, then continue with the
existing strip assertions. No CSS or `data-*` selectors.

### Success Criteria:

#### Automated Verification:

- `pnpm test` green — `GenerateButton.test.tsx`, `GenerationStatusStrip.test.tsx`,
  `use-cohort-board-state`/hook tests
- `pnpm test:e2e e2e/specs/generation.spec.ts` green against a preview built with `SOLVER_URL` in
  `.dev.vars` and a tier-1 solver up
- `pnpm check` 0 errors; `pnpm lint`, `pnpm steiger`, `pnpm build` clean

#### Manual Verification:

- Tier-1 loop (`pnpm build && pnpm preview`, `mise run solver:dev`): Generate under
  `student-first`; the plans-list progress reads "stage 3 of 10 · student holes"; the delivered
  proposal's provenance line names the policy
- Generate again on the same source: the dialog opens with `student-first` pre-selected
- Open the dialog, then in another tab make the board complete (or add a blocking violation); the
  confirm disables and the reason is shown as text
- Keyboard-only: Tab to Generate, Enter, arrow keys move the selection, Enter confirms; VoiceOver
  reads the radiogroup and the disabled reason
- Semantic tokens only in the new markup (no palette utilities)

**Implementation Note**: Pause for confirmation before Phase 5.

---

## Phase 5: Close-out — in-code docs and the recorded decision

### Overview

True up the docstrings this diff falsifies and record the dominance split where the next reader
will look. No broad foundation-doc sweep (not selected).

### Changes Required:

#### 1. In-code docstrings the diff invalidates

**Files**: `services/solver/src/cpsat_service/runner.py` (module docstring "Every solve requests
CLEAN mode … nowhere to carry a policy"), `services/solver/tests/test_service.py` (the renamed
test's docstring), `src/_pages/plan-detail/api/generation-delivery.ts` (the `stageIndex` /
`checkpointStageIndex` doc comments, "The TIER …" → the ladder position), `src/_pages/plan-detail/ui/chrome/GenerateButton.tsx` (docblock: "zero-config",
"one click enqueues"), `src/_pages/plan-detail/model/generation/use-generation-job.ts` (hook
docblock, if it still describes a zero-config launch), `src/entities/timetable/model/generation/tier-labels.ts`
(`LADDER_TIER_COUNT` docstring: note that S-307 ships permutations, so the constant holds).

**Intent**: A doc that names a mechanism is coupled to it (lessons.md).

**Contract**: Each cited sentence is rewritten to describe the shipped state; `grep -rn "nowhere
to carry\|zero-config" services src` returns nothing stale.

#### 2. Roadmap S-307 entry

**File**: `context/foundation/roadmap.md` § S-307

**Intent**: Archiving with an Outcome that still promises dominance would be a false record.

**Contract**: Outcome drops the dominance clause. Unknowns replaces the dominance paragraph with a
dated note: split out 2026-09-02 (no producer, no consumer — research §7); the follow-up slice
"true objective tuple on the wire" (capture beside `_extract_board`, `formatVersion` bump, fixes
`deriveCleanLabel`'s upper-bound read and adds checkpoint monotonicity) is its successor. Risk
gets a one-line dated correction: the mechanism was smaller than priced (`_run_ladder` already
order-parameterized; `clean_mode` already the hard/soft field). Status → `done` at archive time.
The slice-table row (`roadmap.md:40`) drops "trade-off dial" for "student-first order" — the copy
discipline (C4) applies to the roadmap too. `research.md` §8 gains a dated correction of C5:
`stage_index` was written as the tier, not the position, so C5's "stage 4 of 10 · teacher holes"
sentence was the positional misreading Phase 2 §3 resolves (plan-review F1).

#### 3. Change notes

**File**: `context/changes/solve-policy-choice/change.md`

**Intent**: Record the decisions taken in planning for whoever archives it.

**Contract**: Notes list the six decisions (dominance split, three presets, cli flag in, doc
trueing out, AlertDialog + ToggleGroup, `{preset}` object, seed from previous job) and the
explicit exclusions.

### Success Criteria:

#### Automated Verification:

- `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build` green; `mise run solver:check` clean
- `/verify` (the full local CI mirror) green

#### Manual Verification:

- Roadmap S-307 entry reads correctly against the shipped diff; `change.md` notes are complete

---

## Testing Strategy

### Unit Tests (solver):

- `test_policy.py` — presets are permutations; names match the schema enum; default resolution.
- `test_solve.py` — transcript order under a permuted ladder; construction-time validation;
  default unchanged; repair unaffected.
- `test_service.py` — parametrised policy → `SolveConfig`; student-first stage-name pin with
  `stage_index` / `checkpoint_stage_index` as positions; 422 on an unknown preset.
- `test_cli.py` — `--policy` echo and transcript order on a micro dump.
- `test_contract.py` — golden carries `policy`; omission when absent; enum validation.

### Unit Tests (app):

- `policy.test.ts` — legacy shapes → clean; labels total.
- `clean-label.test.ts` — both `not-clean` sentences.
- `contract-parity.test.ts` — the TS half of the golden gate.
- `GenerateButton.test.tsx` — seeding, copy per option, confirm name, live gating, unchanged
  trigger states.
- `GenerationStatusStrip.test.tsx` — provenance names the policy.
- `use-pending-proposal.test.ts` — `sameCleanLabel` notices `cleanRequested`; `sameView` notices
  `policy.preset`.

### Integration Tests:

- Enqueue: row and dispatched body carry the identical policy object; default is clean.
- Proposal chain (solver up): a `student-first` launch delivers a transcript in student-first
  order — the single test that proves all three layers agree.
- Transport: unchanged, proves the no-policy path is byte-for-byte today's.

### Manual Testing Steps:

1. Tier-1 loop, Generate under each preset from the same source; watch the hub's stage names.
2. Re-open the dialog on the same source; the previous preset is pre-selected.
3. Provoke a disable reason while the dialog is open; confirm disables with visible text.
4. Keyboard and VoiceOver pass over the dialog.
5. `cpsat --policy student-first` on the seed dump; compare the transcript to the POC's
   `results.md` order.

## Performance Considerations

None. The wire grows by ~25 bytes; `STATUS_COLUMNS` gains one small jsonb scalar; no new queries.
The permutation validation is O(9) at config construction.

## Migration Notes

No schema migration. Existing `generation_jobs.policy` rows (`{ clean: true }`, test shapes) are
read as `clean` by `parseStoredPolicy`; nothing rewrites them. The CLI's default stays canonical;
the service's stays clean — no deployed behaviour changes until the app sends a non-default
policy.

## References

- Research: `context/changes/solve-policy-choice/research.md`
- Roadmap entry: `context/foundation/roadmap.md` § S-307; PRD FR-302
- POC frontier and policy definitions:
  `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md:122-176`
- Contract bump policy and S-303 precedent: `contracts/README.md:137-155`
- The dialog idiom: `src/_pages/plan-detail/ui/StopAndKeep.tsx`; consequence-copy idiom:
  `src/_pages/plans-list/ui/ClonePlanDialog.tsx:115`; ToggleGroup idiom:
  `src/_pages/plan-detail/ui/grid/slot-cell/WeekToggle.tsx`
- Prior plan of the same shape: `context/archive/2026-09-01-stop-and-keep/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contract — `policy` joins `SolveRequest`

#### Automated

- [x] 1.1 `pnpm test bench/contract-parity.test.ts` green, including the new policy tests — b3b8f57
- [x] 1.2 `mise run solver:test` green, including `test_contract.py`'s new policy tests and the 422 pin — b3b8f57
- [x] 1.3 `git diff --stat contracts/fixtures` shows only `solve-request.json` changed — b3b8f57
- [x] 1.4 `pnpm check` reports 0 errors; `pnpm lint`, `pnpm steiger` clean — b3b8f57
- [x] 1.5 `mise run solver:check` clean (ruff + mypy --strict) — b3b8f57

#### Manual

- [x] 1.6 `contracts/README.md` versioning paragraph reads correctly against the diff — b3b8f57

### Phase 2: Engine + service + CLI — presets become configuration

#### Automated

- [x] 2.1 `mise run solver:test` green — `test_policy.py`, `test_cli.py`, the new `test_solve.py` and `test_service.py` cases included — 8ebd639
- [x] 2.2 `test_objective.py` unchanged and green — the parity suite stays exact 10/10 — 8ebd639
- [x] 2.3 `mise run solver:check` clean (ruff, mypy --strict over `src/` and `tests/`, shellcheck) — 8ebd639
- [x] 2.4 `pnpm test:integration src/test/solver-transport.integration.test.ts` green with a tier-1 solver up — 8ebd639

#### Manual

- [x] 2.5 `cpsat … --mode complete --policy student-first` prints stages in student-first order and the sidecar echoes the policy — 8ebd639

### Phase 3: App — one validated value, three destinations

#### Automated

- [x] 3.1 `pnpm test` green — `clean-label.test.ts`, `policy.test.ts`, `use-pending-proposal.test.ts`, delivery/enqueue unit paths — 5d0bd1f
- [x] 3.2 `pnpm test:integration` green with a tier-1 solver up, including the student-first chain assertion — 5d0bd1f
- [x] 3.3 `pnpm check` 0 errors; `pnpm lint`, `pnpm steiger` clean — 5d0bd1f

#### Manual

- [x] 3.4 A job launched from the button shows `policy = {"preset":"clean"}` on its row

### Phase 4: UI — the launch dialog and the vocabulary

#### Automated

- [x] 4.1 `pnpm test` green — `GenerateButton.test.tsx`, `GenerationStatusStrip.test.tsx`, hook tests
- [x] 4.2 `pnpm test:e2e e2e/specs/generation.spec.ts` green against a preview with `SOLVER_URL` and a tier-1 solver up
- [x] 4.3 `pnpm check` 0 errors; `pnpm lint`, `pnpm steiger`, `pnpm build` clean

#### Manual

- [x] 4.4 Tier-1 loop: Generate under `student-first`; hub reads "stage 3 of 10 · student holes"; provenance line names the policy
- [x] 4.5 Generate again on the same source: the dialog opens with `student-first` pre-selected
- [x] 4.6 A disable reason arriving while the dialog is open disables confirm and shows its text
- [x] 4.7 Keyboard-only and VoiceOver pass over the dialog
- [x] 4.8 Semantic tokens only in the new markup

### Phase 5: Close-out — in-code docs and the recorded decision

#### Automated

- [ ] 5.1 `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build` green; `mise run solver:check` clean
- [ ] 5.2 `/verify` (the full local CI mirror) green

#### Manual

- [ ] 5.3 Roadmap S-307 entry reads correctly against the shipped diff; `change.md` notes are complete
