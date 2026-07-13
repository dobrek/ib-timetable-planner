# Plan-Quality Analyzer — Plan Brief

> Full plan: `context/changes/plan-quality-analyzer/plan.md`
> Research: `context/changes/plan-quality-analyzer/research.md`

## What & Why

Build a pure, read-only plan-quality feature extractor plus a dev-side two-plan runner that automates the expert-vs-generated comparison currently hand-made in SQL (`comparison-report.md`). The generator's output is "not close to the gold plan and not truly valid" because its objective is missing whole dimensions — this tool turns that intuition into a reproducible, ranked measurement, and answers the tier-0 question first: is the expert's plan even valid under the current oracle?

## Starting Point

The metrics core already exists as pure exported functions in `src/entities/timetable/model/generation/` (slots, holes, student gaps, deficits, the `verifyGeneration` oracle). The comparison rig is operational locally (Golden Plan snapshot + catalog-only clones), and every target metric was validated manually in SQL against the real gold plan. What's missing is the tool: a reusable extractor and a runner that addresses plans by id.

## Desired End State

`pnpm analyze:plans` loads one or two plans by id from the local stack and prints, per plan, a rule-verdict block (the verify-gold experiment) followed by side-by-side feature tables covering the full validated metric catalog — completeness always printed beside slot counts. A recorded first run (verify-gold verdict + golden-vs-generated diff) lives in the change folder, with golden-side numbers matching the hand-made report.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Surface | Pure extractor + dev runner only (Option A) | Smallest effort that produces the full report; in-app surfaces wait for the expert session | Research / Plan |
| Metric scope | Full T1 catalog + cross-cohort family incl. fixture detector | Every metric already validated cheaply in SQL; each is a ~10-line fold on the lane primitive | Plan |
| Runner output | Console tables only, no file emission | Author's call; the durable artifact is the recorded Phase-4 run | Plan |
| Subject identity | Carry `name/level/groupIndex` in an analyzer-own projection; roll up by `name` (provisional) | Adjacency needs no subject key (courseId-grain); roll-ups feed the expert session; `GroupingCourse`/hash untouched | Research / Plan |
| Rule verdicts | Reuse `verifyGeneration` with pins-empty snapshot, composed by the runner | Zero new machinery for the tier-0 verify-gold experiment; extractor stays a pure feature vector | Research |
| Ride-alongs | Bench lookup by id (env-overridable) + commit the `.gitignore` rule | Enforces "plans by id, never name"; closes the recorded TODO | Plan |
| Not riding along | Backup/export script, bench-bar comment update | Own scope / declined | Plan |
| Done means | Tooling merged AND first real run recorded (verify-gold + diff) | The change's motivating question must get answered, not just enabled | Plan |

## Scope

**In scope:** `model/analysis/` extractor (lane primitive + board/course/student/teacher/cross-cohort lenses + subject roll-ups), completeness wrapper, `pnpm analyze:plans` runner + dedicated vitest config, bench id-lookup fix, `.gitignore` rule commit, recorded first run.

**Out of scope:** in-app surfaces (KPI strip / comparison page), report file emission (markdown/JSON), persistence, any objective/engine change, pre-pin experiment, `GroupingCourse` extension, backup/export script, T3 metrics, prod access, final subject-key decision.

## Architecture / Approach

A pure `analyzePlan(input) → PlanQualityFeatures` in `src/entities/timetable/model/analysis/` (Workers-safe, barrel + concept-file convention), built on one shared primitive: rows → `(entity, day, weekLane)` lanes with `both`-week fan-out, folded by `laneStats`. It reuses the shipped counting functions and takes its own input projection (`GroupingCourse` + subject fields) — never `GeneratorSnapshot`. The runner (bench-precedent vitest config) loads plans by id via existing shared loaders, composes extractor + `verifyGeneration`, and renders console tables. Feature *vector*, never a scalar score (the tier-bleed lesson).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Analysis module foundation | Types, lane primitive, board + course lenses, completeness | Getting lane/week semantics right per metric family |
| 2. Entity lenses + cross-cohort | Student/teacher lenses, cross-cohort family, fixture detector, subject roll-ups | Join-convention drift vs the SQL v0 (student projection) |
| 3. Dev runner + ride-alongs | `pnpm analyze:plans`, verdict block, bench id fix, gitignore | Env/stub wiring for the vitest runner |
| 4. First real run recorded | `analysis-run-1.md` with verify-gold verdict + diff, report parity | Local rig state (snapshot restored, clone availability) |

**Prerequisites:** local Supabase stack; `data/golden-plan.sql` restorable (Phase 4 only).
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- Student-lens numbers may deviate slightly from the SQL report (direct-enrollment join vs the app's overlap/merge-expanded projection) — accepted, fair for both plans, recorded with explanation.
- The subject roll-up key (`name`) is provisional until the expert confirms the grouping — one keyFn change if it moves.
- Phase 4 depends on local-only data (gitignored snapshot); if the original generated clone is gone, a fresh generation becomes a new data point rather than an exact report reproduction.

## Success Criteria (Summary)

- Running one command against two plan ids reproduces the comparison report's golden-side numbers exactly (placement-derived metrics) — no more ad-hoc SQL.
- The verify-gold verdict is on record: either the gold plan passes the oracle (missing-rules world) or the failing rules are named (mis-specified-rules world).
- The analyzer is a pure entity module any future surface (KPI strip, comparison page, A/B loop) can reuse unchanged.
