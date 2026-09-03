# Solve-policy choice (S-307) — Plan Brief

> Full plan: `context/changes/solve-policy-choice/plan.md`
> Research: `context/changes/solve-policy-choice/research.md`

## What & Why

Let the author choose the solve policy when launching a CP-SAT job (FR-302): clean mode stays the
shipped default, canonical order and student-first become selectable. The POC showed the tier
order is "the single biggest lever over the board a school gets" and asked that it be an explicit
policy, not a buried constant. Today it is a buried constant: the service hardcodes clean and the
CLI hardcodes canonical, and the hosted campaign built to compare policies cannot vary one.

## Starting Point

The engine is already mostly there — `_run_ladder` takes the tier order as a parameter and
`SolveConfig.clean_mode` is the hard/soft switch — but the two staged call sites pass a module
constant and the runner hardcodes clean. The wire has no `policy` key (unknown keys 422), the
audit column holds a placeholder `{ clean: true }`, and Generate is a zero-config click whose
"No clean board was possible" sentence is true only because every run is clean-mode.

## Desired End State

Generate opens a confirm dialog with three options, pre-selected from the plan's previous job. The
choice is written once to the row and the wire, the solver runs that policy (the hub's stage names
follow it), the CLI takes `--policy`, and the delivered proposal's provenance line names the policy
with a clean-label sentence that stays honest. `formatVersion` is still `1`; the parity gate is
untouched.

## Key Decisions Made

| Decision           | Choice                                                | Why (1 sentence)                                                                                        | Source   |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------- |
| Dominance          | Split out; follow-up "objective tuple" slice recorded | No producer (one board per job) and no consumer (comparison page refuses to judge, type-enforced).      | Plan     |
| Policy count       | Three: clean, canonical, student-first                | FR-302 names all three; the ladder plumbing is ~50 lines and makes "policy is configuration" true.      | Plan     |
| Carrier            | Optional `policy` on `SolveRequest`, no bump          | Additive-optional per the contract's own rule (S-303 precedent); row is unreadable to the solver.       | Research |
| Wire shape         | `{ preset: "clean" \| "canonical" \| "student-first" }` | Smallest contract surface, tier indices stay engine-side, object form is additive-extensible later.     | Plan     |
| Two copies         | Row and wire written from one Zod-validated value     | Answers F-302's "two copies that can disagree" objection at one call site.                              | Research |
| Ladder constraint  | Permutations only                                     | Keeps "stage N of 10" constant on four surfaces and `LADDER_TIER_COUNT` intact.                         | Research |
| Launch surface     | `AlertDialog` + `ToggleGroup type="single"`            | S-305's deliberate-act idiom; gives consequence copy an honest home and fixes the screen-reader gap.    | Plan     |
| Memory             | Seed from the previous job's `policy` column          | Durable, per-plan, no sixth persistence clone; makes the audit column earn its keep.                    | Plan     |
| CLI flag           | `--policy`, default `canonical`                        | POC frontier reproducible from the file transport; default preserves today's CLI bytes and goldens.   | Plan     |
| Clean label        | `not-clean` learns whether clean was requested        | Otherwise the shipped sentence becomes false the moment canonical is selectable.                        | Research |
| Acceptance test    | Assert the stage transcript order, not the board      | At 8 workers same-policy variance rivals between-policy variance; the transcript is deterministic.     | Research |
| Doc trueing        | In-code docstrings + roadmap entry only               | Broad PRD/README/issue #104 sweep and S-309 de-gating not selected by the author.                       | Plan     |

## Scope

**In scope:**

- Schema + both canonicalizers + regenerated `solve-request.json` golden, both suites green in one commit
- `cpsat_engine/policy.py` presets, `SolveConfig.ladder` with permutation validation, runner reads the request
- `--policy` on `cli.py` with sidecar echo
- Zod input → audit row → wire from one value; `GenerationJobView.policy`; policy-aware clean label
- Launch dialog (seeded, live-gated, consequence copy), provenance noun, e2e confirm step
- In-code docstring true-ups; roadmap S-307 entry records the dominance split

**Out of scope:**

- Dominance, the objective tuple on the wire, checkpoint monotonicity (follow-up slice)
- PRD/contract-README-beyond-versioning/issue #104 corrections; S-309 de-gating
- Service echoing the effective policy onto the row; any grant widening or migration
- Subset ladders, a continuous dial, presets, multi-policy runs, numbers in copy
- Policy on the hub or the pending page

## Architecture / Approach

Contract-first (the service 422s unknown keys), then engine + service + CLI, then the app thread,
then the UI. The preset resolves to `(clean_mode, ladder)` in one Python module shared by runner
and CLI; the ladder permutes only the visit order, never `build_objective`'s tuple, so the 10/10
parity gate cannot see it by construction. On the app side one Zod-validated object is written to
the row and the wire, read back into the view, and consumed by the picker seed, the provenance
line and the clean label.

## Phases at a Glance

| Phase                              | What it delivers                                                        | Key risk                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Contract                        | `policy?` on the envelope, golden regenerated, both suites green        | Bilateral commit discipline; a whitelist missed on one side drops the field   |
| 2. Engine + service + CLI          | Presets → `SolveConfig`; runner honours the request; `--policy`         | Reordering the wrong thing (objective tuple) would break the parity gate      |
| 3. App thread                      | One validated value → row + wire; view + clean label know the policy    | Equality gates dropping the new fields silently                               |
| 4. UI                              | The dialog, seeding, live gating, provenance noun, e2e                  | Copy that ranks or quotes numbers; losing the `Generate plan` accessible name |
| 5. Close-out                       | Docstrings trued, roadmap records the split                             | —                                                                             |

**Prerequisites:** S-301 shipped (done); a tier-1 solver for the integration and e2e lanes.
**Estimated effort:** ~3–4 sessions, comparable to S-305; Phase 4 is the largest.

## Open Risks & Assumptions

- Student-first has one POC run behind it and no calibration; the copy states consequences only,
  and the CLI flag is what makes it validatable on the hosted campaign.
- The student-first ladder places `softHits` after `teacherHoles` (canonical relative order for
  tiers the POC did not name); it is hard-constrained under that preset, so the stage is trivial.
- Legacy `policy` rows are read as clean; if a non-clean run was ever made by editing `runner.py`,
  its label would say clean was requested.

## Success Criteria (Summary)

- An author can launch under any of the three policies and see the hub's stage order follow it.
- Row, wire and engine agree — proven by the student-first proposal-chain integration test.
- Both contract suites are green on the regenerated golden with `formatVersion` unchanged, and the
  objective-parity suite is untouched.
