---
change_id: solver-contract-and-jobs-schema
title: Frozen wire-contract artifact + generation_jobs schema (F-301)
status: implemented
created: 2026-08-10
updated: 2026-08-10
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Still open at implementation close

- ~~**Progress 2.3**~~ — **closed** on PR #111, run 31430776483: all five jobs green. The first run
  failed at job setup because `astral-sh/setup-uv` publishes moving major tags only through `v7`, so
  `@v9` was unresolvable; pinned to `@v9.0.0` in `93f39da`.
- **The solver lane's interpreter is unpinned.** CI resolved the runner's system CPython **3.12.3**
  while local dev runs 3.13.x — `requires-python = ">=3.12"` constrains nothing further. Harmless so
  far (53/53 either way) but visible: two dependency-internal `DeprecationWarning`s appear on 3.12 and
  not on 3.13. For a package whose premise is a tightly-pinned dedicated venv, a `.python-version`
  belongs here; deferred to the S-302/FR-315 solver lane unless picked up sooner.
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
