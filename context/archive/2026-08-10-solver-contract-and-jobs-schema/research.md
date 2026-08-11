---
date: 2026-08-10T13:39:09+02:00
researcher: Claude (Opus 5)
git_commit: 9fc944aeba1a6daaea16fa61ebadd1d64d2c3532
branch: main
repository: ib-timetable-planner
topic: "F-301: freezing the generation wire contract as a tech-neutral artifact, forward-designing the generation_jobs schema, and scoping a least-privilege solver credential"
tags: [research, codebase, cp-sat, wire-contract, generation-jobs, supabase, rls, grants, least-privilege, ci, solver-contract-and-jobs-schema]
status: complete
last_updated: 2026-08-10
last_updated_by: Claude (Opus 5)
last_updated_note: "Follow-up: local custom-role spike run (5 of 6 credential assumptions verified); all six open questions resolved with the author"
---

# Research: F-301 — wire-contract artifact + `generation_jobs` schema + machine credential

**Date**: 2026-08-10T13:39:09+02:00
**Researcher**: Claude (Opus 5)
**Git Commit**: `9fc944aeba1a6daaea16fa61ebadd1d64d2c3532`
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/9fc944aeba1a6daaea16fa61ebadd1d64d2c3532/`

## Research Question

Ground the F-301 foundation (roadmap `context/foundation/roadmap.md:81-93`, issue [#96](https://github.com/dobrek/ib-timetable-planner/issues/96)) well enough to plan it in one pass:

1. **The contract.** What exactly are `GeneratorSnapshot`/`GenerationResult` on both sides today, how is `formatVersion` handled, and which mechanism should produce the committed tech-neutral artifact in `contracts/` that is golden-fixture-gated in **both** suites?
2. **The table.** Forward-design `generation_jobs` from the needs of every downstream slice (S-301 → S-310), against this repo's migration/RLS/grants/type conventions.
3. **The credential.** Resolve Open Roadmap Question 1 — which Supabase key/role the solver container gets, with a grants design consistent with the least-privilege lesson.

Scope was set with the user before research: forward-design the full job lifecycle; produce a docs-verified credential recommendation; evaluate contract-artifact approaches and recommend one.

## Summary

**The contract is not as frozen as the PRD assumes, and freezing it is a design act, not a transcription act.** `formatVersion` exists **only** on the Python side (`schema.py:18,112-114`) and as a literal on a bench-only TS envelope type (`bench/export-snapshot.experiment.ts:52,118`). The TS entity has no version field and performs **no runtime validation of a snapshot or result anywhere** — `bench/import-generated.experiment.ts:56-57` is two bare `as` casts. Eight concrete TS↔Python divergences exist today (§1.3) — pin-field asymmetry, `stopReason` union width, `partial` meaning two different things per engine, `lowerBound` null-vs-absent, and more. Every one must be *decided*, not merely described, before a schema can be written. Notably the two engines already disagree semantically: greedy always emits `stopReason` and never `provenOptimal`; CP-SAT is the exact mirror image.

**The gate mechanics have one silent trap and one honest gap.** A test at `contracts/**/*.test.ts` is collected by **no** vitest project (`vitest.config.ts:27` roots are `src/` and `bench/` only) — placing it there produces green CI with zero coverage. The TS parity test belongs at `bench/contract-parity.test.ts`, which is already in the `pnpm test` glob, already outside the FSD graph, and already sits beside the format's producer. Separately, **`contracts/` must be added to `.prettierignore`** or the lefthook pre-commit `format` job rewrites golden JSON on every commit (measured on the equivalent existing fixture: 3293 → 3088 lines, arrays collapsed) — this is exactly why `poc/` is already listed there. The honest gap: **`.github/workflows/ci.yml` has no Python job at all**, so "gated in both suites" is true locally and half-true in CI until the FR-315 solver lane lands in S-302.

**The jobs table is conventionally easy and needs exactly one grant statement.** Verified live against the local stack (not by reading migration text, per the lesson): a brand-new `public` table automatically inherits full DML for `authenticated` and `service_role` via `alter default privileges`, and `anon` is already excluded for SELECT/INSERT/UPDATE/DELETE. So the migration needs only `revoke ... from anon` (house belt-and-braces convention) plus `enable row level security` and the single uniform policy every table carries. Two firsts for this repo: a **`jsonb` table column**, and re-adopting the `moddatetime` `updated_at` trigger that no table has used since 2026-06-13 (a job row is mutable, unlike every table added since).

**The credential is where the real risk sits, and the naive answer is wrong.** Because `alter default privileges` grants `authenticated` **and** `service_role` DML on every current *and future* public table, any credential resolving to either role reaches the entire database — student names, teacher names, every plan. That directly contradicts the PII posture locked for the solver ("the dump is UUID-only by construction; names never reach the solver"). The recommended design is a dedicated `solver_job_writer` Postgres role reached by a machine Auth user whose token carries that role via a Custom Access Token Hook — the container then holds only the publishable key and a password, and RLS still applies. **Six load-bearing assumptions in that design are explicitly unverified** (§6.3) and want a local spike before the plan commits to it; a named secret key is the honest fallback, recorded as an accepted exception rather than glossed.

**One finding changes what F-301 can promise downstream.** The solver never holds the full 10-tuple objective during the ladder — per-stage `best` values are *upper bounds* under `tier_k <= best_k` hardening, and a later stage may improve an earlier tier (`tests/test_solve.py:59-60` asserts exactly this). Recovering a true tuple needs an `evaluate_board()` re-solve. And stage sets are **not** a fixed 10: `solve_repair` emits tiers 1 and 4 only. So the checkpoint columns must be a variable-length array of stage objects, never a fixed tuple — a schema shape decision that F-301 ships and S-303 depends on.

## Detailed Findings

### 1. The wire contract as it actually exists

#### 1.1 Shape and single-sourcing

The TS contract root is `src/entities/timetable/model/generation/types.ts` — `GeneratorSnapshot` (`:26-35`), `GeneratorCohortSnapshot` (`:16-23`), `GenerationResult` (`:85-88`), `GenerationDiagnostics` (`:71-83`), `GeneratedPlacement` (`:43-49`), `CourseDeficit` (`:52-55`). Transitive leaves: `PlannerPlacement` (`src/entities/timetable/model/placement.ts:4-25`), `GroupingCourse` (`src/shared/lib/catalog-hash/types.ts:30-37`), `BoardAvailabilityCell` (`src/entities/timetable/model/availability-index.ts:10-15`).

Every enum leaf is already single-sourced from the generated DB types with a matching Zod primitive — `Cohort`/`cohortSchema` (`src/shared/config/cohorts.ts:10,23`), `WeekMode`/`PlacementWeek` (`src/shared/config/week.ts:19-20,26-27`), `AvailabilitySeverity` (`src/shared/config/availability-severity.ts:12,17`). **A snapshot schema would compose from primitives that already exist**, which materially lowers the cost of the Zod-first option in §2.

The header of `types.ts:6-13` already states the freeze property the artifact would formalize: *"All fields are structured-clone-safe plain data."* Verified true — every collection on the wire is a plain array, the only date is pre-stringified (`bench/export-snapshot.experiment.ts:122`), and the `Map`/`Set` values in the neighbourhood (`availability-index.ts:22-25`, `verify.ts:177-180`) are derived indexes that are never serialized. Today that property is upheld by comment only.

The Python mirror is `poc/cp-sat/src/cpsat_engine/schema.py` — frozen dataclasses, **no defaults on any field**, camelCase→snake_case mapping done by hand as literal string subscripts (`schema.py:141-172`). `schema.py:7-8` names the TS bench file as authority.

#### 1.2 `formatVersion` — asymmetric today

| Side | Where | Behaviour |
| --- | --- | --- |
| Python | `schema.py:18` `FORMAT_VERSION = 1`; gate at `:112-114` | Raises plain `ValueError` on mismatch. Accepts **exactly int `1`** — a JSON `"1"` is rejected. |
| TS | `bench/export-snapshot.experiment.ts:52` (type) + `:118` (value) | Literal `1` **hardcoded twice**, on a bench-only envelope type. No parse-side check anywhere. |
| TS entity | — | **Absent.** `GeneratorSnapshot`/`GenerationResult` carry no version field. |

`bench/import-generated.experiment.ts:34-37` declares its read-back type *without* `formatVersion` at all and casts with `as` (`:56-57`). The only safety net is `verifyGeneration` at `:62` — which validates the **board**, not the **payload shape**.

A further sharp edge in the existing gate: everything after the version check uses `raw["..."]`, so a structurally-broken-but-correctly-versioned dump raises `KeyError`, which `cli.py:39` (`except (OSError, ValueError)`) does **not** catch.

#### 1.3 The eight divergences that must be *decided* before freezing

These are not documentation gaps — both sides are internally consistent and disagree with each other. Each needs a resolution recorded in the plan.

1. **Pin field asymmetry.** `GeneratorSnapshot.cohorts[c].pins` is typed `PlannerPlacement[]`, so the wire carries `id` and `isOptional` (both present in the committed fixture) and *permits* `bundleId?`. Python models a 4-field `Pin` (`schema.py:55-62`) and silently drops the rest; its round-trip test strips them before comparing (`tests/test_schema.py:54-68`, comment: *"deliberately NOT modelled — they never reach a constraint"*). `verify.ts` reads neither. **A strict schema with `additionalProperties: false` would reject a structurally valid snapshot** if a producer ever emits `bundleId` — and `toPin` (`assemble-snapshot.ts:53-60`) is the only thing stripping it today.
2. **`stopReason` union width.** TS: `"budget" | "stagnation" | "cancelled"` (`types.ts:78`). Python can only ever emit `"budget"` (`solve.py:296-297`). S-305 (Stop & keep) and S-304 (SIGTERM) will need `"cancelled"` — keep the full union.
3. **Emission asymmetry between the two engines.** Greedy always emits `stopReason`, never `provenOptimal` (`engines/greedy/search.ts:326-330`). CP-SAT always emits `provenOptimal`, emits `stopReason` only when not optimal (`solve.py:289-297`). Both legal under the optional typing — but **a golden fixture written against one producer will not match the other**.
4. **`partial` means two different things.** TS documents it as *"a cancelled best-so-far rather than a full-budget solve"* (`types.ts:76`); greedy sets it from `signal.aborted` (`search.ts:160`); Python sets `partial = not proven_optimal` (`solve.py:292`), so a full-budget non-optimal solve reports `partial: true`.
5. **`lowerBound` null-vs-absent.** TS types `lowerBound?: number` (`types.ts:63`); Python inserts it unconditionally and it can be `None` (`schema.py:103-106`, `solve.py:287`), so a CP-SAT result JSON can contain `"lowerBound": null`, which is **not assignable** to the TS type.
6. **`engine` is an unconstrained `string`** (`types.ts:73`). Only `"greedy"` and `"cp-sat"` are ever produced.
7. **`objective` is untyped on the wire.** The TS `Objective` is a fixed 10-tuple (`objective.ts:27-38`); the dump widens to `number[]` (`export-snapshot.experiment.ts:62`) and Python to `tuple[int, ...]` (`schema.py:101`). The only length check anywhere is `assert len(...) == 10` in `test_smoke.py:20`. Pin `minItems: 10, maxItems: 10`.
8. **Ordering is unspecified but load-bearing for byte-comparison.** `finishesEarlyByCourseId` is a concatenation with no sort; Python normalizes it to a `frozenset` and the round-trip test must `sorted()` both sides (`test_schema.py:23,61`). `parkedCourseIds` is a multiset where duplicate *count* is semantic (`deficits.ts:20-25`) but order is not. **Golden-fixture gating needs a declared canonicalization, or structural rather than byte-wise comparison.**

Two more, lower-severity: `meta` and `greedy.diagnostics` are fully opaque `dict` on the Python side (`schema.py:97,100`) but typed in TS — so renaming `lowerBound` breaks Python at *runtime*, not at parse. And the `.report.json` sidecar is mixed-convention (snake_case `wall_clock_s`, `rows_freed` beside camelCase config echo), so the freeze should declare it explicitly out of contract scope.

#### 1.4 Coverage reality

- **The TS side of the contract is exercised by no automated test whatsoever.** `experiment:export`/`experiment:import` run under `vitest.experiment.config.ts` (needs live Supabase + a surviving clone) and no CI job invokes them. Only Python's `test_schema.py`/`test_smoke.py` read the committed fixture. A TS parity test is **genuinely new coverage**, not a re-wiring.
- **One producer bypasses the single assembly path.** `src/_pages/plan-comparison/api/load-plan-analysis.ts:109-118` hand-builds a `GeneratorSnapshot` object literal server-side (`pins: []`). It is not covered by `assemble-snapshot.test.ts` and would drift silently from any assembly-side enforcement.
- **One committed fixture exists**, Python-side only: `poc/cp-sat/tests/fixtures/seed-plan-a.json` (101,412 bytes; 39 dp1 + 42 dp2 courses, 238 greedy placements, 0 availability cells). `.gitignore:84-93` documents why it is the deliberate exception: golden dumps are production-derived and must never be committable. **Any `contracts/` fixture must uphold the same UUID-only rule.**

#### 1.5 Recommended artifact mechanism

Four candidates were weighed against the two hard requirements (a *tech-neutral committed artifact*; *golden-fixture gating in both suites*):

| Approach | Verdict |
| --- | --- |
| **Hand-written JSON Schema + validators both sides** | **Recommended.** Tech-neutral by construction, lives in `contracts/` owned by neither side, and is the only option where the artifact *is* the contract rather than a derivative. Python adds `jsonschema>=4` (dev group — validation belongs in the test lane, not the solve hot path). TS validates with a small hand-written checker or a dev-only validator; note **no JSON-schema tooling exists in the repo today** (no ajv, no `zod-to-json-schema`). |
| Generate JSON Schema from a Zod schema | Attractive because `cohortSchema`/`placementWeekSchema`/etc. already exist (§1.1) and Zod is already the Actions-boundary convention (`lessons.md:19-24`). But it makes the artifact a **build product of the TS side**, which contradicts "owned by neither side" and adds a generator dependency + a drift check. Reasonable second choice if the plan wants a single source of truth in TS. |
| Generate Pydantic models from the artifact | Rejected. Would duplicate the frozen dataclasses and force a rewrite of `schema.py`, `builders.py`, and the `isinstance`-based `Term` checks in `model.py`/`objective.py`. |
| Parity-test only, no artifact | Rejected — the roadmap outcome explicitly requires a committed artifact in `contracts/`. |

Worth knowing regardless of choice: the camelCase↔snake_case key map is currently hand-written **three times** on the Python side alone (`schema.py:141-172` parse, `solve.py:298-304` emit, `test_schema.py:14-44` round-trip) with no mechanical link between them. That triplication is the strongest concrete argument for the artifact.

### 2. Where the artifact and its two tests must physically live

Verified against every gate config.

**`contracts/` at repo root works as-is** — no `.gitignore` change (`/poc/cp-sat/data/` is anchored and cannot leak), no `pnpm-workspace.yaml` change (no `packages:` key exists; the repo is a single root package), no steiger impact (`steiger src` only), no build impact.

Four mechanics that must be handled:

1. **`.prettierignore` must gain `contracts/`** (or `contracts/fixtures/`). `lefthook.yml:13-16` runs `prettier --write {staged_files}` on `*.{json,css,md}` with `stage_fixed: true`, so golden JSON is rewritten on every commit. Measured on the equivalent existing fixture: `JSON.stringify(dump, null, 2)` output at 3293 lines becomes 3088 under prettier (short arrays collapsed). CI would not catch the drift (`pnpm format` is not a CI step, and `prettier/prettier` doesn't apply to `.json`), so it silently breaks byte-comparison. `poc/` is in `.prettierignore:5` for exactly this reason.
2. **A test at `contracts/**/*.test.ts` runs nowhere.** `vitest.config.ts:27` collects `["src/**/*.test.ts", "bench/**/*.test.ts"]`; `:39` adds `src/**/*.test.tsx`. No root catch-all exists. **`bench/contract-parity.test.ts` is the recommended home** — inside the `pnpm test` glob, outside the FSD graph (steiger scans `src` only), precedent exists (`bench/auto-park.test.ts`, `bench/fixture-courses.test.ts` run today), and it sits beside `bench/export-snapshot.experiment.ts`, the format's producer. The `benchBoundaryConfig` import restriction (`eslint.config.js:92-139`) does not block `@/entities/timetable`. If the plan insists on `contracts/`, `vitest.config.ts:27` must be widened — otherwise green CI, zero coverage.
3. **Path resolution differs between the runners.** Vitest cwd is the repo root (house style: `join(process.cwd(), ...)`, per `src/_pages/plan-detail/api/parity.test.ts:28,41`). Pytest rootdir/cwd is `poc/cp-sat/` (`pyproject.toml:34-36`, and CLAUDE.md mandates running from the package dir), so a repo-relative string breaks there. The Python test must anchor on `__file__`: `Path(__file__).resolve().parents[3] / "contracts" / ...`. Convenient: after the planned `poc/cp-sat/` → `services/solver/` promotion the depth is unchanged, so `parents[3]` survives the move verbatim.
4. **`contracts/**/*.ts` is auto-enrolled in two gates.** `tsconfig.json` `include: ["**/*"]` means `pnpm check` type-checks it; `eslint .` lints it under `strictTypeChecked` + `prettier/prettier` (verified via `--print-config`). Free coverage, but `@typescript-eslint/no-unsafe-assignment` is an **error**, so `JSON.parse(readFileSync(...))` needs an explicit typed parse or guard. `.json` files are invisible to ESLint.

**The CI honesty gap.** `.github/workflows/ci.yml` has five jobs (`verify`, `integration`, `e2e`, `bench`, `deploy`), **no path filters anywhere**, and **no Python or `uv` step at all**. The TS parity test starts gating on merge the moment it lands (`verify` → `pnpm test`, `:32`). The Python parity test gates nothing until the FR-315 solver lane exists — which the roadmap assigns to S-302, two slices later. The plan must pick: pull a minimal Python lane forward into F-301 (contradicting the roadmap's "scope is deliberately minimal"), or ship the Python test as locally-gated and **record that the both-suites claim is CI-half-true until S-302**. Silently claiming the latter as the former is the failure mode to avoid.

Related: `mise.toml` is two lines today (`_.path` only) — no `[tools]` pins, no `[tasks]`. It orchestrates nothing yet, so it cannot currently carry a cross-ecosystem parity task.

### 3. `generation_jobs` — conventions the migration must follow

All verified against the 53 migrations and, for the grant posture, **live against the local stack** per `lessons.md:47-52`.

**Structure.** `<YYYYMMDDHHMMSS>_<snake_case>.sql` via `pnpm exec supabase migration new`. Every file opens with a `--` prose header stating what/why and explicitly whether GRANT/RLS changes are needed — a hard house style. No `begin;`/`commit;` (the CLI wraps each file). No `if not exists` on DDL. Strictly one concern per file.

**RLS.** There is **no ownership scoping anywhere in this repo** — no `auth.uid()` in `supabase/` or `src/`, and `plans` has no owner column. All 18 policies are the identical statement:

```sql
alter table generation_jobs enable row level security;
create policy "Authenticated users have full access" on generation_jobs
  for all to authenticated using (true) with check (true);
