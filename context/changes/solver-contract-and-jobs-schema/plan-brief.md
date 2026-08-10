# Frozen Wire Contract + `generation_jobs` Schema + Solver Credential (F-301) — Plan Brief

> Full plan: `context/changes/solver-contract-and-jobs-schema/plan.md`
> Research: `context/changes/solver-contract-and-jobs-schema/research.md`

## What & Why

Freeze the TS↔Python generation wire contract as a hand-written JSON Schema in `contracts/` — golden-fixture-gated in both suites — ship the forward-designed `generation_jobs` table, and land the least-privilege solver credential. This is the foundation every CP-SAT-migration slice (S-301→S-310) builds on; research showed the contract is not actually frozen today (eight TS↔Python divergences, no TS-side validation anywhere), so freezing it is a decision act, not a transcription act.

## Starting Point

The contract lives as two independently-consistent halves: TS types (`types.ts`) with no version field and no runtime validation, and Python frozen dataclasses (`schema.py`) with a hand-written key map triplicated across parse/emit/test. One Python-only fixture exists (the bench dump, which also carries greedy warm-start data). `generation_jobs` doesn't exist. No machine credential path exists — every write is cookie-session-bound. CI has no Python job at all.

## Desired End State

`contracts/` holds the schema, a normative README (canonical form, versioning, scope), and two real-size UUID-only goldens; `pnpm test` and `uv run pytest` both byte-gate them, with a new `solver` CI job making the Python gate real on every push. `generation_jobs` exists with the full forward-designed column set. A `solver_job_writer` role + Custom Access Token Hook give the future container access to exactly one table, with an integration test that turns the hook-misfire silent-escalation into a red build.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Artifact mechanism | Hand-written JSON Schema in `contracts/` | Only option where the artifact IS the contract, owned by neither side. | Research |
| Greedy's place | Out of contract entirely | Greedy never crosses the wire and is slated for removal (S-309) — don't freeze a dead engine's quirks. | Plan |
| Pin shape | Strict schema, narrow 4-field wire pin | Contract = engine argument by construction; PII/UUID-only posture becomes enforced, not implicit. | Plan |
| Diagnostics semantics | CP-SAT canonical (`partial` = not proven optimal; `engine` const `cp-sat`; `stopReason` ∈ budget/cancelled) | One wire producer → freeze its behavior; zero engine changes. | Plan |
| Optional values | Omit-when-absent, never null | Matches existing TS `?:` types; convention is encoded in the canonicalizers (they drop null keys). | Plan |
| Comparison + hash | One canonicalizer, two consumers (byte-gated goldens; `snapshot_hash` digests the same form) | The ordering decision is made exactly once. | Plan |
| TS gate location | `bench/contract-parity.test.ts` | `contracts/**/*.test.ts` is collected by no vitest project — it would be green CI with zero coverage. | Research |
| Column scope | Full forward-designed set (~19 columns) | S-303→S-310 need zero migrations; the shape is decided once with full context. | Plan |
| `snapshot_hash` | SHA-256 over the canonical snapshot, source plan at T0 | Drift is source-at-T0 vs source-at-T1; the snapshot is the solve's input set by definition. | Research |
| Snapshot storage | On the job row as `jsonb` | FR-313's server-side oracle needs the exact solved-against snapshot; TOAST keeps narrow polls cheap. | Research |
| Status column | `text` + check, full six-value vocabulary on day one | Widening a check is one line; S-304/S-305 then need no migration. | Research |
| Credential | Option E: machine Auth user + token hook → `solver_job_writer` role | Spike-verified; container holds publishable key + password only; RLS still applies; unknown roles fail closed. | Research |
| Producer drift hole | Route `load-plan-analysis.ts` through `assembleGeneratorSnapshot` | Closes the one producer that bypasses the single assembly path, for a small diff. | Plan |
| Scope extras | Fix two stale docs; revoke anon Dxtm on the new table | Honest posture claims — the lesson about overstated grant comments. | Plan |

## Scope

**In scope:** `contracts/` artifact + README + goldens; TS/Python canonicalizers + `snapshot_hash` helper; parity tests both suites; minimal `solver` CI job; `generation_jobs` migration + regenerated types + posture test; `solver_job_writer` role, token hook, provisioning script, runbook, hook-misfire guard test; stale-doc fixes.

**Out of scope:** F-302 HTTP wrapper/container; per-stage checkpoint capture in the solver (S-303); greedy conformance or removal (S-309); runtime schema validation in app hot paths; bench dump envelope / parity suite changes; mise orchestration; ownership-scoped RLS.

## Architecture / Approach

The schema is `$defs`-only (snapshot, result, StageReport, SolveRequest envelope with `formatVersion: const 1`), strict everywhere, with the canonical JSON form (sorted keys, declared array sorts, no nulls, compact) specified normatively in `contracts/README.md` and implemented once per side. Goldens are real-size (derived from the existing seed fixture + one CP-SAT run) and byte-compared, which doubles as the anti-prettier tripwire (`contracts/` joins `.prettierignore`). The DB work follows house conventions verified live in research; the credential's narrow role is reached via a Custom Access Token Hook whose enablement is repo-declared in `config.toml`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Contract artifact + TS gate | Schema, README, canonicalizer/hash, goldens, bench parity test, producer unification | Canonical-form spec ambiguity → cross-language byte mismatch found in Phase 2 |
| 2. Python gate + CI lane | Mirrored canonical emit, None-drop fix, `__file__`-anchored contract test, `solver` CI job | Byte-parity across `json.dumps` vs TS stringify (number formatting) |
| 3. `generation_jobs` migration | Full column set, RLS/grants incl. Dxtm, indexes, moddatetime, regenerated types, posture test | A wrong column shape here is the one non-additive-migration risk downstream |
| 4. Solver credential | Role + policies, token hook, config.toml enablement, provisioning + runbook, guard test | Hook-misfire fallback = silent full-DB access — mitigated by the guard test + kill-switch drill |
| 5. Docs truth-up | infrastructure.md / README fixes; `contracts/` documented | None material |

**Prerequisites:** local Supabase stack (Docker), `uv` for the solver package, branch `feat/solver-contract-and-jobs-schema` (already created).
**Estimated effort:** ~4–5 sessions across 5 phases; Phases 3–4 are independent of 1–2 after the canonical-form spec lands.

## Open Risks & Assumptions

- Cross-language canonical byte-parity assumes identical number serialization (all wire numbers are ints today; the canonical spec must keep it that way or state float rules).
- The hook-permission surface (grants to `supabase_auth_admin`) is post-cutoff Supabase API — Phase 4 fetches current docs rather than trusting memory.
- "Gated in both suites" in CI is true from day one only because the minimal `solver` job ships here (author's call, recorded in research resolution #3); ruff/mypy lanes still arrive with S-302.
- Hosted hook enablement is a manual one-time `supabase config push` (documented in the runbook); CI deploy-job extension is deliberately deferred.

## Success Criteria (Summary)

- A contract change on either side that diverges from the artifact turns a suite red — locally and in CI — instead of surfacing as a bug at the S-301 integration.
- Downstream slices S-303→S-310 build against `generation_jobs` without shipping a single schema migration.
- The solver credential can reach exactly one table, and a hook misconfiguration is a red build, not a silent full-database escalation.
