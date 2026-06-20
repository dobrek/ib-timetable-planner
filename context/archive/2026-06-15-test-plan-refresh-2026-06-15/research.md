---
date: 2026-06-15T20:30:00+02:00
researcher: Dobromir Kropielnicki
git_commit: f2ee0ac47c3a4597b4ccedc40175bc7d684f9246
branch: main
repository: ib-timetable-planner
topic: "Ground the test-plan refresh (FSD re-anchor, rollout drift, Risk #5 promotion, S-09 add) against the live codebase"
tags: [research, codebase, test-plan, fsd, astro-actions, rls, auth, validator, integration-tests]
status: complete
last_updated: 2026-06-15
last_updated_by: Dobromir Kropielnicki
---

# Research: Grounding the test-plan refresh against the live codebase

**Date**: 2026-06-15T20:30:00+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: f2ee0ac47c3a4597b4ccedc40175bc7d684f9246
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

The change `test-plan-refresh-2026-06-15` is a **guide refresh** (it edits `context/foundation/test-plan.md`; it does not write tests). `change.md` is already a detailed refresh spec asserting many concrete facts — moved directories, a phantom change folder, new test counts, a shipped integration harness, a re-sequenced rollout, a promoted Risk #5, and a new risk S-09. This research **grounds every one of those claims against the live codebase** so the downstream `/10x-plan` and `/10x-implement` can rewrite the guide on verified evidence — and flags any claim the live code does **not** support.

## Summary

The refresh spec is **substantially accurate** — the FSD re-anchoring targets, the 55-unit/9-integration count, the factory harness, the CI integration lane, the phantom folder, the architecture-refactor-landed premise, S-09's "not built / not testable" status, and the Risk #5 "full gap" framing all hold against the live tree. The implement step can proceed.

However, four claims need **correction or softening** before they land in the guide:

| # | Refresh claim | Verdict | What to fix |
|---|---------------|---------|-------------|
| C1 | PRD cites **L56 / L129 / L130 / L167** | **CORRECT THE LINES** | Lines drifted: use **L57** (no-wrong-positive), **L130** (Work durability), **L131** (Data privacy), **L158** (Access Control). The L129 cite currently lands on "Validation responsiveness," not durability — a silent mis-anchor. |
| C2 | Target §3 marks **Phase 1 "Validator trust core + API hot-path" = complete**, owning "#3 (route)" | **RESTRUCTURE** | The `placements`/`grouping` **API route no longer exists** — it migrated to Astro Actions in the FSD refactor. "#3 (route)" is owned by **both** Phase 0 and Phase 1 (double-count), and no discrete Phase 1 change was ever opened (its only folder is the phantom). Fold Phase 1 into Phase 0 *or* relabel it and correct "API hot-path" → "domain persist path (route migrated to Actions)". |
| C3 | §1 principle #4 rewrite: "the behavioral net held through the refactor" | **OK — don't strengthen** | The archive shows a *pre-existing* net held green through a relocation. It does **not** support the stronger "we built the net first, then refactored under it" framing. Keep the past-tense rewrite as-is; do not import the build-first sequencing into the live history. |
| C4 | New risk S-09 framed as a **false-positive** ("validator marks a Y2 placement valid…") | **LABEL AS INFERENCE** | Roadmap/PRD describe the *constraint to add*, not a defect. The false-positive framing is the refresh's own risk interpretation — consistent with the L57 guardrail, but not a roadmap quote. Word it as such. |

Plus two cosmetic notes: the "55 unit" total includes **2 infra-guard suites** in `src/test/` (so 53 slice-source + 2 meta), and the archive `2026-06-08-architecture-refactor/change.md` has a **duplicate `archived_at`** key (line 7 = timestamp, line 8 = `null`).

## Detailed Findings

### 1. FSD structure & §2 / §6 / §7 path re-anchoring — CONFIRMED

All old pre-FSD directories are **gone**; all new FSD targets in the refresh spec are **correct**.

**Old paths — confirmed absent** (referenced only in archived docs + the stale guide):
`src/lib/placements`, `src/components/planner`, `src/components/auth`, `src/lib/grouping`, `src/components/ui` — none exist.

