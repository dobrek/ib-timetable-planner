<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Frozen Wire Contract + `generation_jobs` + Solver Credential (F-301)

- **Plan**: `context/changes/solver-contract-and-jobs-schema/plan.md`
- **Scope**: Phases 1–5 (all)
- **Date**: 2026-08-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations
- **Triage**: 5 fixed, 1 skipped (F3) — see per-finding decisions

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Automated criteria — re-verified

All green: `pnpm test` 1555/1555 · `pnpm check` 0 errors · `pnpm lint` clean · `pnpm steiger` clean ·
`pnpm format && git diff contracts/` untouched · `uv run pytest` 53 passed · `uv run ruff check` clean ·
`supabase db reset` clean · `pnpm test:integration` 129/129 · CI run 31431929218 — `verify`, `integration`,
`e2e`, `solver` all green; the only red job is `bench`, deliberately outside `deploy.needs` (greedy landed
dp2 = 48 vs bar 47 — documented runner variance).

Scope discipline: all eight "NOT doing" bullets hold. `solve.py`'s diff is only `to_generation_result`;
modeling/objective and `seed-plan-a.json` untouched. Every unplanned file is necessary support with a
`change.md` rationale that matches the actual diff.

Disproven during review (recorded so it is not re-raised): `create role solver_job_writer nologin` without
`if not exists` is safe — the role already existed at cluster level and `supabase db reset` still applied the
migration cleanly, so the CLI drops custom roles on reset. The access-token hook is correct on every probe:
`set search_path = ''`, reads `app_metadata` (admin-writable only), strict-equality allowlist, `execute`
revoked from `public`/`anon`/`authenticated`, malformed event passes through rather than erroring.

## Findings

### F1 — Python canonicalizer implements 5 of the 7 declared array sorts

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `poc/cp-sat/src/cpsat_engine/wire.py:36-38`; `contracts/README.md:106-109`
- **Detail**: The plan (Phase 2 §1) specifies wire.py's canonicalizers match the README spec "byte-for-byte
  (…declared array sorts…)". `canonical_json` applies no array sorting, and there is no Python result
  canonicalizer — `placements` by (cohort, courseId, day, period, week) and `unplaced` by courseId have no
  Python implementation anywhere; TS has both (`wire.ts:128,160-162`). `README.md:106-109` states the Python
  module is "json.dumps(...) plus the same array sorts", which is untrue for the result side. Latent today
  (only the snapshot is hashed; the result golden is TS-produced by design), live the moment F-302 hashes a
  result or regenerates that golden from Python.
- **Fix A ⭐ Recommended**: Add `wire_result`/`canonical_result_json` to wire.py mirroring `wire.ts:127-164`,
  plus a pytest case sorting a deliberately-unsorted synthetic result.
  - Strength: Makes "one canonical form, two implementations" true rather than true-for-the-snapshot-only.
  - Tradeoff: ~25 lines of Python nothing calls yet.
  - Confidence: HIGH — the TS implementation is the spec to mirror; goldens pin the target bytes.
  - Blind spot: None significant.
- **Fix B**: Amend `contracts/README.md` to state result canonicalization is TS-only.
  - Strength: Zero code; documents the real posture honestly.
  - Tradeoff: Leaves F-302 to discover the gap; `canonical_json(to_generation_result(...))` still silently
    returns non-canonical bytes.
  - Confidence: MEDIUM — depends on F-302 never hashing a result.
  - Blind spot: Haven't traced whether S-303's result write path is Python-side or Worker-side.
- **Decision**: FIXED via Fix A — `wire_result` / `canonical_result_json` added to `wire.py`; `test_result_golden_is_already_canonical` renamed and rerouted through `canonical_result_json` so the 238-placement golden byte-proves the sort cross-language; a new order-invariance test covers `placements` + `unplaced`; `contracts/README.md` corrected and given a split-of-responsibility note. pytest 54→56 passed.

