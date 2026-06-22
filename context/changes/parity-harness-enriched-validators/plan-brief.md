# Parity Harness for Enriched Validator Classes — Plan Brief

> Full plan: `context/changes/parity-harness-enriched-validators/plan.md`
> Research: `context/changes/parity-harness-enriched-validators/research.md`

## What & Why

Land the test-plan **Phase 4** parity harness — a single, table-driven guard that proves no placement is
marked *valid* that an enriched validator class should reject (test-plan §2 **Risk #6**, High × High). The
guard was meant to land before S-03's unified-rule rewrite but slipped; S-02 (co-teaching) and S-03
(bi-weekly) shipped without it, so this change also **backfills** their false-positive coverage.

## Starting Point

The verdict boundary `deriveCellViolations` exists and is tested — but only with single-teacher courses, so
co-teaching has never been asserted through the board path (only via `explainCell` unit tests). Oracle hygiene
is already correct (hand-typed literals). The fixture builders are duplicated and divergent across four model
test files (notably two incompatible `ctx` signatures).

## Desired End State

One `model/collision-parity.test.ts` holds the full board-path parity matrix for S-02 and S-03 (full-oracle
rows + negative-parity accepted rows), with visible `it.todo` placeholders for S-04/S-06. A shared
`model/__fixtures__/builders.ts` feeds it and the four migrated test files. The test-plan records Phase 4 as
landed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Backfill scope | S-02 + S-03 both | Close the High×High Risk #6 gap for the classes already live | Research |
| Harness home | Dedicated `collision-parity.test.ts` | "parity" is already taken twice by unrelated tests; one file = one guard surface | Research |
| Assert boundary | `deriveCellViolations` | The committed-placement contract that survives S-03/S-04 rewrites | Research |
| Coverage | Full per-class board-path matrix | Authoritative Risk #6 surface; board-path coverage is genuinely new | Plan |
| Builder shape | Named `cellCtx`/`weekCtx`/`availCtx` | Smaller migration diff; mirrors today's shapes | Plan |
| Table shape | `describe()` + `it.each`, full oracle + negative rows | Strongest guard; also guards over-rejection | Plan |
| Convention doc | test-plan §6 cookbook | Where contributors look for test how-tos | Plan |
| Test-plan status | Flip §3 Phase 4 + §5 gate now | Reflect reality immediately (orchestrator caveat noted) | Plan |

## Scope

**In scope:** shared fixture builder + migrate 4 model test files; the parity harness with S-02/S-03 backfill
matrix; §6 cookbook convention; test-plan §3/§5 status flip; S-04/S-06 `it.todo` extension point.

**Out of scope:** any production/domain code; S-04 cross-cohort plumbing or live fixtures; drop-hint coverage
(Phase 3 of the rollout); a new CI job; deleting existing tests.

## Architecture / Approach

Safety-net-first. Phase 1 is a pure behavior-preserving refactor (extract builders, migrate four files, verify
green) so the protected core's net never goes dark. Phase 2 writes the Risk #6 guard against the stable
`deriveCellViolations` boundary with requirement-anchored literal oracles. Phase 3 documents the convention and
flips rollout status.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Builder + migrate | Shared `__fixtures__/builders.ts`; 4 files migrated, suite green | Reconciling the divergent `ctx` signatures without changing behavior |
| 2. Harness | `collision-parity.test.ts` S-02/S-03 matrix + S-04/S-06 `it.todo` | Expected values must come from requirements, not the validator (oracle problem) |
| 3. Convention + status | §6 cookbook entry; §3/§5 flipped | Keeping test-plan internally consistent; orchestrator-ownership caveat |

**Prerequisites:** none (test + doc only; boundary code already exists).
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- The 4-file migration touches the protected core's safety net — mitigated by doing it first, behavior-preserving, and verifying green before any new assertions.
- `hours` standardization (1→4 in one file) assumed inert for all constraints — proven by the green suite.
- Flipping test-plan status in this change bypasses the `/10x-test-plan` orchestrator; caveat noted in §3.
- S-04/S-06 parity remains pending (`it.todo`) until `deriveCellViolations` gains a cross-cohort parameter.

## Success Criteria (Summary)

- Breaking a constraint reddens at least one S-02 and one S-03 parity fixture (the guard is a real oracle).
- A reader can see, in one file, which enriched classes have a false-positive guard (S-02/S-03 live; S-04/S-06 todo).
- `pnpm test` / `pnpm check` / `pnpm lint` / `pnpm steiger` all clean; the four migrated files show no changed assertions.