**New paths — confirmed present:**
- Validator/constraint core lives exactly where CLAUDE.md claims: [`src/_pages/plan-detail/model/`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/_pages/plan-detail/model) — the registered collision classes are in [`model/constraints/index.ts`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/_pages/plan-detail/model/constraints/index.ts) (`CELL_CONSTRAINTS`: `duplicateCourse`, `teacherConflict`, `studentConflict`, `teacherAvailability`).
- Grouping core moved to [`model/compute-groupings.ts`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/_pages/plan-detail/model/compute-groupings.ts); parity oracles co-located with the API at [`api/parity.test.ts`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/_pages/plan-detail/api/parity.test.ts) and `api/adapter-parity.integration.test.ts`.
- Sign-in slice is [`src/_pages/sign-in/`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/_pages/sign-in) with a **`ui/` segment only** (no `model/`/`api/`); Astro route shell at `src/pages/auth/signin.astro`; shadcn primitives at `src/shared/ui/`; shared utilities at `src/shared/lib/`; Actions barrel at `src/actions/index.ts`.

**Server boundary (load-bearing for Risk #1 / #3).** The placements/grouping **API routes are gone** — `src/pages/api/` now holds **only** [`auth/signin.ts`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/pages/api/auth/signin.ts) and `auth/signout.ts`. Placement create/delete and grouping compute flow through Astro Actions ([`plan-detail/api/placement-actions.ts`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/_pages/plan-detail/api/placement-actions.ts), `grouping-actions.ts`), composed in `src/actions/index.ts`. This matches the lessons.md "All app-data mutations → Astro Actions" rule and **invalidates** the guide's current "placements/grouping API route" language (see C2 below).

**§7 don't-test path drift:** shadcn primitives are now `src/shared/ui/*` (was `src/components/ui/*`); grouping-core path is now `model/compute-groupings.ts` (was `src/lib/grouping`). Substance unchanged.

**§6.1 reference test is dead:** `src/lib/placements/__tests__/validate.test.ts` no longer exists. There are **no `__tests__/` dirs anywhere under `src/`** — tests are co-located siblings. The cited replacement example [`model/collision.test.ts`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/_pages/plan-detail/model/collision.test.ts) exists.

### 2. Test base, factory harness, CI lane (§4) — CONFIRMED (55 / 9 exact)

- **55 unit** (`*.test.ts`/`.tsx`, excluding `*.integration.test.ts`) + **9 integration** (`*.integration.test.ts`) under `src/` — **exact**. Nuance: 2 of the 55 are infra-guard suites in `src/test/` ([`no-seed-coupling.test.ts`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/test/no-seed-coupling.test.ts), `seed-transcode-identity.test.ts`), so it is 53 slice-source + 2 meta.
- **Factory harness** at [`src/test/factories/`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/test/factories) — all 10 builders present (barrel + one concept-file each): `createPlan`, `seedPlanCatalog`, `teardown`, `registerPlan`, `addAvailability`, `addMerge`, `addStudentWithChoices`, `placeCourse`, `ungroupSlot`, `computeGroupingsFor`. Output builders drive the **real domain functions** (`insertPlacement`, `insertOverride`, `computeAndPersistGroupings`), not transcribed values.
- **Seed-coupling guard:** `no-seed-coupling.test.ts` raw-globs every `*.integration.test.ts` and fails CI on any `Seed Plan A/B` reference (asserts `> 0` suites scanned so it can't silently pass).
- **Vitest configs:** `vitest.config.ts` (unit: `include src/**/*.test.ts`, `exclude **/*.integration.test.ts`) and `vitest.integration.config.ts` (`include src/**/*.integration.test.ts`, `setupFiles ./src/test/load-test-env.ts`). `load-test-env.ts` **throws loudly when `CI==="true"` and the Supabase env is missing** (no silent zero-coverage); locally falls back to per-suite `describe.skip`.
- **CI integration lane** at [`.github/workflows/ci.yml`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/.github/workflows/ci.yml) (`integration` job ~L34–77; `deploy` now depends on `[ci, integration]`): regenerates seed, boots a trimmed Supabase stack, wires env via `supabase status -o env >> $GITHUB_ENV`, runs `pnpm test:integration --maxWorkers=2`. The 2-worker cap is a runner-resource hedge (nine suites caused transient Kong/PostgREST 502s), CI-only — consistent with commit `f2ee0ac`.
- **e2e: none** — no Playwright/Cypress dep, config, or spec files. (The gotrue container is kept booted in CI as groundwork for future RLS/e2e, but nothing consumes it.) Playwright MCP remains a candidate runner only.

### 3. Shipped harness change reconciliation (§3 Phase 0) — CONFIRMED, with honest "partial" scope

[`context/changes/data-for-e2e-and-integration-tests/`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/context/changes/data-for-e2e-and-integration-tests) (status `implemented`, all phases checked off with SHAs) stood up the **DB-test infrastructure** the rollout assumed: the CI integration lane, plan-rooted isolation + grep guard, typed scenario factories, and a unit test of the `defineDomainAction` wrapper.

Mapping to the three risks the refresh attributes to Phase 0:
- **Risk #1 (oracle independence) — holds.** [`model/collisions.test.ts:24-46`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/_pages/plan-detail/model/collisions.test.ts#L24-L46) rejects two placements sharing student `s2` in one cell with **hand-typed literal** expectations (`toEqual(new Set(["A","B"]))`, literal violation object) — not values recomputed from the SUT. Registry analogue: `constraints/constraints.test.ts:80-100`. *Caveat:* this is the in-memory board validator only; no test proves the **server write path refuses to persist** a clashing placement (validation and persistence are decoupled).
- **Risk #3 (boundary) — partial, and the route half is gone.** The wrapper contract is unit-tested in [`shared/lib/actions/define-domain-action.test.ts`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/shared/lib/actions/define-domain-action.test.ts) (UNAUTHORIZED with no `locals.user`; `DomainError`→`ActionError` same code/message; null client → INTERNAL). But `astro:actions` and the client are **stubbed** — no HTTP `/_actions/*` path, no DB. No integration test invokes a real Action; `api/endpoint.integration.test.ts:8-12` says it drives the domain fn "rather than the HTTP layer." So Phase 0 covers the **domain persist half**; the auth + error-translation boundary is **unit-only**.
- **Risk #4 (durability) — holds, scope caveat.** Genuine write-then-independent-read-back exists: `api/endpoint.integration.test.ts:36-79` (persist groupings, then a separate `select count` + `catalog_hash` re-read) and `factories/lifecycle.smoke.integration.test.ts:59-124`. *Caveat:* no test exercises the production **reload-restore** path (`insertPlacement → loadPlannerData → assert grid restored`) — that remains Phase 3's "#4 (reload-restore)" criterion, which the target table correctly keeps open.

**Phantom folder — confirmed.** `context/changes/testing-validator-trust-core/` has **zero trace** in git history (all branches/commits), archive, or disk. It exists only as text in [`test-plan.md:87`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/context/foundation/test-plan.md#L87) (the origin), the harness change's `research.md:362,405` (which already flags "not yet on disk"), and the refresh `change.md:28` (which already slates it for removal). Removing it is well-founded.

### 4. Phase 1 "complete" — the substantive inconsistency (CORRECTION C2)

The target §3 marks **Phase 1 ("Validator trust core + API hot-path boundary") complete, owning "#3 (route)"**. Three problems:

1. **The API hot-path route no longer exists.** Phase 1's stated goal (`test-plan.md:87`) is "a false-positive cannot pass the core *or the `placements`/`grouping` API route*." That route was migrated to Astro Actions in the 2026-06-08 FSD refactor; `src/pages/api/` holds auth endpoints only. The closest live coverage is the **domain-function persist** path (`endpoint.integration.test.ts`) — which is **Phase 0's** deliverable, not a distinct Phase 1 artifact.
2. **"#3 (route)" is double-counted** — assigned to both Phase 0 ("#1/#3/#4 partial") and Phase 1 ("#3 (route)"), yet only the harness change (Phase 0) delivers it. No Phase-1-specific test exists that Phase 0 didn't already ship.
3. **No discrete Phase 1 change was ever opened** — its only folder is the phantom from §3. The independent-oracle unit tests grew organically through feature work + the refactor; they satisfy Risk #1's bar *today*, but no "Phase 1" rollout phase shipped.

**Recommendation for the plan/implement:** keep Phase 0 "complete"; then either **(a) merge Phase 1 into Phase 0**, or **(b) keep Phase 1 but mark it "complete (absorbed)"**, correct "API hot-path" → "domain persist path (route migrated to Actions)", and **remove "#3 (route)" from one of Phase 0/Phase 1** to kill the double-ownership. The Risk #1 independent-oracle claim is the one part genuinely substantiated by live code.

### 5. §1 principle #4 rewrite — refactor LANDED (CONFIRMED; caveat C3)

[`context/archive/2026-06-08-architecture-refactor/`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/context/archive/2026-06-08-architecture-refactor) is archived (`status: archived`, all 5 phases checked off with SHAs). The net held green and grew: discipline was "every commit passes `pnpm build && pnpm test`," Track A was "pure file moves … zero behavior change," and Phase 5 added new placement+grouping Action domain tests.

- **Test-count arrow:** the **15** baseline is recorded in the archive (`plan.md:19,516`); the **55 unit + 9 integration** endpoint is grounded **in the live tree** (counted here), *not* in the archive. The arrow conflates the refactor with all subsequent feature growth — defensible if phrased "since the refactor baseline."
- **Sequencing caveat (C3):** the archive does **not** state a "build the net first, then refactor under it" principle — it relied on a *pre-existing* net staying green through a relocation. The honest past-tense rewrite is "an existing behavioral net held green through a 5-phase FSD relocation." The refresh `change.md:19` phrasing ("the behavioral net held through the refactor") is accurate; do not strengthen it into build-first sequencing.
- **Data-quality note:** the archive `change.md` has a **duplicate `archived_at`** (L7 timestamp, L8 `null`); a strict YAML parser keeps the last key. Worth a one-line fix when convenient.

### 6. New risk S-09 (cross-cohort teacher collision) — SUPPORTED; framing is an inference (C4)

- **Roadmap** [`roadmap.md:226-238`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/context/foundation/roadmap.md#L226-L238) (`S-09: year-2-with-cross-cohort-constraint`): defines the "teacher across cohorts" class — a slot occupied by teacher T in Y1 cannot accept T in Y2 (corroborated by PRD FR-012(c)/FR-009). **Status `blocked`** (prereq S-08, also `blocked`). This grounds "not testable until S-09 ships."
- **Not built — confirmed absent.** The registry (`constraints/index.ts`) has four classes; `teacher-conflict.ts` checks teacher reuse **within a single cell only** (no cohort dimension). The only cross-cohort token in `constraints/` is a **design-note comment** in `types.ts:15` ("cross-cohort occupancy … add optional fields here additively"). No `BoardContext` cross-cohort field, no fifth constraint, no Y1↔Y2 reuse check.
- **Related slices:** S-03 `done` (added teacher-in-cohort + availability classes), S-05 `proposed` (silent-overwrite — defer per spec), S-08 `blocked` (Y1 full placement; validator-perf risk — defer per spec). All consistent with the refresh's defer/promote decisions.
- **C4:** roadmap/PRD describe the *constraint to add*, not a *defect*. The refresh's "validator marks a Y2 placement valid that reuses a Y1 teacher (false-positive)" is the refresh's own risk interpretation — consistent with the L57 no-wrong-positive guardrail, but not a literal source quote. Word it as the refresh's interpretation.

### 7. PRD line-number drift (CORRECTION C1)

All four PRD citations in the refresh spec are stale. Correct anchors in [`prd.md`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/context/foundation/prd.md):

| Refresh cites | Actual | Content |
|---|---|---|
| L56 | **L57** | "**Validation is never wrong-positive.** A placement the app marks as valid must actually be collision-free … false positives … are not [acceptable]." |
| L129 (Work durability) | **L130** | "**Work durability.** Author work in progress … survives accidental session interruption … without loss of placed work." |
| L130 (Data privacy) | **L131** | "**Data privacy.** Student names and their individual course choices are … personally identifying. Only authenticated authors can access this data …" |
| L167 (Access Control) | **L158** (heading; body L160-168) | "Unauthenticated access is rejected at every gated route." (L168) |

The **L129 cite is the riskiest**: it currently lands on "Validation responsiveness," so a stale anchor silently mis-points. Re-cite to L57 / L130 / L131 / L158.

### 8. Auth / RLS current state → Risk #5 = NEXT, genuine full gap — CONFIRMED

- **Middleware deny-by-default** ([`src/middleware.ts`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/middleware.ts)): allowlist = exact `/auth/signin`, prefixes `/api/auth/` and `/_`, plus a static-asset regex; everything else redirects when `!locals.user`. The `/_` prefix **exempts `/_actions/*`** — so the redirect does **not** gate Actions. Confirmed verbatim by the comment in [`require-session.ts:3-7`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/src/shared/lib/actions/require-session.ts#L3-L7): "each handler must enforce the session itself."
- **`requireSession` self-enforced uniformly:** defined in `require-session.ts` (throws `UNAUTHORIZED` if no `locals.user`), called centrally in `define-domain-action.ts:20`. All 8 action modules build on `defineDomainAction`; no raw `defineAction` handlers bypass it.
- **RLS present but PERMISSIVE — no ownership.** RLS is *enabled* on all domain tables, but every policy is `for all to authenticated using (true) with check (true)` ([`20260602185012_minimal_domain_schema.sql:163-174`](https://github.com/dobrek/ib-timetable-planner/blob/f2ee0ac47c3a4597b4ccedc40175bc7d684f9246/supabase/migrations/20260602185012_minimal_domain_schema.sql#L163-L174), same on teacher-availability + slot-bundles migrations). **No ownership column exists anywhere** — grep for `author_id|owner_id|created_by|user_id` across `supabase/migrations/` returns nothing; `plans` has no author FK. `clone_plan` + `replace_cohort_groupings` RPCs are `SECURITY INVOKER` (no added isolation). So today: "authenticated = full access," not per-author ownership.
- **Auth/RLS test coverage = none.** Only `requireSession` is touched, and only via a **mocked** `ActionAPIContext` unit test (`define-domain-action.test.ts:46-60`). No middleware test; no integration test asserts UNAUTHORIZED / unauthenticated rejection / cross-author isolation; all 9 integration suites use the **service-role key, which bypasses RLS**. No auth-user / second-author factory exists.

This fully grounds the locked direction: **Risk #5 (auth/RLS/PII) is the NEXT phase and a genuine full gap** — promote it ahead of the drag-loop phase.

## Code References

- `src/_pages/plan-detail/model/constraints/index.ts` — `CELL_CONSTRAINTS` registry (4 classes); `explainCell` / `violatesAny` — the single collision entry point.
- `src/_pages/plan-detail/model/collisions.test.ts:24-46` — Risk #1 independent-oracle rejection test (hand-typed literals).
- `src/_pages/plan-detail/model/constraints/teacher-conflict.ts:8-24` — in-cell teacher reuse only; **no cross-cohort dimension** (S-09 absent).
- `src/_pages/plan-detail/model/constraints/types.ts:15` — design-note comment naming cross-cohort occupancy as a future additive field.
- `src/_pages/plan-detail/api/placement-actions.ts`, `grouping-actions.ts` — placement/grouping mutations as Astro Actions (API route migrated away).
- `src/pages/api/auth/signin.ts`, `signout.ts` — the **only** remaining API routes.
- `src/shared/lib/actions/require-session.ts:3-12` — `/_actions/*` exemption rationale + the `UNAUTHORIZED` guard.
- `src/shared/lib/actions/define-domain-action.test.ts:46-137` — wrapper contract (auth / error-translation / null-client), unit + mocked.
- `src/_pages/plan-detail/api/endpoint.integration.test.ts:8-12,36-79` — drives the **domain fn** (not HTTP); persistence read-back.
- `src/test/factories/` — 10 builders (barrel + concept-files); `lifecycle.smoke.integration.test.ts:59-124` durability + cascade-teardown.
- `src/test/no-seed-coupling.test.ts` — `Seed Plan A/B` grep guard over integration suites.
- `src/test/load-test-env.ts` — Supabase env loader; throws when `CI==="true"` + env missing.
- `.github/workflows/ci.yml:~34-77` — `integration` job (seed regen → trimmed Supabase → `pnpm test:integration --maxWorkers=2`).
- `supabase/migrations/20260602185012_minimal_domain_schema.sql:150-174` — RLS enabled, permissive `using(true)`, no ownership column.
- `context/foundation/prd.md:57,130,131,158` — corrected risk-evidence anchors (see C1).
- `context/foundation/roadmap.md:226-238` — S-09 (`blocked`); S-03 `done` / S-05 `proposed` / S-08 `blocked`.
- `context/foundation/test-plan.md:87` — phantom `testing-validator-trust-core/` reference (the line to delete).

## Architecture Insights

- **The FSD refactor erased the "two mutation styles" surface.** Risk #3's original premise (Actions *and* API routes both being Supabase boundaries) collapsed: all app-data mutations/compute are now Astro Actions; `src/pages/api/` is reserved for auth session endpoints. The "untested boundary" worth testing is the **Action wrapper over a real HTTP `/_actions/*` request**, not a separate API route. The guide's §2/§3 route language must follow this.
- **Validation and persistence are decoupled.** The collision validator is a pure in-memory board check; the write path does not re-run it as a persistence gate. Risk #1 ("a false positive *ships*") is only fully closed by a test that proves the *server* refuses to persist a clash — which does not exist yet. The guide should keep that distinction explicit rather than treating the unit oracle as full Risk #1 coverage.
- **RLS is the *only* potential row-isolation barrier, and it is currently off in practice** (permissive policies, no ownership column, service-role tests bypass it). Risk #5 is therefore not just "untested auth" — it is "ownership not yet modeled." Any auth/RLS rollout phase must reckon with adding an ownership column + real policies before cross-author tests can mean anything.
- **The harness is built to be parallel-safe by construction** (plan-rooted ownership + grep guard + CI fail-on-missing-env), which is why the integration lane could be added to CI without seed coupling. This is the foundation the auth-user/second-author factory (Risk #5) will extend.

## Historical Context (from prior changes)

- `context/changes/data-for-e2e-and-integration-tests/{change,plan,plan-brief,research}.md` — the shipped Phase 0 harness; explicitly **deferred** Playwright/e2e, real-Action HTTP integration tests, and all RLS/auth-user work (the latter named as the Risk #5 follow-up). This is the authority for what Phase 0 did vs left open.
- `context/archive/2026-06-08-architecture-refactor/` — the FSD relocation that landed; grounds the §1 principle #4 past-tense rewrite (net held green, grew; baseline 15 tests recorded).
- `context/foundation/lessons.md` — "Astro Actions are the single transport for app-data mutations and compute" (the rule that makes the API-route language stale) and "Catalog CRUD integration tests belong in the test harness" (manual sign-off is insufficient).

## Related Research

- `context/changes/data-for-e2e-and-integration-tests/research.md` — prior research for the harness change; already notes the phantom folder "not yet on disk" (`:405`) and the oracle-independence reasoning for Risk #1.

## Open Questions

1. **Phase 1 disposition (C2):** does the user prefer Phase 1 *merged into* Phase 0, or *kept and relabeled* "complete (absorbed)" with the route language corrected? Either resolves the double-count — this is a wording choice for `/10x-plan`.
2. **Risk #1 server-gate scope:** should the guide add an explicit (currently-unmet) criterion that the *write path* rejects a known collision, or leave that to whenever a server-side re-validation gate is built? Today no such test or gate exists.
3. **Ownership modeling for Risk #5:** the auth/RLS phase presupposes an ownership column + real policies that do not exist yet. Is adding them in-scope for the Risk #5 rollout phase, or a prerequisite change the guide should name as a dependency?