### F2 — Solver role can rewrite solve inputs and delivery fields on any live job

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260810200931_solver_job_writer_role.sql:42`
- **Detail**: `grant select, update on public.generation_jobs` is table-wide. The header enumerates what is
  deliberately not granted (INSERT, DELETE, other tables, BYPASSRLS, default privileges) but never addresses
  column reach. Confirmed live: as `solver_job_writer`, an UPDATE on a `running` job rewrote `snapshot`,
  `snapshot_hash`, `delivery` and `proposal_plan_id` (`UPDATE 1`, values changed). The WITH CHECK blocks this
  while the row is `queued`, but `running` is the state the solver occupies for its whole run.
  `snapshot`/`snapshot_hash` are the drift-detection inputs; `delivery`/`delivered_plan_id` are what S-306's
  auto-apply reads. The guard test's `has_table_privilege(...)).toEqual(["SELECT","UPDATE"])` passes under a
  column-scoped grant too, so it neither blocks the fix nor proves the current reach. The plan itself
  specified `grant select, update` — a plan-level gap, not implementation drift.
- **Fix A ⭐ Recommended**: Column-scope the grant to the solver-written columns (status, result, error,
  started_at, finished_at, heartbeat_at, stage_index, stage_name, stages, checkpoint,
  checkpoint_stage_index) and add `has_column_privilege` assertions proving `snapshot` and
  `delivered_plan_id` are denied.
  - Strength: Makes the file's least-privilege framing structurally true; S-303's writer isn't built yet.
  - Tradeoff: A future solver-written column needs a grant migration — arguably the point.
  - Confidence: HIGH — additive migration; the existing guard test keeps passing unchanged.
  - Blind spot: Haven't confirmed S-305's stop-acknowledge path writes only `status`/`finished_at`.
- **Fix B**: Keep the table-wide grant; state the column reach in the header's "not granted" list.
  - Strength: No migration; the header stops implying a narrowness it doesn't have.
  - Tradeoff: Accepts that a compromised or buggy container can corrupt any live job's drift baseline.
  - Confidence: MEDIUM — fine while the container doesn't exist; changes when F-302 ships it.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — UPDATE is now COLUMN-scoped to the eleven progress columns (`grant update (...)`); `heldColumnPrivileges` added to `src/test/postgres-client.ts`; the guard test pins the exact writable column set and that SELECT still reaches `snapshot`. The table-level probe now reads `["SELECT"]` — proof no table-wide UPDATE exists. Live re-probe: the snapshot forge returns `permission denied`, the legitimate progress write still returns `UPDATE 1`. Runbook diagram + prose updated to three locks.

### F3 — Four of seven declared sorts are unexercised by the goldens

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `contracts/fixtures/generator-snapshot.json`, `contracts/fixtures/generation-result.json`
- **Detail**: Measured directly: `availability` = 0, `finishesEarlyByCourseId` = 0, `parkedCourseIds` = 0 in
  both cohorts, `unplaced` = 0 in both cohorts. The cross-language byte-parity gate therefore demonstrates
  agreement only on `courses`, `teacherKeys`, `studentKeys` and `pins`. The availability tuple sort and the
  parked-multiset rule are asserted by each side in isolation, never against each other. Combined with F1,
  this is how the result-sort gap stayed invisible to both suites.
- **Fix**: Regenerate the snapshot golden from a seed plan carrying teacher availability, finishes-early
  flags and parked courses — bilaterally, both suites green in one commit per the README's rule.
  - Strength: Turns four declared sorts from "each side believes it" into "both sides byte-agree", using the
    regeneration path this change already shipped (`pnpm experiment:goldens`).
  - Tradeoff: Needs a seed source with non-empty availability/parked — possibly a fixture change.
  - Confidence: MEDIUM — the script exists and is documented; the input data is the unknown.
  - Blind spot: Haven't checked whether the committed seed dump has a plan with non-empty availability.
- **Decision**: SKIPPED — the literal fix is unreachable: the seed has zero `teacher_availability` rows and zero finishes-early courses, so no existing plan produces those arrays; covering them would mean changing `data/*.csv` + `seed.sql`, or re-exporting `seed-plan-a.json` (the parity suite's frozen fixture). Each side keeps unit-testing these sorts in isolation. Worth revisiting if a dense fixture is ever cheap.

### F4 — Policy named "Solver reads its jobs" reads every job

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `supabase/migrations/20260810200931_solver_job_writer_role.sql:46`
- **Detail**: The predicate is `using (true)` — the role reads every job row including every other plan's
  snapshot/result/policy. The file's framing is least privilege throughout, and `lessons.md`'s grant-honesty
  rule is specifically about names/comments that overstate posture. The runbook already states it honestly.
- **Fix**: Rename to "Solver reads any job" and note the deliberate widening (no per-job binding until S-301).
- **Decision**: FIXED — policy renamed to `"Solver reads any job"` with the deliberate widening (no per-job binding until S-301) stated in the file. No code referenced the old name.

### F5 — Two cross-language divergence risks left unpinned

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `contracts/README.md:76-78`; `poc/cp-sat/src/cpsat_engine/wire.py:38`
- **Detail**: (a) `wire.py:38` passes `ensure_ascii=False` and its docstring calls it load-bearing, but the
  README's canonical-form rules never state it — rule 2 covers non-ASCII *keys* only, while the schema
  permits any string for `courseId`/`teacherKey`. A reimplementation from the README emits `\uXXXX` where JS
  emits raw UTF-8: a silent `snapshot_hash` split. (b) `canonical_json` omits `allow_nan=False`, so a stray
  non-finite emits the bare token `NaN` — unparseable JSON — where `JSON.stringify` emits `null`. Both
  goldens are ASCII and float-free today, so nothing is broken.
- **Fix**: Add "raw UTF-8, never `\uXXXX` escapes" as a numbered README rule with a non-ASCII case in both
  suites, and pass `allow_nan=False`.
- **Decision**: FIXED — README gains rule 3 (raw UTF-8, never `\uXXXX`) and a non-finite clause on rule 6 (renumbered 4/5/6); `canonical_json` now passes `allow_nan=False`; both suites pin the UTF-8 rule and pytest pins the `ValueError` on non-finite.

### F6 — mypy/ruff absent from the new solver CI lane

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `.github/workflows/ci.yml:89-118`
- **Detail**: CLAUDE.md: "`mypy --strict` is the enforcement gate… if you touch solver tooling before then,
  wire it up rather than skipping it." This change added a Python CI job and a dev dependency, and defers
  both ruff and mypy to S-302 — the plan says so and ci.yml documents it, so the implementation is
  plan-conformant while the standing repo rule points the other way. `ruff` is already in the dev group and
  passes; mypy is not installed, so the gate cannot run at all. `wire_stage_report` returns
  `_without_nones(...)` (declared `-> Any`), which `--warn-return-any` would flag once the gate exists.
- **Fix**: Add `- run: uv run ruff check` to the solver job now (zero new deps); leave mypy to S-302.
- **Decision**: FIXED — `uv run ruff check` added to the `solver` CI job (zero new deps); the job comment now records why mypy still waits for S-302 (not installed; the lane that owns it adds the dep).