```

Isolation is structural (composite FKs pin children to their plan) plus deny-by-default route auth. **Do not invent a row predicate** — it would be a first for this repo. RLS is *not* on by default; the `enable` line is load-bearing (verified: a fresh table reports `relrowsecurity = false`).

**Grants — exactly one statement needed.** Live probe of a newly created table inside a rolled-back transaction:

```
PROBE anon          sel=false ins=false upd=false del=false
PROBE authenticated sel=true  ins=true  upd=true  del=true
PROBE service_role  sel=true  ins=true  upd=true  del=true
```

So DML defaults are already correct via `alter default privileges` (`20260617171048:14-16`, `20260618203532:22-24`, `20260617205628:17-19`). The house convention is still to pin the exclusion explicitly, as every table since the revoke does:

```sql
revoke select, insert, update, delete on generation_jobs from anon;
```

No `grant` statements. **One caveat to state honestly:** `anon` retains `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) on every table including new ones — the repo's revokes only ever name the four DML verbs. Pre-existing and consistent, but a plan claiming full anon exclusion would be repeating precisely the error `lessons.md:47-52` warns about.

**Type precedent.**

| Feature | Status |
| --- | --- |
| `uuid pk default gen_random_uuid()`, `timestamptz`, `created_at ... default now()` | Universal |
| `check` constraint for a status column | Precedent: `bundles_status_check check (status in ('placed','holding'))` on `text not null default 'placed'` (`20260624120000:21,25`) |
| `create type ... as enum` | 4 exist (`cohort`, `availability_severity`, `course_week_mode`, `placement_week`) — both approaches have precedent |
| Partial unique index | Exactly one: `bundles_cell_unique ... where day is not null` (`20260624120000:35-36`) — the direct precedent for one-active-job-per-plan |
| `text` hash column | Precedent: `course_groupings.catalog_hash` (`20260604141212`), indexed with `(plan_id, cohort, catalog_hash)` |
| **`jsonb` table column** | **First for this repo.** `jsonb` appears only as RPC parameters and plpgsql locals — worth an explicit callout in the migration header, matching house style |
| `updated_at` + `moddatetime` | On the 6 original tables only. **No table created since 2026-06-13 has one** (`teacher_availability`'s header: *"cells are replace-by-coordinate, not edited"*). A job row **is** mutated over its lifetime, so `generation_jobs` must deliberately re-adopt the trigger |
| FK `on delete` | Effectively always `cascade` (41 of 43); `set null` used twice, both on a since-dropped column |
| FK index discipline | Every FK column gets an index unless it leads a UNIQUE/PK — the Supabase `unindexed_foreign_keys` advisor is treated as a gate |

**Two hard constraints from adjacent systems.**

- **`plan_id uuid not null references plans(id) on delete cascade` is required for the test harness to keep working.** `src/test/factories/teardown.ts` deletes registered plan ids and relies on every domain table cascading from `plans.id`. A plan-less job row, or one referencing only the *proposal* plan, silently breaks isolation.
- **`security definer` is forbidden.** Every RPC in the repo is `security invoker` + `set search_path = ''`, and `apply_generated_placements:19-20` says so outright: *"Do NOT switch to DEFINER."* The credential design must not quietly reach for it.

**Generated types.** `src/shared/api/database.types.ts` is committed and **generated entirely by hand — no script, no CI drift check**. After the migration: `pnpm exec supabase db reset` then `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts`, then `pnpm check`. (Stale-path note: `.prettierignore` still lists the pre-FSD `src/lib/database.types.ts`, so the current file is not actually prettier-ignored — relevant if regen produces formatting churn.)

### 4. Forward-designed column set

Derived from every downstream slice. The "additive later?" column is factual, not a re-litigation of the forward-design decision — it tells the plan which columns are cheap to defer if it wants a smaller first migration.

| Column | Type | Driven by | Additive later? |
| --- | --- | --- | --- |
| `id` | `uuid pk default gen_random_uuid()` | F-301 | — |
| `plan_id` | `uuid not null references plans(id) on delete cascade` | F-301, teardown | no (FK + cascade) |
| `proposal_plan_id` | `uuid references plans(id)` | S-301 clone target | yes |
| `status` | `text not null default 'queued'` + check | F-301 | no (check widens later) |
| `policy` | `jsonb not null` | FR-302, S-307 | yes |
| `snapshot_hash` | `text not null` | FR-307 drift guard | no (see §7) |
| `error` | `text` | F-302 | yes |
| `created_at` / `updated_at` | `timestamptz not null default now()` + moddatetime | F-301 | trigger must ship with the table |
| `started_at` / `finished_at` | `timestamptz` | S-303 progress UI | yes |
| `stage_index` / `stage_name` | `smallint` / `text` | S-303 current stage | yes |
| `stages` | `jsonb not null default '[]'` | S-303 — array of `StageReport` | yes |
| `checkpoint` | `jsonb` | S-303/S-305 — latest complete board | yes |
| `checkpoint_stage_index` | `smallint` | S-305 ("names the stage being kept") | yes |
| `heartbeat_at` | `timestamptz` | S-304 activity renewal / staleness | yes |
| `stop_requested_at` | `timestamptz` | S-305 | yes |
| `delivery` / `delivered_plan_id` | `text` / `uuid` | S-306 drift-decided delivery | yes |
| `result` | `jsonb` | S-301 — the `GenerationResult` | yes |
| `notified_at` | `timestamptz` | S-310 | yes |

**Status vocabulary** (job-level, distinct from CP-SAT's): `queued`, `running`, `succeeded`, `failed`, `stopped` (S-305), `interrupted` (S-304). Keep it a `text` + check constraint rather than an enum — widening a check is a one-line migration, widening an enum in Postgres is not reversible in the same way, and `bundles` set the `text`+check precedent for exactly a status column.

**Indexes.**

```sql
create unique index generation_jobs_active_per_plan
  on generation_jobs (plan_id) where status in ('queued', 'running');   -- FR-308 one active job
create index generation_jobs_plan_idx on generation_jobs (plan_id);
create index generation_jobs_proposal_plan_idx on generation_jobs (proposal_plan_id);
```

**Two sizing decisions the plan must make explicitly.**

- **Where the snapshot lives.** Measured payloads: input dump **~101–124 KB**, `GenerationResult` **~35 KB**, per-stage checkpoint board **~35 KB**. If the dump is stored on the row, a job row is ~140 KB+ and **every 5–10 s poll must avoid `select *`** — a narrow poll projection becomes a correctness-adjacent requirement, not an optimization. The alternative is passing the dump in the F-302 `POST /solve` body and never persisting it, which keeps rows small but loses reproducibility of what was solved. This is genuinely undecided (see §8).
- **Checkpoint retention.** 10 stages × ~35 KB ≈ 350 KB per job if every stage's board is retained. Prefer a single `checkpoint` column overwritten per completed stage; the `stages` array keeps the cheap per-stage metadata.

### 5. What the solver can actually emit per stage

This constrains the checkpoint columns and is the finding most likely to be assumed wrong.

- **`StageReport` (`solve.py:42-49`) is the entire per-stage record**: `tier: int`, `name: str`, `status: str`, `best: int | None`, `bound: int | None`, `wall_clock_s: float`. It carries **no board**.
- **Per-stage incumbents are discarded today** — `_run_ladder` (`solve.py:310-349`) rebinds a local `incumbent` each iteration and `SolveResult` keeps only the final board. **Per-stage checkpointing is a new solver capability, not a plumbing change** (correctly assigned to S-303; F-301 only ships the columns it will write into).
- **Per-stage `best` values are upper bounds, not the board's objective tuple.** Hardening is `bundle.model.add(tier.var <= best)`, so a later stage may *improve* an earlier tier; `tests/test_solve.py:59-60` asserts exactly `scored[stage.tier-1] <= stage.best`. The full 10-tuple is **never held in memory during the ladder** — recovering it needs `evaluate_board(dump, board)` (`solve.py:127-140`), a fresh model build plus re-solve. So either the checkpoint stores upper bounds and the schema documents that, or checkpointing pays for a re-solve.
- **Stage sets vary by mode.** `solve_staged` and `solve_complete` emit 10 stages (but `solve_complete`'s stage 1 is named `completeness`, not `unplacedTotal`); **`solve_repair` emits tiers 1 and 4 only** — sparse and non-contiguous. **Never model the checkpoint as a fixed 10-element tuple**; use an array of `{tier, name, status, best, bound, wall_clock_s}` with nullable `best`/`bound`.
- **Two status vocabularies.** `StageReport.status` is the raw CP-SAT string (`OPTIMAL`/`FEASIBLE`/`INFEASIBLE`/`UNKNOWN`/`MODEL_INVALID`), distinct from the job-level status. Do not conflate them.
- **Casing.** `StageReport` fields and `SolveResult.notes` are snake_case (`wall_clock_s`, `rows_freed`) while the result wire is camelCase. Freezing the contract is the moment to normalize or explicitly scope the sidecar out.

The objective tier order, fixed and shared by both sides: `unplacedTotal, holes, totalSlots, teacherHoles, softHits, studentHoles, doublesDeficit, lateStarts, fridayTail, goldenBandDistance` (`objective.py`; parity pin `SEED_OBJECTIVE = (0, 0, 97, 223, 0, 1048, 316, 4, 38, 14)` at `tests/test_objective.py:23`).

### 6. The machine credential

#### 6.1 Current posture

One client factory, server-only: `src/shared/api/supabase.ts:6-25` wraps `createServerClient<Database>` reading `SUPABASE_URL`/`SUPABASE_KEY` from `astro:env/server`. The key is the **Publishable (anon)** key (`context/deployment/deploy-plan.md:19,85-86,140`). Every runtime query runs as `authenticated`, carried by the author's cookie session; RLS is live, never bypassed. `requireSession` (`src/shared/lib/actions/require-session.ts:8-12`) enforces the session per-handler because Actions POST to `/_actions/*`, which falls under the `/_` public middleware prefix.

**No privileged key exists in any runtime path.** Every `service_role` hit is test, bench, or ops tooling: `src/test/load-test-env.ts:29`, ~24 integration suites, seven `bench/` scripts, `scripts/provision-e2e-author.mjs:40-51`, and the CI ephemeral local stack. `wrangler.jsonc` has **no `vars` and no secret references** — secrets are set out-of-band via `wrangler secret put`. The decision of record is `deploy-plan.md:141`: *"Secret key NOT pushed — Publishable + cookie session is sufficient."*

**There is no existing code path a container could reuse.** Every write today is cookie-session-bound; the solver needs a genuinely new credential path.

#### 6.2 Options

The decisive constraint: `alter default privileges` grants **both** `authenticated` and `service_role` DML on every current and future public table, and every table's policy is `for all to authenticated using (true)`. So any credential resolving to either role reaches the **entire** database — contradicting the locked PII stance that names never reach the solver.

| # | Option | Least privilege | Ops complexity | Revocability | Repo fit |
| --- | --- | --- | --- | --- | --- |
| A | Legacy `service_role` JWT | ● full DB, bypasses RLS | ●●● | ● regenerating the JWT secret breaks everything | ● deprecated end-2026; contradicts `deploy-plan.md:141` |
| B | New named secret key (`sb_secret_solver`) | ● full DB, bypasses RLS | ●●● | ●●● revoke that key alone | ●● modern, but violates the locked stance |
| C | Custom role, JWT signed **inside the container** | ●● | ●● | ● | ● container holds a key that can mint `service_role` — worse than B |
| D | Custom role, short-lived JWT minted **by the Worker** | ●●● | ● TTL vs 20-min solves, WebCrypto signing, clock skew | ●● | ● puts a forge-anything secret in the Worker, reversing `deploy-plan.md:141` |
| **E** | **Machine Auth user + Custom Access Token Hook → custom PG role** | **●●●** | ●● one migration + hook + config | **●●●** password change / disable user | **●●●** reuses the provisioning-script pattern; container holds publishable key only |
| F | Machine Auth user on plain `authenticated` | ● no reduction | ●●● | ●●● | ● |

Platform facts confirmed against current Supabase docs: publishable/secret keys have replaced the legacy anon/service_role JWTs (legacy deprecated end-2026); the new keys **are not JWTs**; multiple named secret keys are supported specifically so each backend component can rotate independently; **secret keys cannot be scoped** to a table, schema, or role — they bypass RLS wholesale. Custom-role access goes through PostgREST's `role`-claim switch (`grant <role> to authenticator`), `bypassrls` is a role attribute that a custom role does not have, and the `apikey` and `Authorization: Bearer` headers are separate channels (a publishable key cannot travel in `Bearer`, a minted JWT cannot travel in `apikey`).

#### 6.3 Recommended design — and what is not yet verified

**Option E.** A dedicated `solver_job_writer` role, reached by a machine Auth user whose access token carries that role via a Custom Access Token Hook. The container holds only `SUPABASE_URL`, the **publishable** key, and a machine-user password — no secret key, no JWT secret, no signing key — and can be implemented with `httpx` alone, which matters given the ortools/protobuf pinning on that venv.

```sql
create role solver_job_writer nologin;
grant solver_job_writer to authenticator;
grant usage on schema public to solver_job_writer;
grant select, update on public.generation_jobs to solver_job_writer;
-- deliberately NO insert (the Worker enqueues), NO delete, NO grants on any other table,
-- NO bypassrls, and NO alter default privileges (future tables must stay unreachable)

create policy "Solver reads its jobs" on generation_jobs
  for select to solver_job_writer using (true);
create policy "Solver updates non-terminal jobs" on generation_jobs
  for update to solver_job_writer
  using (status in ('queued', 'running'))
  with check (status in ('running', 'succeeded', 'failed', 'interrupted'));
```

The password lives in **container config, not the Worker** — matching `tech-stack.md`'s posture and preserving `deploy-plan.md:141`.

**The failure mode to guard.** If the hook is disabled or misconfigured, the machine user silently falls back to `role: authenticated` — which, given the default-privilege grants and the `using (true)` policy on every table, is a **silent escalation to full database access**. Guard it with an integration test that signs in as the machine user and asserts (a) the decoded token's `role` claim is `solver_job_writer` and (b) `select` on `plans` is denied — and prove the posture with `has_table_privilege`, per `lessons.md:47-52`.

**Six assumptions that are NOT verified and want a local spike before the plan commits:**

1. Custom role in the `role` claim for the **Data API** specifically — confirmed for Storage and as the general PostgREST mechanism, but Supabase's JWT-claims reference lists only `anon`/`authenticated`/`service_role`.
2. Whether enabling the Custom Access Token Hook travels through `supabase db push`, needs `supabase config push`, or is dashboard-only (the last would conflict with the repo's "no dashboard-only config" stance).
3. Whether the hook fires on the **refresh-token** grant, not just the password grant — load-bearing because solves run ~20 min against a default 1 h expiry.
4. Whether a `nologin` role works as a JWT `role` target.
5. Whether Supabase applies any allowlist to the `role` claim beyond "must be a real role granted to `authenticator`".
6. Whether policies for a custom role compose as expected alongside the existing `to authenticated` policy.

**Fallback.** Option B (a named `sb_secret_solver` key) is the honest second choice — trivially revocable and modern — but it must be recorded as an *accepted least-privilege exception* in the change doc, not glossed, because it grants the container the entire database.

**Two stale docs found in passing**, worth fixing while this change is open: `context/foundation/infrastructure.md:71,73,97` still instructs `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` for production, contradicting `deploy-plan.md:141`; and `README.md`'s required-secrets table lists `SUPABASE_URL`/`SUPABASE_KEY` as repo secrets that no CI job reads.

### 7. The drift question F-301 must answer to ship the right column

FR-307 makes delivery depend on "did the source plan change since the solved snapshot". Two hash implementations already exist, and **neither answers that question**:

- `computeCatalogHash` (`src/shared/lib/catalog-hash/compute-catalog-hash.ts:13-27`) — SHA-256 over a sorted projection of `{id, teacherKeys, hours, studentKeys, weekMode}`. It digests **plan-local UUIDs**, which `clone_plan` re-mints on every copy, so *a plan and its own clone hash differently*. Stored as `course_groupings.catalog_hash`. It answers "has THIS plan's catalog changed since its groupings were computed?"
- `computeCatalogFingerprint` (`src/_pages/plan-comparison/model/catalog-fingerprint.ts:23-27`) — content-addressed over **natural keys** for cross-plan equivalence. Its docblock states the distinction explicitly.

Neither digests the **board** (placements), and FR-307's drift includes the author moving placements during the solve. The bench drift guard `assertCatalogMatches` is a **local function inside the experiment** (`bench/import-generated.experiment.ts:109-120`), not a shared lib — promoting it is real work (S-306's), but the **column shape it needs is F-301's to ship**. The plan must decide what `snapshot_hash` actually digests: catalog only, catalog + board, or a snapshot-content hash over the serialized `GeneratorSnapshot` — and, because the solve runs against a *clone*, which plan's identity it is computed over.

This is the one place where a wrong F-301 decision forces a non-additive migration later.

## Code References

**Contract — TS**
- `src/entities/timetable/model/generation/types.ts:16-108` — the whole contract surface + the `GeneratePlan` port
- `src/entities/timetable/model/generation/assemble-snapshot.ts:33-60` — the single assembly path; `toPin` field pick
- `src/entities/timetable/model/generation/run.ts:12-31` — `runVerifiedGeneration`, the seam the job pipeline relocates
- `src/entities/timetable/model/generation/verify.ts:51-129` — the oracle; what it does and does not read
- `src/entities/timetable/model/generation/engines/greedy/search.ts:320-346` — the TS producer of `GenerationDiagnostics`
- `src/_pages/plan-comparison/api/load-plan-analysis.ts:109-118` — the producer that bypasses `assembleGeneratorSnapshot`
- `bench/export-snapshot.experiment.ts:51-63,117-132` — the `ExportDump` envelope, `formatVersion: 1`, the only writer
- `bench/import-generated.experiment.ts:34-37,56-57,109-120` — unvalidated `as` casts; the local drift guard

**Contract — Python**
- `poc/cp-sat/src/cpsat_engine/schema.py:18,55-62,92-123,141-172` — `FORMAT_VERSION`, `Pin`, `Dump`, the gate, the hand-written key map
- `poc/cp-sat/src/cpsat_engine/solve.py:42-64,267-304,310-349` — `StageReport`, `SolveResult`, `to_generation_result`, the ladder
- `poc/cp-sat/tests/test_objective.py:23,49-53` — the parity pin and the gitignored-golden skipif
- `poc/cp-sat/tests/fixtures/seed-plan-a.json` — the only committed fixture (101,412 bytes)
- `poc/cp-sat/pyproject.toml:34-36` — pytest rootdir/`pythonpath`; no mypy section

**Gates**
- `vitest.config.ts:27,39` — the include globs that exclude `contracts/`
- `.prettierignore:1-5` — why `poc/` is listed, and what `contracts/` needs
- `lefthook.yml:13-16` — the `stage_fixed: true` format job that rewrites JSON
- `tsconfig.json` `include: ["**/*"]` — why `contracts/**/*.ts` is type-checked
- `.github/workflows/ci.yml:20-133` — five jobs, no path filters, no Python
- `eslint.config.js:92-139,159-170` — bench import boundary; ignores

**Database**
- `supabase/migrations/20260624120000_bundles.sql` — the closest structural template (status check, nullable coords, partial unique index, anon revoke)
- `supabase/migrations/20260617205628_revoke_anon_table_access.sql:17-19` — the revoke side of the least-privilege lesson
- `supabase/migrations/20260618203532_grant_service_role_table_access.sql:22-24` — why service_role reaches everything
- `supabase/migrations/20260711174905_clone_plan_include_board.sql` — latest live `clone_plan`; returns the new plan uuid
- `supabase/migrations/20260711202237_apply_generated_placements.sql:19-30` — `security invoker` + "Do NOT switch to DEFINER"
- `supabase/migrations/20260604141212_course_groupings_catalog_hash.sql` — the `text` hash-column precedent
- `src/test/factories/teardown.ts` — the plan-rooted cascade that constrains `plan_id`

**Credential**
- `src/shared/api/supabase.ts:6-25`, `src/shared/lib/actions/require-session.ts:8-12`, `src/middleware.ts:7-42`
- `context/deployment/deploy-plan.md:122-144` — narrow-token posture; the "secret key NOT pushed" decision of record

## Architecture Insights

- **Freezing a contract is a decision act, not a documentation act.** Both sides are internally consistent and disagree in eight places (§1.3). The artifact's value is not that it records the shape — it is that writing it forces those eight decisions to be made once, in the open, instead of being rediscovered as bugs at the S-301 integration.
- **The wire's PII posture is upheld by type absence, not by a check.** `GroupingCourse` simply has no display fields, and `toWireCourse` projects down to it. That is elegant but invisible; a schema with `additionalProperties: false` converts an implicit guarantee into an enforced one — arguably the single biggest safety win of the artifact.
- **The repo's gate topology already has an "outside FSD, inside CI" slot, and `bench/` is it.** `bench/**/*.test.ts` is collected by `pnpm test`, exempt from steiger, and governed by a deliberate import-boundary rule. The contract parity test wants exactly those properties. Inventing `contracts/**/*.test.ts` would mean widening a config to recreate a slot that already exists.
- **Two locks, two layers — and the default-privileges rule is what makes the credential question hard.** GRANT controls reachability, RLS controls rows (`lessons.md:47-52`). The repo applied `alter default privileges` to *future* tables for `authenticated` and `service_role`, which is convenient for the app and precisely why the solver cannot safely be either. The narrow role is not paranoia; it is the only way to make "the solver sees UUIDs only" a property of the database rather than of the code that happens to query it.
- **Quality accrues monotonically, but the *record* of it does not.** The ladder hardens `tier_k <= best_k`, so per-stage `best` values are upper bounds and a later stage can improve an earlier tier. Any UI that shows "stage 6 achieved teacherHoles = 95" is showing a bound, not a measurement, unless a re-solve pays for the true tuple. That is a product-honesty question S-303 inherits from the column shape F-301 picks.
- **`mise` is still a stub.** It is designated as the cross-ecosystem orchestrator by three foundation docs, but the file is two lines with no `[tools]` and no `[tasks]`. Any plan that assumes `mise run verify` composes the JS and Python gates is assuming machinery that does not exist yet.

## Historical Context (from prior changes)

- `context/changes/post-poc-cp-sat-refactoring-plan/research.md:192-194` — the original Phase 2 sketch this change realizes; `:265` records the credential question that §6 resolves
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md:390-428` — the follow-up that locked `contracts/` as a tech-neutral top-level directory, and the app staying at repo root
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md:316,321` — the one-active-job-per-plan partial index and the `proposal_plan_id` linkage, first proposed there
- `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md:60-95` — the objective tuple, the per-stage ladder table (statuses, bests, bounds), and the "solve result is only meaningful against the exact snapshot it was produced from" finding that `snapshot_hash` encodes
- `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md:196-204` — non-determinism and the solve-to-target recommendation behind the `policy` column
- `context/foundation/lessons.md:47-52` — "granting a role is not excluding the others"; the live-verification discipline §3 followed
- `context/foundation/lessons.md:54-59` — `astro check` is the only type gate; relevant because `contracts/**/*.ts` lands inside it automatically
- `context/foundation/stack-assessment.md:88-94` — solver type-safety recorded as the one failed gate (no mypy today), which CLAUDE.md nonetheless describes as the enforcement gate
- `context/deployment/deploy-plan.md:139-144` — the Worker-holds-only-publishable decision the credential design must not reverse

## Related Research

- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` — the parent migration research (platform, architecture, monorepo, five follow-ups)
- `context/archive/2026-07-15-poc-cp-sat-backend-service/research.md` — POC feasibility and encoding inventory
- `context/archive/2026-07-12-generation-engine-refactor/change.md` — the engine-agnostic seams the contract formalizes

## Follow-up 2026-08-10T14:20+02:00 — custom-role spike + all six open questions resolved

### The spike (resolves Open Question 4)

Run against the local Supabase stack at commit `9fc944a`: a scratch role `spike_writer nologin` granted to `authenticator`, a scratch table `_spike_jobs` with the two-policy shape proposed in §6.3, and a hand-minted HS256 JWT carrying `role: spike_writer`. Both the table and the role were dropped afterwards and the removal verified.

| # | Probe | Result |
| --- | --- | --- |
| 1 | Custom role `SELECT` on its own table | `200` + row |
| 2 | Custom role `SELECT` on `plans` | `403` `permission denied for table plans` |
| 3 | `UPDATE` inside the policy (`queued`→`running`) | `204` |
| 4 | `UPDATE` violating the `with check` | `403` `new row violates row-level security policy` |
| 5 | `INSERT` (deliberately not granted) | `403` `permission denied` |
| 6 | `DELETE` (deliberately not granted) | `403` `permission denied` |
| 7 | Unknown role claim | `401` `role "..." does not exist` |
| 8 | Same request as `role: authenticated` (the fallback) | `200` + real plan names |

**Verified as fact** (previously assumptions 1, 4, 5, 6): a `nologin` custom role works as a PostgREST `role`-claim target on the **Data API**, not just Storage; RLS applies normally to it (`bypassrls` is absent, and both `using` and `with check` are enforced); grant-layer exclusion holds independently of RLS; the new policies compose alongside the existing `to authenticated` policy without interference; and there is no allowlist beyond "must be a real Postgres role granted to `authenticator`" — an unknown role **fails closed**.

**Assumption 2 resolved by config inspection**: `supabase/config.toml:269-272` already carries a commented `[auth.hook.custom_access_token]` block (`enabled`, `uri = "pg-functions://<database>/<schema>/<hook_name>"`), and `supabase config push` exists in the CLI. **Hook enablement is repo-declared, not dashboard-only** — it satisfies `infrastructure.md`'s no-dashboard-config stance and travels with the change.

**Assumption 3 designed around rather than resolved**: whether the hook fires on the *refresh* grant is now moot — the container should re-run the password grant when its token nears expiry instead of refreshing. A single ~20-minute solve needs one token, and the password grant demonstrably fires the hook.

**Probe 8 makes the guard test non-optional.** A hook misfire silently downgrades the machine user to `authenticated`, which returned real plan names — full read of the database. The integration test asserting (a) the decoded `role` claim and (b) `permission denied` on `plans` is what converts that from a silent escalation into a red build.

### Resolutions

1. **`snapshot_hash` digests the canonically-serialized `GeneratorSnapshot`, assembled from the SOURCE plan at T0.** The question collapses once the comparison is framed correctly: drift is *source-at-T0 vs source-at-T1*, a same-plan/over-time comparison in which `clone_plan`'s UUID re-minting never arises. So assemble the snapshot from the source at T0, hash it, store it; re-assemble the source at T1 and compare. Two assemblies, both pure functions over already-loaded data. Hash the **snapshot**, not the catalog: it covers grid dims, availability, finishes-early flags, catalog *and* the board (pins), which is exactly the solve's input set by definition — the snapshot *is* the engine argument. Catalog-only would miss the author moving a placement mid-solve, after which auto-apply would silently overwrite their edit. It is also narrower than plan-content in the useful direction (a course rename won't false-positive). **This shares its canonicalization with contract divergence #8 (§1.3) — one decision, two consumers.** Reuse the proven edge-safe shape from `compute-catalog-hash.ts:13-27` (explicit field allow-list → sort → `TextEncoder` → SHA-256 → hex).
2. **The dump is stored on the job row as `jsonb`.** The deciding argument is correctness, not debuggability: FR-313 runs the oracle server-side at delivery, and `verifyGeneration` needs *the exact snapshot the result was produced against* — re-assembling from the clone at T1 reintroduces precisely the hazard the POC recorded ("a solve result is only meaningful against the exact snapshot it was produced from"). Postgres TOASTs `jsonb` over ~2 KB out-of-line, so a narrow `select id,status,stage_index,...` never reads it. **Pin the poll projection explicitly** — PostgREST's `.select()` with no arguments returns every column, which would pull ~124 KB per poll. State this in the migration header.
3. **A minimal Python CI lane ships with F-301** (author's call). A ~12-line `solver` job (`setup-uv` + `uv run pytest`) joins `ci.yml` and `deploy.needs`, making the "gated in both suites" claim true on day one. Ruff, `mypy --strict`, and `dorny/paths-filter` stay with S-302/FR-315. This follows `CLAUDE.md`'s standing instruction to wire the gate up rather than skip it when touching solver tooling early. Note there are no path filters in `ci.yml` today, so the job runs on every push; the suite is 40 tests and runs in parallel with the stack-booting jobs that dominate wall-clock.
4. **Resolved by the spike above.** Proceed with Option E; the named-secret-key fallback is no longer needed.
5. **`text` + check constraint, with the full vocabulary declared on day one**: `queued`, `running`, `succeeded`, `failed`, `stopped`, `interrupted`. The four existing enums are closed *domain* vocabularies (cohort, week, severity); job status is an evolving *operational* one that S-304 and S-305 will extend. Widening a check is one line; Postgres enum values cannot be removed or reordered. Declaring the full set costs nothing and means those two slices need no migration at all.
6. **The `.report.json` sidecar is out of contract scope; `StageReport` is in.** The sidecar is written by `cli.py`, the acknowledged throwaway, and the F-302 HTTP wrapper will not produce it. `StageReport` is different — it lands in the `stages jsonb` column and is read by the S-303 progress UI, so it is part of the frozen surface and its snake_case fields (`wall_clock_s`) normalize to camelCase with the rest of the wire. State **both halves** in the artifact so the sidecar is not later "discovered" and frozen by mistake.

### One correction to §4 arising from these

`proposal_plan_id` must be **`on delete set null`, not `on delete cascade`** — a deliberate deviation from the repo's dominant convention. S-306 deletes the working clone on auto-apply; a cascading FK would take the job row with it and erase the record of every successful job. Call the deviation out in the migration header, since 41 of 43 FKs cascade.

## Open Questions

All six are resolved above. Two items carry forward as plan-phase obligations rather than open questions:

- **The hook-misfire guard test is load-bearing, not optional** — probe 8 showed the fallback is a silent full-database escalation. It belongs in F-301's definition of done, and must prove the posture with `has_table_privilege` per `lessons.md:47-52`.
- **The `anon` `Dxtm` residue** (§3) is pre-existing and inherited by `generation_jobs`. Either revoke it for this table or do not claim full anon exclusion in the migration comment — the lesson is specifically about comments that overstate the grant-layer posture.
