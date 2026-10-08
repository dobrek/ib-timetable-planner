<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Greedy Retirement (S-309)

- **Plan**: context/changes/greedy-retirement/plan.md
- **Scope**: All 5 phases (full plan; 5.8 "merge only when no production solve is running" is pending by nature)
- **Date**: 2026-10-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Evidence summary

- **Automated checks, re-run locally on `fb92928`, all green:**
  - `uv run pytest`: 246 passed in 137 s.
  - `uv run pytest -m baseline -s`: C (descent) gave tier 3 OPTIMAL 14 in 1.3 s. A gave the tuple `(0, 0, 97, 115, 0, …)` in 73.4 s.
  - `uv run mypy` and `uv run ruff check` are clean, and so is `mise run solver:check` (which includes shellcheck).
  - `pnpm check` (0 errors), `pnpm lint`, `pnpm steiger`, `pnpm test` (2006 passed), `pnpm build` and `bench/contract-parity.test.ts` (23 passed) all pass.
  - `pnpm experiment:goldens` with no `RESULT` prints its usage line and exits 0.
  - Every grep gate from Phases 2, 3, 4 and 5 is clean apart from its allowlist. `stagnation` appears only in the negative-test fixtures.
- **CI on PR #135, run 37778609410 (HEAD `fb92928`):** verify, integration, e2e and solver are all green; deploy was skipped, as expected on a PR.
- **Plan drift:** every Changes Required item MATCHes. Highlights:
  - `fakes.py` is a pure move (83 → 83 tests).
  - The Python descent catalog matches the deleted TS fixture literal for literal.
  - The bounds follow the formula (99 + 10 = 109, 239 + 24 = 263).
  - The schema diff is description-only (equal once descriptions are stripped), and no fixture bytes changed.
  - Phase 4 is a single isolated commit (`f10bf39`).
  - The approved adaptations in `change.md` (C's tier-10 target, about 20 extra comment rewrites) are implemented as described.

## Findings

### F1 — `teacherHoles` bound margin is thin against host variance; a false red blocks deploy

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: services/solver/tests/test_baseline.py:73-74
- **Detail**:
  - **The 10 calibration samples are effectively 5.** The two runs on each host track each other: 172/185, 222/222, 211/205, 191/206, 239/234. Host-to-host variance dominates: the host means run 178–237, with sd ≈ 22.
  - **The margin is small.** `TEACHER_HOLES_BOUND = 263` sits about 2.4 sd above that mean. From 5 effective samples, a rough estimate is a 1–4% chance of a false red per CI run.
  - **The cost of a red.** `deploy` needs `solver` green, so a false red on `main` blocks deploy until someone re-runs the job. Repeated "just re-run it" reds also teach people to ignore the tripwire.
  - **An unstated assumption.** The bound assumes GitHub's 4-vCPU runner, which the repo has only because it is public. On a 2-vCPU private runner it would almost certainly fail, and nothing beside the constants says so.
  - `TOTAL_SLOTS_BOUND = 109` is fine: the worst sample is 99 and sd ≈ 1.
- **Fix A ⭐ Recommended**: Widen only `TEACHER_HOLES_BOUND`, with a host-aware margin such as worst + 25% (299). Note the 4-vCPU / public-runner assumption beside the constants, and record the formula change in `change.md`.
  - Strength: `totalSlots` stays the sharp tripwire. Loosening a bound needs no new runner samples, so it does not violate the "calibrate only on the runner" rule.
  - Tradeoff: `teacherHoles` then catches only large regressions (≳25%). It departs from the plan's single formula.
  - Confidence: MED — the tail estimate rests on 5 host samples.
  - Blind spot: runner hosts slower than the sampled EPYC 7763 / 9V74 / Xeon 8370C mix.
- **Fix B**: Keep the formula, but re-calibrate from about 20 single-run matrix jobs, one sample per host. Document a red-handling rule beside the constants: one red on an unrelated change means re-run and log the tuple; two reds mean investigate or re-calibrate.
  - Strength: keeps the plan's formula and gives better tail data.
  - Tradeoff: another throwaway CI campaign. A residual flake rate remains, and a re-run culture can mask a real regression.
  - Confidence: MED — it depends on the jobs actually landing on distinct hosts.
  - Blind spot: whether 20 jobs cover the host pool any better than 5.
- **Decision**: FIXED (Fix A). `TEACHER_HOLES_BOUND` was raised from 263 to 299 (worst + ceil(25%)), the constants' comment now records the 4-vCPU assumption, and `change.md` has the bounds line plus a dated note.

### F2 — Runbook misstates `student-first`'s soft-availability rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: docs/runbooks/plan-generation.md:28-29 (also :63)
- **Detail**:
  - **A wrong claim in an author-facing doc.** The rewritten prerequisites paragraph says "The other two policies weigh it as a preference". `student-first` holds soft availability hard, exactly as `clean` does:
    - `policy.py:43` sets `clean_mode=True`;
    - `clean-label.ts:66` says so;
    - the Generate dialog (`GenerateButton.tsx:183`) says so.
  - **Outside the planned range.** This paragraph (`:25-29`) lies outside the plan's rewrite range (`:55-98`), and the plan said the soft-hit passages stay.
  - **A smaller error at `:63`.** It says "the board under it shows 'Generating — stage N of 10'". The pending page shows that label and no board; the board appears when the run finishes (`PendingProposalPage.tsx:71`).
- **Fix**: Reword `:28-29` so that only `canonical` weighs soft cells as a preference and `student-first` keeps clean's rule. At `:63`, replace "the board under it shows" with "the pending page shows".
- **Decision**: FIXED. The prerequisites paragraph now names `student-first` as keeping clean's rule (clean fallback keys on `clean_mode`, `solve.py:340`) and says only `canonical` weighs soft cells as a preference. `:63` now reads "the pending page shows".

### F3 — Stale mechanism prose survived the Phase 5 sweep (lesson: a convention that cites a mechanism is coupled to it)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/entities/timetable/model/analysis/slot-census.ts:31-34 (plus 4 sites below)
- **Detail**: Phase 5's grep covered only the word "greedy", and the about-20-comment sweep missed these sites:
  - `slot-census.ts:31-34` is the most important. It says "the same elicited G1 number **the detector** and the `goldenBandDistance` tier are built on … how the tier stopped protecting **the cells construction seats**". The detector is the deleted `deriveGoldenSets`, and "construction" is greedy's anchor stage.
  - `objective.test.ts:313` has the test title "…the tier's bar is the detector's…".
  - `contracts/README.md:65` says the exporter writes to `services/solver/tests/fixtures/seed-plan-a.json`. Its default target is now `services/solver/data/<plan>-dump.json`, and the fixture is frozen and must never be overwritten. The line sits in the block S-309 edited.
  - `bench/generate-contract-goldens.experiment.ts:27-28` says the canonicalizer "drops the solver's `"lowerBound": null` keys". Since Phase 2 the solver emits no such key at all, and the sentence now contradicts the 48/45 note added at `:31-33`.
  - `services/solver/tests/test_baseline.py:76` cites `descent-catalog.ts` as the source without saying it was deleted.
- **Fix**: Reword the five sites, comment and prose only: "the tier and this census" in slot-census and the test title; the `services/solver/data/` target in the contracts README; drop the null-key sentence in the goldens docblock; add "(deleted in S-309)" in `test_baseline.py`.
- **Decision**: FIXED. All five sites are reworded, comment and prose only, and prettier, eslint and ruff are clean.

### F4 — The `baseline:` line never reaches green CI logs, and it carries no per-stage timing

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: services/solver/tests/test_baseline.py:104,125,148-153
- **Detail**:
  - **No line on green runs.** The plan says the line is printed "which the calibration loop and CI logs read". CI runs bare `uv run pytest`, and pytest discards captured stdout for passing tests. In run 37778609410's solver log, no `baseline:` line appears, so routine CI runs build no drift record.
  - **No timing per stage.** `summary()` prints `tier:status` only. Tier 2 (`holes == 0`, an exact assertion under a 10 s budget) therefore shows no headroom.
- **Fix**: Print the line inside `capsys.disabled()`, so it always lands in the log, and add each stage's `wall_clock_s` to `summary()`.
- **Decision**: FIXED. A `_report(capsys, …)` helper prints past the capture, `summary()` carries `tier:status@Ns` per stage, and the module docstring is updated.
  - Verified without `-s`: both `baseline:` lines print, and ruff and mypy are clean.
  - Local M-series figures: tier 2 proved in 1.7 s. On a runner 3–5× slower that is about 5–8.5 s against the 10 s stage budget, and it is now visible in every CI log.

### F5 — "~75 s" baseline figure doesn't match the run it cites

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: README.md:383, .github/workflows/ci.yml:266
- **Detail**: Both files attribute "~75 s" for `test_baseline.py` to run 37771005774. That run's log shows the baseline tests took about 81 s, from session start 11:35:20 to baseline done 11:36:40. The 194 s solver and 393 s e2e figures are accurate, and the off-critical-path claim holds either way.
- **Fix**: Change "~75 s" to "~80 s" in both places.
- **Decision**: FIXED. `ci.yml:266` and `README.md:383` now say ~80 s.

### F6 — The fast local loop is documented only in a `pyproject.toml` comment

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: services/solver/README.md (testing section), services/solver/pyproject.toml:59-60
- **Detail**:
  - `mise run solver:test` and `uv run pytest` now include about 75 s of baseline.
  - The plan's opt-out, `-m "not baseline"`, is documented only in a `pyproject.toml` comment; neither README mentions it.
  - On a developer machine with fewer than 4 cores, A may also fail bounds calibrated on the runner, and nothing says that is expected.
- **Fix**: Add one line under the solver README's test commands: `uv run pytest -m "not baseline"` is the fast loop; A's bounds assume the 4-vCPU runner.
- **Decision**: FIXED. A short paragraph under the Setup commands in `services/solver/README.md` covers the fast loop, the fact that CI always runs the baseline, and the 4-vCPU calibration caveat.

### F7 — The solver job has no `timeout-minutes`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml (solver job)
- **Detail**:
  - There is no `pytest-timeout`, and no job sets `timeout-minutes`, so GitHub's 360-minute default applies.
  - Every CP-SAT solve on the path is time-budgeted (worst case about 150 s for A), so the risk is low.
  - The baseline is now the longest-running work in the lane, and a hang would hold `deploy` for hours. The gap predates S-309.
- **Fix**: Add `timeout-minutes: 15` to the `solver` job.
- **Decision**: FIXED. The `solver` job now has `timeout-minutes: 15` with a one-line rationale comment. The YAML parses and prettier is clean.

### F8 — Manual 4.10 (Generate through build + preview) has no recorded evidence

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/greedy-retirement/change.md (no Phase 4 entry)
- **Detail**:
  - Every other manual item has evidence in `change.md`: the calibration table, the watch-item timings, the CLI run, the export loop and the trackers.
  - 4.10 is checked with nothing recorded.
  - It is substantively covered by CI's e2e lane: `generation.spec.ts` drives Generate to a delivered board on the workerd preview, and it is green on HEAD.
- **Fix**: Add a one-line Phase 4 note to `change.md` recording the manual run, or stating that the e2e lane's `generation.spec.ts` is its evidence.
- **Decision**: FIXED. `change.md` now has a Phase 4 entry citing `generation.spec.ts`, green on `f10bf39` (run 37771005774) and on `fb92928` (run 37778609410), plus the integration lane's oracle coverage.
