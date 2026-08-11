---
change_id: solver-contract-and-jobs-schema
title: Frozen wire-contract artifact + generation_jobs schema (F-301)
status: archived
created: 2026-08-10
updated: 2026-08-11
archived_at: 2026-08-11T07:01:51Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Implementation review (2026-08-11)

`reviews/impl-review.md` — NEEDS ATTENTION, 0 critical / 3 warnings / 3 observations. Five fixed
during triage, one skipped:

- **F1** Python had no result-side canonicalizer (`placements`/`unplaced` sorts existed only in TS)
  and `contracts/README.md` claimed otherwise → added `wire_result`/`canonical_result_json`; the
  result-golden test now round-trips through it, so the 238-placement golden byte-proves the sort
  cross-language.
- **F2** `grant select, update` was table-wide, so the container could rewrite `snapshot`/
  `snapshot_hash` (its own T0 drift baseline) and the `delivery` fields on any live job — the RLS
  window is open for a job's whole run. Confirmed live, then column-scoped to the eleven progress
  columns and pinned with a new `has_column_privilege` probe.
- **F3 (skipped)** Four declared sorts — `availability`, `finishesEarlyByCourseId`,
  `parkedCourseIds`, `unplaced` — are empty in the goldens, so they are unit-tested per side but
  never byte-agreed across languages. Unreachable without new seed data or re-exporting the frozen
  parity fixture; revisit if a dense fixture ever gets cheap.
- **F4** policy renamed `"Solver reads any job"` (`using (true)` reads every row).
- **F5** canonical form gains a raw-UTF-8 rule (both suites) and `allow_nan=False`.
- **F6** `uv run ruff check` added to the `solver` CI job; mypy still waits for S-302.

Disproven and recorded so it is not re-raised: `create role` without `if not exists` does NOT break
the local loop — the Supabase CLI drops custom roles on `db reset` (verified on a machine where the
role already existed).

### Still open at implementation close

- ~~**Progress 2.3**~~ — **closed** on PR #111, run 31430776483: all five jobs green. The first run
  failed at job setup because `astral-sh/setup-uv` publishes moving major tags only through `v7`, so
  `@v9` was unresolvable; pinned to `@v9.0.0` in `93f39da`.
- **The solver lane's interpreter was unpinned** — CI resolved the runner's system CPython **3.12.3**
  while local dev ran 3.13.x, because `requires-python = ">=3.12"` constrains nothing further. Fixed
  in `d6d0e05` with `poc/cp-sat/.python-version`.
- **The two `DeprecationWarning`s in the solver job are NOT ours and are not fixed by that pin.**
  First hypothesis (they track the Python minor) was wrong: after pinning, CI runs 3.13.15 and still
  reports them. Established by direct probe — `~True` warns on 3.14.4 and on CI's interpreters, and
  does not warn on the local 3.13.12 — so `Bitwise inversion '~' on bool` was backported into recent
  CPython **patch** releases and its presence tracks the interpreter build. The emitting code runs at
  import time inside a dependency (`<frozen importlib._bootstrap>` frame; swallowed when escalated to
  an error, i.e. a guarded import in ortools' loader). Our own `~` uses are cp_model `BoolVar`
  negation at solve time. Forward-compat notice only; the fix is upstream.
- **In CI the suite reports `52 passed, 1 skipped`.** The skip is `test_golden_dump_parity_is_exact`,
  gated on a gitignored production-derived dump — pre-existing and by design. The 10/10 objective
  parity that runs in CI is `test_seed_greedy_board_parity_is_exact` over the committed seed fixture.
- **Every `#### Manual` row is unchecked**, per the implement skill (manual rows are the human's to
  sign off). Six of the seven were nonetheless executed mechanically during the run and their
  evidence is in the session; `4.5` (runbook executability) is a judgement call.

### Adaptations made during implementation

- `wire.ts` also exports `canonicalizeResult` and a `WireSnapshot`/`WirePin` type pair. The plan
  listed three exports, but _something_ had to apply the result-side array sorts the canonical form
  declares, and typing the golden parses honestly needed the narrow-pin type (the wire snapshot is
  not a `GeneratorSnapshot` — its pins have four fields). `GeneratorSnapshot` is assignable to
  `WireSnapshot`, so every entry point still accepts the in-app type.
- Two prettier-ignore fixes the plan flagged but did not schedule: `database.types.ts` was listed at
  its stale pre-FSD path (so prettier had been rewriting the generated file, making every regen a
  whole-file diff), and `pnpm-lock.yaml` was unlisted (so `pnpm format` and `pnpm add` fought over
  ~9k lines of quoting). Both are now ignored; the p3 regen diff is +100 lines of schema and nothing else.
- The `generation_jobs` posture test asserts a _subset_ for `authenticated`/`service_role` rather than
  set equality: Supabase's auto-grant leaves those two holding TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on
  every public table. That residue is repo-wide and pre-existing; F-301 narrows it only for `anon`,
  where it made a migration comment false. Recorded in the test rather than silently accommodated.
- `test_solve.py`'s import-shape pin required `lowerBound` to be present; the frozen contract omits an
  absent optional, so the assertion now pins the omission instead.
