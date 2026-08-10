# Frozen Wire Contract + `generation_jobs` Schema + Solver Credential (F-301) — Implementation Plan

## Overview

Freeze the TS↔Python generation wire contract as a hand-written, tech-neutral JSON Schema in `contracts/`, golden-fixture-gated in both the Vitest and pytest suites; ship the forward-designed `generation_jobs` table every downstream slice (S-301→S-310) builds on; and land the spike-verified least-privilege solver credential (`solver_job_writer` role via Custom Access Token Hook) with its load-bearing hook-misfire guard test.

## Current State Analysis

From `research.md` (complete, all six open questions resolved, custom-role spike run live):

- The contract exists as two independently-consistent halves that disagree in eight places: TS types in `src/entities/timetable/model/generation/types.ts:16-108`, Python frozen dataclasses in `poc/cp-sat/src/cpsat_engine/schema.py`. `formatVersion` exists only on the Python side and a bench-only TS envelope; the TS side performs **no runtime validation anywhere** (`bench/import-generated.experiment.ts:56-57` is two bare `as` casts).
- No JSON-schema tooling exists in the repo (no ajv, no zod-to-json-schema). Every enum leaf is already single-sourced with Zod primitives, but the artifact decision is hand-written JSON Schema (research §1.5) so the artifact **is** the contract, owned by neither side.
- One committed fixture exists, Python-side only: `poc/cp-sat/tests/fixtures/seed-plan-a.json` (the bench **dump envelope** — includes `greedy.*` warm-start and `objective` parity baseline, which are bench transport, not production wire).
- One producer bypasses the single assembly path: `src/_pages/plan-comparison/api/load-plan-analysis.ts:109-118` hand-builds a `GeneratorSnapshot`.
- `generation_jobs` does not exist. House migration/RLS/grant conventions are fully mapped (research §3) and the grant posture was verified live.
- No machine credential path exists; every write today is cookie-session-bound. Option E (machine Auth user + Custom Access Token Hook → custom PG role) was verified by live spike — including the failure mode: a hook misfire silently falls back to `authenticated` = full-database read.
- CI has no Python job at all; a minimal `solver` lane ships with this change (research resolution #3).

## Desired End State

- `contracts/generation-wire.schema.json` + `contracts/README.md` + two canonical golden fixtures exist at repo root; both suites validate the goldens against the schema and byte-compare canonical serialization; `pnpm test` and `uv run pytest` both gate the contract; a `solver` CI job makes the Python gate real on every push.
- `generation_jobs` exists with the full forward-designed column set, house RLS/grants (incl. anon Dxtm revoke), partial unique active-job index, and `moddatetime`; `database.types.ts` is regenerated.
- `solver_job_writer` role + Custom Access Token Hook are migration-declared; hook enablement is repo-declared in `config.toml`; a machine-user provisioning script + runbook exist; an integration test proves the role claim, denies `plans`, and probes `has_table_privilege`.
- The two stale docs no longer contradict the deploy posture of record.

Verify: `/verify` green, `uv run pytest` green from `poc/cp-sat/`, `pnpm test:integration` green, `supabase db reset` clean, CI shows the `solver` job in `deploy.needs`.

### Key Discoveries:

- A test at `contracts/**/*.test.ts` is collected by **no** vitest project (`vitest.config.ts:27`) — the TS gate must live at `bench/contract-parity.test.ts`, already inside `pnpm test`, outside FSD/steiger, beside the format's producer.
- `lefthook.yml:13-16` runs `prettier --write` on staged `.json` — without `contracts/` in `.prettierignore`, golden bytes are silently rewritten on every commit (measured: 3293→3088 lines).
- The dump's `greedy` section is only a warm-start hint (`solve.py:420-421`) and `dump.objective` only the parity baseline (`solve.py:107-118`) — both are bench transport, **out of contract**, so the parity suite keeps its fixture and its 10/10 gate untouched.
- The wire pin is exactly Python's 4-field `Pin` (`schema.py:55-62`: `courseId`, `day`, `period`, `week`); `verify.ts` reads neither `id` nor `isOptional`, so the projection to the narrow pin happens at the wire boundary and the in-app `GeneratorSnapshot` type (still consumed by greedy until S-309) stays untouched.
- Pytest cwd is `poc/cp-sat/`; the Python contract test must anchor `Path(__file__).resolve().parents[3] / "contracts"` — which survives the planned `services/solver/` promotion verbatim.
- Per-stage `best`/`bound` are upper bounds, stage sets vary by mode (`solve_repair` emits tiers 1 and 4 only) — `stages` is a variable-length array of `StageReport` objects, never a fixed 10-tuple.
- Supabase auto-grants leave `anon` with `Dxtm` (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) even after the house four-verb revoke — this change revokes those too on `generation_jobs` so the migration comment can honestly claim full anon exclusion (`lessons.md:47-52`).
- Spike probe 8: a hook misfire returns **real plan names** under the fallback `authenticated` role — the guard test is part of this change's definition of done, not an optional hardening.

## What We're NOT Doing

- **No HTTP surface, no container, no queue** — F-302's `POST /solve` wrapper, Cloudflare Container config, and job orchestration are out of scope. F-301 ships the contract, the table, and the credential those slices consume.
- **No per-stage checkpoint plumbing in the solver** — `_run_ladder` discards incumbents today; capturing them is S-303. F-301 only ships the columns S-303 will write into.
- **No greedy conformance work.** Greedy is out of contract scope entirely (slated for removal, S-309). Its in-app TS types stay wider than the wire (e.g. `stopReason: "stagnation"`, `engine: string`) until S-309 deletes it — only docblocks change.
- **No runtime schema validation in app hot paths** — TS validation is test-lane only. Producers are unified through `assembleGeneratorSnapshot`, but no request-time ajv runs anywhere near the <200ms budget.
- **No changes to the bench dump envelope or the parity suite.** `seed-plan-a.json`, `export-snapshot.experiment.ts`, the objective-parity tests, and the `.report.json` sidecar are all explicitly out of contract; CP-SAT modeling/objective code is untouched (10/10 gate must not move).
- **No mise orchestration** — `mise.toml` is a stub; wiring a cross-ecosystem task is S-302/FR-315 territory.
- **No ownership-scoped RLS** — the house single-policy convention stands; no `auth.uid()` predicates.
- **No `alter default privileges` for `solver_job_writer`** — future tables must stay unreachable to it by default.

## Implementation Approach

Five phases, each independently verifiable. Phase 1 authors the artifact and the TS gate (including golden generation, since the TS canonicalizer is the tool that produces canonical bytes); Phase 2 mirrors the gate in Python and makes it real in CI; Phase 3 ships the table; Phase 4 ships the credential and its guard; Phase 5 trues up docs. Phases 3–4 are DB-only and independent of 1–2; they are ordered after the contract because `snapshot_hash` semantics (canonical serialization) are defined by Phase 1.

**Contract decisions of record** (settled with the author; the schema must encode all of them):

1. **Strict + narrow pin**: `additionalProperties: false` on every object; wire pin = `{courseId, day, period, week}` only. `id`/`isOptional`/`bundleId` never cross the wire.
2. **CP-SAT is the sole wire producer**: `engine` is `const "cp-sat"`; `provenOptimal` **required**; `stopReason` optional with enum `["budget", "cancelled"]` (no `stagnation` — greedy-only); `partial` means `not provenOptimal`. Greedy is out of contract.
3. **Omit-when-absent, never null**: no `null` anywhere on the wire. Python's emitter drops `None` keys; the TS canonicalizer omits `null`/`undefined`-valued keys by specification (the convention is *encoded in the canonicalizer*, not just documented).
4. **One canonicalizer, two consumers**: a declared canonical JSON form (spec below) is implemented once per side; golden tests byte-compare it AND `snapshot_hash` digests it.
5. **`formatVersion`**: `const 1` on the `SolveRequest` envelope def. Any breaking `$defs` change bumps it; the bump policy lives in `contracts/README.md`. Python's bench-dump `FORMAT_VERSION` gate stays as-is (bench scope).
6. **Out of contract, stated in the README**: the bench dump envelope (`greedy.*`, `objective`, `meta`), the `.report.json` sidecar, and the greedy engine.

**Canonical JSON form** (documented normatively in `contracts/README.md`, implemented in both canonicalizers): UTF-8, no trailing newline debate — exactly the serializer output, compact separators (no whitespace), object keys sorted lexicographically at every depth, `null`/`undefined`-valued keys omitted, and every semantically-unordered array sorted by a declared key: `courses` by `id`; `teacherKeys`/`studentKeys`/`finishesEarlyByCourseId`/`parkedCourseIds` lexicographic (parked keeps duplicates — multiset); `pins` by (`courseId`, `day`, `period`, `week`); `availability` by (`teacherKey`, `day`, `period`); `placements` by (`cohort`, `courseId`, `day`, `period`, `week`); `unplaced` by `courseId`. Python mirror: `json.dumps(..., sort_keys=True, separators=(",", ":"))` + the same array sorts + `None`-key dropping. **Numbers rule**: every byte-compared / hash-digested payload (the snapshot and result goldens, `snapshot_hash` input) contains integers only — `wallClockS` is the sole in-contract non-integer, schema-validated but carrying NO cross-language canonical-byte guarantee (Python `json.dumps(2.0)` → `"2.0"` vs JS `"2"`); introducing any new float into a byte-compared payload is a `formatVersion` decision.

## Critical Implementation Details

**Golden bytes vs the format hook.** `.prettierignore` must gain `contracts/` in the same commit that adds the first fixture — lefthook's `stage_fixed: true` format job rewrites committed JSON otherwise, and CI would not catch the drift. Guard it permanently: the bench parity test byte-compares canonical serialization against the raw file bytes, so any future reformat goes red.

**Result-golden generation ordering.** The result golden is produced in Phase 1 by running the existing CP-SAT CLI once on the seed dump and passing its output through the **TS** canonicalizer (which drops the `lowerBound: null` keys by spec). Phase 2's Python `None`-dropping emit change is then verified against schema conformance on synthetic data — the Python side never needs to byte-produce the result golden, only the snapshot round-trip.

**ESLint on `contracts/` and typed parses.** `tsconfig.json` includes `contracts/**/*.ts` and `@typescript-eslint/no-unsafe-assignment` is an error — every `JSON.parse(readFileSync(...))` in tests goes through a typed parse helper. `.json` files are invisible to ESLint; only `.ts` in `contracts/` (there should be none) would be linted.

**Hook fallback is silent escalation.** If the Custom Access Token Hook is disabled or errors, the machine user's token carries `role: authenticated` and reaches the entire database (spike probe 8 returned real plan names). The Phase 4 integration test asserts the decoded token's `role` claim **and** `permission denied` on `plans` — both, because either alone can false-negative.

**Poll projection is correctness-adjacent.** With the ~100–124 KB snapshot stored as `jsonb` on the row, any `select *` (PostgREST `.select()` with no args) pulls the TOASTed payload on every poll. The migration header states the narrow-projection requirement so S-303 inherits it as a rule, not a discovery.

**`supabase config push` for hook enablement on hosted.** Locally the hook config travels with `config.toml`; hosted enablement is a one-time documented `supabase config push` in the runbook (CI's deploy job only runs `db push` today — extending it is deliberately deferred, recorded in the runbook).

---

## Phase 1: Contract Artifact + TS Gate

### Overview

Author the tech-neutral schema and README, implement the TS canonicalizer + snapshot hash helper, generate and commit both golden fixtures, land the bench parity test, unify the bypass producer, and protect golden bytes from the format hook.

### Changes Required:

#### 1. The artifact

**File**: `contracts/generation-wire.schema.json` (new)

**Intent**: The single frozen contract document — JSON Schema draft 2020-12, `$defs`-only (no root type), encoding all six contract decisions of record.

**Contract**: `$defs`: `Pin` (4 fields), `WireCourse` (`id`, `teacherKeys`, `hours`, `studentKeys`, `weekMode` — mirrors `GroupingCourse`), `AvailabilityCell`, `GeneratorCohortSnapshot`, `GeneratorSnapshot` (cohorts = required `dp1`/`dp2` properties, `additionalProperties: false`), `GeneratedPlacement`, `CourseDeficit`, `GenerationCohortDiagnostics` (`lowerBound` optional number, never null), `GenerationDiagnostics` (`engine: const "cp-sat"`, `provenOptimal` required, `stopReason` enum `["budget","cancelled"]` optional, `partial` boolean), `GenerationResult`, `StageReport` (camelCase: `tier`, `name`, `status` — the raw CP-SAT status string, `best`/`bound` optional ints, `wallClockS`), `SolveRequest` (`formatVersion: const 1`, `snapshot`, optional `warmStart: GeneratedPlacement[]`). Every object `additionalProperties: false` with explicit `required` lists. `objective` (the 10-tuple) does not appear — it is bench-scope.

#### 2. The contract README

**File**: `contracts/README.md` (new)

**Intent**: The normative companion: what is frozen, what is explicitly out of scope, the canonical-form specification, the `formatVersion` bump policy, and fixture regeneration commands.

**Contract**: Sections: Scope (the `$defs` list; `StageReport` is in-contract because S-303 persists it to `generation_jobs.stages`); Out of scope (bench dump envelope incl. `greedy.*`/`objective`/`meta`, `.report.json` sidecar, greedy engine); Canonical JSON form (the spec from Implementation Approach, stated normatively — both implementations must match it, including the Numbers rule: byte-compared/hashed payloads are integer-only, `wallClockS` is the sole non-integer with no cross-language byte guarantee, any new float in a byte-compared payload bumps `formatVersion`); Versioning (`formatVersion` bump = any breaking `$defs` change; both suites' goldens regenerate together); Regeneration (the exact commands for both fixtures).

#### 3. TS canonicalizer + snapshot hash

**File**: `src/entities/timetable/model/generation/wire.ts` (new) + `wire.test.ts` co-located

**Intent**: The one TS implementation of the canonical form and the `snapshot_hash` digest. Lives in the entity (not `shared/`) because it consumes `GeneratorSnapshot` — FSD forbids the upward import.

**Contract**: Exports `canonicalStringify(value: unknown): string` (recursive key-sort, compact, omits `null`/`undefined`-valued keys), `canonicalizeSnapshot(snapshot: GeneratorSnapshot): string` (projects pins to the 4 wire fields, applies the declared array sorts, then `canonicalStringify`), and `computeSnapshotHash(snapshot: GeneratorSnapshot): Promise<string>` (SHA-256 hex over `canonicalizeSnapshot`, mirroring the `computeCatalogHash` Web-Crypto idiom at `compute-catalog-hash.ts:13-27`). Unit tests: input-order invariance, pin projection strips `id`/`isOptional`/`bundleId`, null-key omission, hash stability. Export through the generation barrel following the slice's existing pattern.

#### 4. Golden fixtures + regeneration script

**File**: `contracts/fixtures/generator-snapshot.json`, `contracts/fixtures/generation-result.json` (new), `bench/generate-contract-goldens.experiment.ts` (new — the `*.experiment.ts` suffix keeps it out of the test glob and gives it the bench experiment runner: vitest + env-var args + `it.runIf`, per `import-generated.experiment.ts`)

**Intent**: Real-size, UUID-only goldens in canonical bytes. Snapshot: the `snapshot` key of the existing seed dump, projected + canonicalized. Result: one CP-SAT CLI run over the seed dump, canonicalized (null keys drop by spec).

**Contract**: The script reads `poc/cp-sat/tests/fixtures/seed-plan-a.json` and a CLI-produced result path, writes both fixtures via the Phase-1 canonicalizer, and is the documented regeneration path (README §Regeneration). Fixture rule: UUID-only — same posture as the seed dump (`.gitignore:84-93`). The result is produced once with `uv run` per the existing CLI usage; its exact command line lands in the README.

#### 5. The TS gate

**File**: `bench/contract-parity.test.ts` (new); `package.json` (+`ajv` devDependency)

**Intent**: The Vitest-side golden gate — schema-validates both fixtures, byte-compares canonical serialization, and pins TS-type assignability. Lives in `bench/` because `contracts/**/*.test.ts` runs nowhere (`vitest.config.ts:27`).

**Contract**: Using ajv's 2020-12 build (dev-only import, test lane): (a) both goldens validate against their `$defs`; (b) `canonicalizeSnapshot(parse(snapshotGolden))` byte-equals the raw fixture bytes (this is also the anti-prettier tripwire); (c) `canonicalStringify(parse(resultGolden))` byte-equals its fixture; (d) typed-parse helpers pin both payloads to `GeneratorSnapshot`/`GenerationResult` at compile time; (e) an `assembleGeneratorSnapshot` output (reusing `assemble-snapshot.test.ts` fixtures) canonicalizes to schema-valid JSON. Typed parse helper avoids `no-unsafe-assignment` errors.

#### 6. Unify the bypass producer

**File**: `src/_pages/plan-comparison/api/load-plan-analysis.ts:109-118`

**Intent**: Route the hand-built snapshot literal through `assembleGeneratorSnapshot` so every producer shares the single assembly path — closing the one silent-drift hole research found.

**Contract**: The function's output shape is unchanged (`pins: []` semantics preserved via assembly inputs); existing plan-comparison tests keep passing.

#### 7. Protect golden bytes + docblock truth

**File**: `.prettierignore` (+`contracts/`); `src/entities/timetable/model/generation/types.ts` (docblocks only)

**Intent**: Stop the format hook rewriting goldens (same commit as the first fixture). Rewrite the stale `partial` docblock to the frozen semantics (`partial` = not proven optimal on the wire; CP-SAT is the sole wire producer) and annotate `stopReason`/`engine` docblocks that the wire contract narrows them (`stagnation` and non-`cp-sat` engines are in-app-only until S-309).

**Contract**: Type shapes unchanged — docblock-only edits; greedy keeps compiling.

### Success Criteria:

#### Automated Verification:

- `pnpm test` passes with `bench/contract-parity.test.ts` collected and green
- `pnpm check` passes (contracts fixtures + new entity module type-clean)
- `pnpm lint` passes (typed parses satisfy `no-unsafe-assignment`)
- `pnpm steiger` passes (wire.ts inside the entity slice)
- `pnpm format && git diff --exit-code contracts/` — prettier does not touch goldens

#### Manual Verification:

- Read `contracts/generation-wire.schema.json` against `types.ts` and `schema.py` — every decision of record (narrow pin, no-null, CP-SAT-canonical, formatVersion const) is visibly encoded
- Confirm both fixtures contain UUIDs only (no names) — spot-check per the `.gitignore:84-93` rule

**Implementation Note**: After this phase's automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Python Gate + Minimal CI Lane

### Overview

Mirror the canonical form and the golden gate in the pytest suite, fix the `None`-emission divergence, and add the minimal `solver` CI job so "gated in both suites" is true on day one.

### Changes Required:

#### 1. Canonical emit + None-dropping

**File**: `poc/cp-sat/src/cpsat_engine/wire.py` (new); `poc/cp-sat/src/cpsat_engine/solve.py` (`to_generation_result`)

**Intent**: The Python mirror of the canonical form, and the emit-side fix for the no-null convention (drop `None` keys instead of emitting `"lowerBound": null`).

**Contract**: `wire.py` exports `canonical_snapshot_json(snapshot: Snapshot) -> str` and `canonical_json(value) -> str` matching the README spec byte-for-byte (`sort_keys=True`, compact separators, declared array sorts, `None`-key omission). `to_generation_result` stops inserting `None` values (`solve.py:298-304`). `StageReport` emit for the wire normalizes to camelCase (`wallClockS`) per contract decision 6 — as a `wire.py` serializer, NOT by renaming the dataclass (the `.report.json` sidecar and internal fields stay snake_case, out of contract). Fully type-annotated (house rule).

#### 2. The Python gate

**File**: `poc/cp-sat/tests/test_contract.py` (new); `poc/cp-sat/pyproject.toml` (+`jsonschema>=4` dev group)

**Intent**: The pytest-side golden gate, anchored on `__file__` because pytest's cwd is the package dir.

**Contract**: Fixture root = `Path(__file__).resolve().parents[3] / "contracts"` (depth survives the `services/solver/` promotion). Tests: (a) both goldens validate against the schema via `jsonschema` (dev group — validation stays out of the solve hot path); (b) snapshot round-trip: parse the snapshot golden through the existing `_snapshot` builder path, re-emit via `canonical_snapshot_json`, byte-equal the golden; (c) a synthetic `SolveResult` through `to_generation_result` + `canonical_json` validates against `$defs/GenerationResult` and contains no null values; (d) a synthetic `StageReport` through the wire serializer validates against `$defs/StageReport`. The existing parity suite and `seed-plan-a.json` are untouched.

#### 3. The CI lane

**File**: `.github/workflows/ci.yml`

**Intent**: A minimal `solver` job (research resolution #3) so the Python gate runs on every push; ruff/mypy/paths-filter stay with S-302/FR-315.

**Contract**: New job: checkout → `astral-sh/setup-uv` → `uv sync` → `uv run pytest`, `working-directory: poc/cp-sat`. `deploy.needs` gains `solver`. No path filters (none exist anywhere in this workflow; the 40-test suite runs in parallel with the stack-booting jobs that dominate wall-clock).

### Success Criteria:

#### Automated Verification:

- `uv run pytest` green from `poc/cp-sat/` — contract tests AND the objective-parity suite at exact 10/10
- `uv run ruff check` clean on the new/changed files
- CI on the PR branch shows the `solver` job green and listed in `deploy.needs`

#### Manual Verification:

- Confirm the byte-parity property end-to-end once: regenerate the snapshot golden via the Phase-1 script, run the Python round-trip test — both sides agree on canonical bytes

**Implementation Note**: After this phase's automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: `generation_jobs` Migration

### Overview

Ship the full forward-designed table with house RLS/grants (plus the Dxtm extras), indexes, and `moddatetime`; regenerate the generated types; add a posture integration test.

### Changes Required:

#### 1. The migration

**File**: `supabase/migrations/<ts>_generation_jobs.sql` (new, via `pnpm exec supabase migration new generation_jobs`)

**Intent**: The one table every downstream slice writes into, shaped once with full context so S-303→S-310 need zero migrations.

**Contract**: Columns (research §4 + resolutions):
- `id uuid pk default gen_random_uuid()`
- `plan_id uuid not null references plans(id) on delete cascade` — required for factory teardown's plan-rooted cascade
- `proposal_plan_id uuid references plans(id) on delete set null` — **deliberate deviation** from the 41-of-43 cascade convention (S-306 deletes the clone on auto-apply; cascade would erase the job record) — call out in header
- `status text not null default 'queued'` + check over the full vocabulary `('queued','running','succeeded','failed','stopped','interrupted')` (text+check per the `bundles` precedent; enum rejected — resolution #5)
- `policy jsonb not null`; `snapshot jsonb not null` (the solve input dump — resolution #2); `snapshot_hash text not null` (hex SHA-256 of the canonical snapshot, source plan at T0 — resolution #1); `result jsonb`; `error text`
- `created_at`/`updated_at timestamptz not null default now()` + `moddatetime` trigger (deliberate re-adoption — job rows are mutable, unlike every table since 2026-06-13; call out in header)
- `started_at`/`finished_at`/`heartbeat_at`/`stop_requested_at`/`notified_at timestamptz`
- `stage_index`/`checkpoint_stage_index smallint`; `stage_name text`; `stages jsonb not null default '[]'` (array of camelCase `StageReport` — variable length, never a fixed tuple); `checkpoint jsonb` (single latest complete board, overwritten per stage — retention decision)
- `delivery text`; `delivered_plan_id uuid references plans(id) on delete set null` (same rationale as proposal)

Indexes: `create unique index generation_jobs_active_per_plan on generation_jobs (plan_id) where status in ('queued','running')` (FR-308); non-unique indexes on `plan_id`, `proposal_plan_id`, `delivered_plan_id` (FK index discipline — the advisor is a gate).

RLS + grants: `enable row level security`; the house single policy (`for all to authenticated using (true) with check (true)` — no row predicate, structural isolation); `revoke select, insert, update, delete on generation_jobs from anon` **plus** `revoke truncate, references, trigger, maintain on generation_jobs from anon` (the Dxtm extras — so the header's full-exclusion claim is true; call out the deviation from the uniform four-verb revoke).

Header prose (hard house style): what/why, GRANT/RLS statement, first-`jsonb`-column callout, moddatetime re-adoption rationale, both `set null` deviations, and the **narrow poll projection warning** (snapshot is ~100–124 KB TOASTed; pollers must never `select *`).

#### 2. Generated types + reset

**File**: `src/shared/api/database.types.ts` (regenerated)

**Intent**: Keep the committed hand-generated types in sync (no script/CI drift check exists).

**Contract**: `pnpm exec supabase db reset` → `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts` → `pnpm check`. Watch for formatting churn (the file is NOT prettier-ignored — `.prettierignore` lists the stale pre-FSD path).

#### 3. Posture integration test

**File**: `src/test/` (new `*.integration.test.ts`, co-located per harness conventions)

**Intent**: Prove the table's grant/RLS posture with `has_table_privilege` (the lesson: never trust migration text) and pin the two behavioral constraints downstream slices rely on.

**Contract**: Probes via direct SQL against the local stack (dev-only Postgres client dependency is acceptable in the test lane): `has_table_privilege('anon','public.generation_jobs', ...)` false for all eight verbs; true DML for `authenticated`/`service_role`. Behavior: the partial unique index rejects a second `queued`/`running` job for the same plan but allows one after the first reaches a terminal status; `updated_at` moves on update (moddatetime); deleting the plan cascades the job (teardown safety); deleting a proposal plan nulls `proposal_plan_id` without deleting the job. Builds state via `src/test/factories/`, cleans via `teardown`.

### Success Criteria:

#### Automated Verification:

- `pnpm exec supabase db reset` applies cleanly
- `pnpm check` passes with regenerated `database.types.ts`
- `pnpm test:integration` green including the new posture test
- `pnpm exec supabase db advisors` (or equivalent lint) reports no unindexed-FK finding for the new table

#### Manual Verification:

- Read the migration header against the honesty rules: no claim the grants don't back (Dxtm included), both `set null` deviations called out, poll warning present

**Implementation Note**: After this phase's automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Solver Credential

### Overview

Land the spike-verified Option E: the narrow Postgres role, the Custom Access Token Hook, repo-declared hook enablement, machine-user provisioning, and the load-bearing hook-misfire guard test.

### Changes Required:

#### 1. Role + policies migration

**File**: `supabase/migrations/<ts>_solver_job_writer_role.sql` (new)

**Intent**: The narrow role the solver's token resolves to — reaching exactly one table, with RLS still applied.

**Contract**: Per the spike-verified design (research §6.3): `create role solver_job_writer nologin` (fails loudly if it exists — no `if not exists`, house style); `grant solver_job_writer to authenticator`; `grant usage on schema public to solver_job_writer`; `grant select, update on public.generation_jobs to solver_job_writer` — deliberately NO insert (Worker enqueues), NO delete, NO other tables, NO `bypassrls`, NO default-privileges extension (header states each). Policies (both explicitly `to solver_job_writer` — never role-less, which scopes to PUBLIC): `"Solver reads its jobs"` (`for select to solver_job_writer using (true)`) and `"Solver updates non-terminal jobs"` (`for update to solver_job_writer using (status in ('queued','running')) with check (status in ('running','succeeded','failed','stopped','interrupted'))`) — `'stopped'` included because S-305's solver writes the stopped terminal state; `'queued'` excluded from `with check` (the solver never re-queues).

#### 2. Custom Access Token Hook

**File**: `supabase/migrations/<ts>_custom_access_token_hook.sql` (new); `supabase/config.toml` (enable `[auth.hook.custom_access_token]`)

**Intent**: Swap the machine user's `role` claim from `authenticated` to `solver_job_writer` at token mint — the mechanism that keeps the container on the publishable key + password only.

**Contract**: A Postgres function (conventional hook signature: `(event jsonb) returns jsonb`) that reads the user's `app_metadata.machine_role`, validates it against the allowlist (`'solver_job_writer'` only), and rewrites `claims.role`; any other user's event passes through unchanged. Execution grants per Supabase's hook requirements (`supabase_auth_admin` needs execute; other roles revoked). This is an auth hook, not an app RPC — the "no `security definer`" house rule governs app RPCs; follow current Supabase hook-permission docs (fetch them — post-cutoff surface) and state the posture in the header. `config.toml`: uncomment/enable the hook block with the `pg-functions://` URI so local enablement is repo-declared; hosted enablement = documented `supabase config push` (runbook, manual one-time — CI deploy extension deferred).

#### 3. Machine-user provisioning

**File**: `scripts/provision-solver-user.mjs` (new); `docs/runbooks/solver-credential.md` (new)

**Intent**: Create/rotate the machine Auth user (`app_metadata.machine_role = 'solver_job_writer'`, password from env) — mirroring the `provision-e2e-author.mjs` pattern. The runbook records the full credential story: what the container holds (URL + publishable key + password), rotation (change password / disable user), the refresh-vs-re-grant decision (container re-runs the password grant near expiry — hook demonstrably fires on password grant; refresh-grant behavior deliberately not relied on), and the hosted `config push` step.

**Contract**: Script is idempotent per the e2e-provisioning precedent; secrets never committed; runbook linked from README's runbook section.

#### 4. Hook-misfire guard test

**File**: `src/test/` (new `*.integration.test.ts`)

**Intent**: Convert the silent-escalation failure mode (spike probe 8: fallback `authenticated` returned real plan names) into a red build. Load-bearing — part of F-301's definition of done.

**Contract**: Provisions the machine user (service-role admin API in test setup), signs in with the password grant, then asserts: (a) the decoded access token's `role` claim is `solver_job_writer`; (b) `select` on `plans` under that token returns `permission denied` (403); (c) `select` and a policy-conformant `update` on `generation_jobs` succeed; (d) `insert`/`delete` on `generation_jobs` are denied; (e) `has_table_privilege('solver_job_writer', ...)` probes: only SELECT+UPDATE on `generation_jobs`, nothing on `plans` (per `lessons.md:47-52`, prove posture, don't read migration text). Cleans up the machine user in teardown.

### Success Criteria:

#### Automated Verification:

- `pnpm exec supabase db reset` applies both migrations cleanly with the hook enabled in `config.toml`
- `pnpm test:integration` green including the guard test (role claim + plans denied + privilege probes)
- `pnpm check` / `pnpm lint` stay green

#### Manual Verification:

- Kill-switch drill: disable the hook in `config.toml`, restart the stack, run the guard test — it must go RED (proving it detects the fallback), then re-enable and confirm green
- Runbook walkthrough: the container-side credential story (what it holds, how it rotates, hosted `config push`) is complete enough to execute in F-302 without re-research

**Implementation Note**: After this phase's automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 5: Docs Truth-Up

### Overview

Fix the two stale docs research flagged, and document `contracts/` where contributors look.

### Changes Required:

#### 1. Stale posture docs

**File**: `context/foundation/infrastructure.md:71-97`; `README.md` (CI secrets table)

**Intent**: `infrastructure.md` still instructs `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` for production — contradicting the deploy-plan decision of record (`deploy-plan.md:141`, "Secret key NOT pushed"). README's required-secrets table lists `SUPABASE_URL`/`SUPABASE_KEY` as repo secrets no CI job reads. Align both with reality; while editing, verify each cited mechanism still exists (lesson: grep, not memory). Also fix README's stale deploy-plan link — it points at `context/changes/deployment/deploy-plan.md` but the file lives at `context/deployment/deploy-plan.md`.

**Contract**: Prose-only edits; the deploy-plan decision of record is the authority.

#### 2. Document `contracts/`

**File**: `README.md` (project structure section); `CLAUDE.md` (solver package section)

**Intent**: `contracts/` appears in the structure listing with its one-line purpose; CLAUDE.md's "a tech-neutral schema artifact lands in `contracts/` during the migration" becomes present-tense with the regeneration pointer (both-suites golden gate, `contracts/README.md` owns the spec).

**Contract**: Keep both terse — the normative detail lives in `contracts/README.md`.

### Success Criteria:

#### Automated Verification:

- `pnpm lint` and `pnpm format` clean

#### Manual Verification:

- Grep-check: no remaining `SUPABASE_SERVICE_ROLE_KEY` production instruction anywhere in `context/` or `README.md`

---

## Testing Strategy

### Unit Tests:

- `wire.test.ts` (TS): canonical-form properties — order invariance, pin projection, null-key omission, hash stability
- `test_contract.py` (Python): golden schema-validation, snapshot canonical round-trip byte-parity, synthetic result/StageReport conformance, no-null emission
- `bench/contract-parity.test.ts`: goldens validate + byte-compare + TS-type pinning + assembled-snapshot conformance

### Integration Tests:

- `generation_jobs` posture: `has_table_privilege` probes, partial-unique behavior, moddatetime, cascade/set-null semantics
- Credential guard: role claim, `plans` denied, table-scoped allow/deny matrix, `has_table_privilege` for `solver_job_writer`

### Manual Testing Steps:

1. Schema read-through against both type sources (Phase 1)
2. Cross-language byte-parity spot check via golden regeneration (Phase 2)
3. Migration-header honesty review (Phase 3)
4. Hook kill-switch drill — guard test must go red with the hook disabled (Phase 4)
5. Runbook executability review (Phase 4)

## Performance Considerations

- No runtime validation lands in any hot path — ajv/jsonschema are test-lane only; the <200ms drag-drop budget is untouched.
- The snapshot `jsonb` TOASTs out-of-line (>2 KB), so narrow poll projections never read it — the requirement is stated in the migration header for S-303 to inherit.
- The `solver` CI job (40 tests) runs in parallel with stack-booting jobs; no wall-clock impact on the critical path.

## Migration Notes

- Both migrations are purely additive — no existing table, function, or policy is modified; rollback at this stage is drop-and-repush (no production data to preserve, per README).
- `database.types.ts` regeneration is manual and committed in the same PR as the migration.
- Hosted hook enablement (`supabase config push`) is a one-time manual step documented in the runbook; migrations themselves flow through the normal CI `db push`.
- Golden regeneration is always bilateral: any schema change regenerates both fixtures and must go green in both suites in the same PR (`formatVersion` bumps when breaking).

## References

- Related research: `context/changes/solver-contract-and-jobs-schema/research.md` (all six open questions resolved; credential spike verified)
- Roadmap item: `context/foundation/roadmap.md:81-93` (F-301); issue #96
- Contract surfaces: `src/entities/timetable/model/generation/types.ts:16-108`; `poc/cp-sat/src/cpsat_engine/schema.py:44-123`
- Hash idiom: `src/shared/lib/catalog-hash/compute-catalog-hash.ts:13-27`
- Migration template: `supabase/migrations/20260624120000_bundles.sql`; least-privilege lesson: `context/foundation/lessons.md:47-52`
- Credential posture of record: `context/deployment/deploy-plan.md:139-144`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contract Artifact + TS Gate

#### Automated

- [x] 1.1 `pnpm test` passes with `bench/contract-parity.test.ts` collected and green — 49e7ec4
- [x] 1.2 `pnpm check` passes — 49e7ec4
- [x] 1.3 `pnpm lint` passes — 49e7ec4
- [x] 1.4 `pnpm steiger` passes — 49e7ec4
- [x] 1.5 `pnpm format && git diff --exit-code contracts/` — prettier does not touch goldens — 49e7ec4

#### Manual

- [ ] 1.6 Schema read-through: all contract decisions of record visibly encoded
- [ ] 1.7 Fixtures spot-checked UUID-only

### Phase 2: Python Gate + Minimal CI Lane

#### Automated

- [x] 2.1 `uv run pytest` green — contract tests AND objective-parity at exact 10/10 — 9ab7a90
- [x] 2.2 `uv run ruff check` clean on new/changed files — 9ab7a90
- [ ] 2.3 CI `solver` job green and listed in `deploy.needs`

#### Manual

- [ ] 2.4 Cross-language canonical byte-parity confirmed via golden regeneration

### Phase 3: `generation_jobs` Migration

#### Automated

- [x] 3.1 `pnpm exec supabase db reset` applies cleanly — 8d6a73c
- [x] 3.2 `pnpm check` passes with regenerated `database.types.ts` — 8d6a73c
- [x] 3.3 `pnpm test:integration` green including the posture test — 8d6a73c
- [x] 3.4 No unindexed-FK advisor finding for `generation_jobs` — 8d6a73c

#### Manual

- [ ] 3.5 Migration-header honesty review (Dxtm claim, set-null deviations, poll warning)

### Phase 4: Solver Credential

#### Automated

- [x] 4.1 `pnpm exec supabase db reset` applies role + hook migrations with hook enabled
- [x] 4.2 `pnpm test:integration` green including the hook-misfire guard test
- [x] 4.3 `pnpm check` / `pnpm lint` green

#### Manual

- [ ] 4.4 Kill-switch drill: guard test goes red with hook disabled, green re-enabled
- [ ] 4.5 Runbook walkthrough complete enough to execute F-302 without re-research

### Phase 5: Docs Truth-Up

#### Automated

- [ ] 5.1 `pnpm lint` and `pnpm format` clean

#### Manual

- [ ] 5.2 No remaining service-role production instruction in `context/` or `README.md`
