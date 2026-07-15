# POC: Local Python CP-SAT Solver — Plan Brief

> Full plan: `context/changes/poc-cp-sat-backend-service/plan.md`
> Research: `context/changes/poc-cp-sat-backend-service/research.md`

## What & Why

A ~1-day-scale POC: a local Python OR-Tools CP-SAT solver that consumes an exported
`GeneratorSnapshot` JSON, encodes every hard rule and all 10 objective tiers, warm-starts from the
greedy board, and answers the question `generation-quality-tuning` left open: **can the 5–8 h
unplaced residue be closed, or is it provably infeasible?** Either answer ends the ambiguity — a
complete board justifies the backend-service conversation; an infeasibility proof (with a named
conflict set) redirects the work to data/rules. The Python package is shaped as the future
service core; only the file transport is throwaway.

## Starting Point

Everything the POC needs already exists: the JSON-safe, PII-free wire format, the export seam in
`bench/generation.experiment.ts`, the engine-free verify oracle, the persist RPC, and the gold
comparison via `pnpm analyze:plans`. No Python exists in the repo; a top-level `poc/` dir is
invisible to every CI gate. The old WASM-spike "no" is stale (single-threaded, unhinted, wrong
objective); clique lower bounds were freshly measured (golden 46/41, seed 48/45).

## Desired End State

A `poc/cp-sat/` uv package whose encoding is proven equivalent to the TS analyzer (exact 10-tier
parity on the greedy board), a measurement campaign run on the golden catalog (Mode A
completeness, full staged ladder, Mode B residual repair), the best CP-SAT board persisted and
viewable in-app next to the expert plan, and `results.md` recording gate-by-gate verdicts plus a
written go/no-go recommendation on the backend service.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Objective tier scope | Full 10-tier ladder, first-class | The most faithful service preview: one board, fully optimized, judged against gold. | Plan (user) |
| Mode B (residual repair) | Always runs | Tests the hybrid architecture (greedy + exact repair) that prior research names the likely shipping shape; residual solves are cheap. | Plan (user) |
| Python quality bar | ruff + focused pytest on the encoding core | Encoding drift is the #1 risk; unit pins localize a parity failure to the exact rule/tier. | Plan (user) |
| Replication protocol | Single run per mode, fixed seed, config+logs captured | Mode A outcomes are self-certifying (oracle-checked board / infeasibility proof); replication adds nothing to the decision. | Plan (user) |
| Deliverable | `results.md`: comparison + gate verdicts + go/no-go | The change exists to make a decision, so the decision gets written down in the acceptance-run format. | Plan (user) |
| Phantom Chemistry SL hours (4 h, zero students) | Auto-park at export, assert + log | Keeps "residue 0" a literal, honest gate and makes expert/greedy/CP-SAT comparable on identical terms. | Plan (user) |
| Toolchain | uv-only; no `mise.toml` pin | Staged adoption — promote only if the POC graduates to a real service. | Research (user) |
| Infeasibility evidence | Conflict set → local name mapping → short Polish memo | Mirrors the `expert-questions.pl.md` format; built only if Mode A returns INFEASIBLE. | Research (user) |
| Repo placement | Top-level `poc/cp-sat/`; TS ends in `bench/` | Invisible to steiger/eslint/build; bench carries the DB-touching experiment conventions. | Research |
| Parity method | Fixed-hint solve vs TS-computed tuple in the dump | `fix_variables_to_their_hinted_value` gives an exact, machine-checkable encoding-equivalence gate. | Research |

## Scope

**In scope:** export experiment (with auto-park + TS objective tuple), gitignore + package
scripts, committed seed fixture, uv package (schema/model/objective/solve/explain/cli), pytest
pins, parity gate, Mode A + full ladder + Mode B, import experiment (verify → persist → analyze),
golden campaign, `results.md`.

**Out of scope:** any app/UI change, HTTP service, deployment/Containers work, CI wiring for
Python, `mise` pin, hosted-Supabase access, committed golden dumps, greedy changes,
backend-service design doc.

## Architecture / Approach

Files are the transport. TS export dumps `{snapshot, greedy baseline + clique bounds, TS 10-tier
tuple}`; the Python CLI solves (parity / complete / full / repair modes) and writes a
`GenerationResult`-shaped JSON; TS import verifies via the same oracle as greedy, persists into
the export's clone, and the analyzer compares against gold. Encoding fidelity is de-risked in
order — hard rules (pytest pins) → tiers (micro-case pins) → a **blocking exact-parity gate** —
before any optimization claim.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Export seam + plumbing | Dump format, auto-park, seed fixture, uv skeleton | Golden dump leaking into git (mitigated: gitignore first) |
| 2. Schema + hard rules | Typed model + all 9 hard rules, pytest-pinned | Early-finish-edge / day-shape encoding subtleties |
| 3. Tiers + parity gate | All 10 tiers; exact 10/10 parity vs TS tuple | Week/lane asymmetries — the plan's central risk, caught here |
| 4. Staged solver + CLI | Ladder, Mode A, Mode B, result JSON | Assumptions path needs `num_workers=1`; `≤ best` hardening |
| 5. Campaign + verdict | Import experiment, golden run, `results.md` | Ambiguous Mode A timeout → extend budget, report honestly |

**Prerequisites:** local Supabase stack with the golden plan loaded; `uv` installed; no `db reset`
between export and import (the dump pins its clone id).
**Estimated effort:** ~2–3 sessions — phases 1–2, phases 3–4, then the campaign + write-up.

## Open Risks & Assumptions

- Golden-plan data quirk: Chemistry SL (4 h) is assumed zero-student — the export asserts it and
  fails loudly if the data has changed.
- Parity may surface a genuine TS-side ambiguity (e.g. an undocumented tie in tier math); if so,
  the TS oracle is the definition and Python conforms.
- Stage timings are single samples under multi-worker nondeterminism — recorded as indicative.
- ortools' tight `protobuf`/`numpy` pins assume a dedicated uv venv (enforced by project layout).

## Success Criteria (Summary)

- **G1**: Mode A closes the residue (oracle-verified complete board) *or* proves infeasibility
  with a named conflict set — either way the ambiguity ends.
- **G2**: teacher gap-slots after the full ladder ≤ 148 (greedy: 217; expert: 74) — the quality
  case for the service.
- **G3**: Mode B repairs a fabricated residue in seconds — the hybrid-architecture data point.
- `results.md` states the go/no-go with the numbers behind it.
