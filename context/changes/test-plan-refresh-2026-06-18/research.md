---
date: 2026-06-18T23:45:30+02:00
researcher: Dobromir Kropielnicki
git_commit: bb1a5688911fb38fedcef904c2fafb4c2fd453ef
branch: main
repository: ib-timetable-planner
topic: "Ground the test-plan.md refresh brief (post-demo domain-fidelity change wave)"
tags: [research, codebase, test-plan, roadmap, prd, foundation-refresh]
status: complete
last_updated: 2026-06-18
last_updated_by: Dobromir Kropielnicki
---

# Research: Ground the test-plan.md refresh brief

**Date**: 2026-06-18T23:45:30+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: bb1a5688911fb38fedcef904c2fafb4c2fd453ef (`bb1a568`, pushed to `origin/main`)
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

Confirm the exact lines, counts, slice IDs, statuses, and codebase facts that the
`test-plan-refresh-2026-06-18` brief depends on, so the guide
(`context/foundation/test-plan.md`) can be refreshed without re-introducing drift.
This change **edits the guide only** — it writes no tests. Research is a
verification pass against a precise checklist (see `change.md` Notes).

## Summary

**Verdict: the brief is accurate. Every numeric/line/slice claim it asks us to
"confirm in research" checks out against the live codebase at `bb1a568`.** The
guide (`test-plan.md`) is stamped `2026-06-15` and is now stale on six fronts the
brief identified. Confirmed facts, ready to edit in:

- **PRD line cites** all land on the rewritten PRD (`prd.md`, created 2026-06-18):
  L166 (no-false-positive), L173 (durability), L379 + L434 (no access-control
  change). The new PRD explicitly states **NO access-control change** → Risk #5
  PII framing softens to "preserve the author-only privacy invariant," not a
  change-introduced surface.
- **Roadmap** (`roadmap.md`, rewritten 2026-06-18): the old **S-09 no longer
  exists**. The top slice is S-08 (`editing-undo-redo`, `blocked`). The
  enriched-dimension false-positive **family** maps cleanly to **S-02 / S-03 /
  S-04 / S-06**, bundle durability to **S-05 / S-07**. **All eight slices are
  unbuilt** (Done section empty) — so the family is a forward/refresh inference,
  not a testable-today defect.
- **Counts**: unit **55** (53 co-located + 2 infra-guard), integration **10**
  (was 9 at the prior refresh; Phase 2 added the action-boundary suite), e2e **4
  specs**, migrations **14** (newest `20260618203532_grant_service_role…`).
- **Dep versions** exact: astro **6.4.8**, vitest **4.1.9**, @playwright/test
  **1.61.0**, wrangler **4.102.0**.
- **Phase 2 is complete and archived** at
  `context/archive/2026-06-15-testing-auth-actions-boundary-rls/`; cross-author /
  IDOR and the `createPlan` UI happy-path e2e are explicitly **deferred**.

**Three incidental findings beyond the brief** (call-outs for `/10x-plan`):
1. The cross-cohort design-note comment is at `constraints/types.ts:13-17` (the
   old `types.ts:15` anchor sits inside it) — moot, since the brief drops anchors
   for Risk #6 anyway.
2. **Code residue:** `src/_pages/plan-detail/api/load.ts:14` still carries a stale
   `"Year 2 arrives with S-09"` comment — the old roadmap's slice ID leaking into
   source. Out of scope for this doc-only change, but worth a follow-up code cleanup.
3. The roadmap's own Baseline says "**13** migrations" (`roadmap.md:59`) — already
   one behind; the tree has **14**. The brief's "→14" is the correct figure.

## Detailed Findings

### 1. PRD line cites (Risk source column, §2)

The PRD was rewritten 2026-06-18 (`context/foundation/prd.md`, `created: 2026-06-18`,
brownfield post-demo change; the prior product PRD is archived at
`context/foundation/archive/prd-2026-06-18-1646.md` per `prd.md:20-22`). The brief's
re-cites all confirm:

| Brief mapping | New PRD line | Verbatim anchor |
|---|---|---|
| L57 → **L166** (no false-positive) | `prd.md:166-170` | "**Collision correctness (preserved + extended).** No false-positive 'valid' across the new dimensions: … students, *both* teachers of a co-taught course, week-aware fortnightly overlaps, and cross-cohort teacher occupancy." |
| L130 → **L173** (durability) | `prd.md:173-174` | "**Existing board-state durability is preserved** — no silent loss of in-progress work on an accidental browser refresh or tab close." |
| L131/L158 → **L379** (access control, Constraints) | `prd.md:379` | "**No access control change** (email + password, single Author role)." |
| L131/L158 → **L434** (Access Control Changes §) | `prd.md:434-437` | "**No access control changes — current model preserved.** … Every author retains full create/edit/delete over the plan and its catalog." |

**Privacy framing (for softening Risk #5):** the surviving privacy invariant is the
guardrail at `prd.md:177` — "**Privacy (preserved).** Student names and choices
remain author-only." Combined with L379/L434, the new PRD introduces **no**
access-control surface. So Risk #5 should reframe from "a new access-control gap"
to "preserve the existing author-only privacy invariant; per-author RLS / cross-author
IDOR is a *deferred, prerequisite-gated* concern (Phase 2.5), not a change-introduced
risk." This matches the Phase 2 deferral (see §6 below).

**L166-170 is the single best anchor for the whole enriched-dimension family** — it
literally enumerates co-teaching (both teachers), week-aware fortnightly, and
cross-cohort teacher occupancy as the no-false-positive surface. The mechanics are
spelled out in the PRD's "Unified collision rule" (`prd.md:394-400`), "Co-teaching"
(`prd.md:402-407`), and "Symmetric cross-cohort teacher occupancy" (`prd.md:409-415`).

### 2. Roadmap slice IDs, statuses, and the S-09 reframe (§2 Risk #6, §3 Phase 4)

The roadmap was rewritten 2026-06-18 (`roadmap.md`, `created/updated: 2026-06-18`;
old product-build roadmap archived at `context/foundation/archive/2026-06-18-roadmap.md`,
`roadmap.md:15`). Confirmed slice table (`roadmap.md:30-39`):

| ID | Change ID | Theme | PRD refs | Status |
|---|---|---|---|---|
| S-01 | dp1-dp2-cohort-naming | DP1/DP2 relabel | FR-004 | **ready** |
| **S-02** | co-teaching-teacher-sets | co-teaching, both teachers occupied | FR-001, FR-012 | **ready** |
| **S-03** | bi-weekly-week-aware-validation | bi-weekly opposite-week overlap (unified rule) | FR-002, FR-003, US-03 | **proposed** |
| **S-04** | two-cohort-board-cross-cohort | symmetric cross-cohort teacher occupancy + free switching | FR-005, FR-006 | **proposed** |
| **S-05** | first-class-bundle-operations | bundle move/remove/replace | FR-009, FR-010 | **ready** |
| **S-06** | combined-two-cohort-view (north star) | both cohorts at once | FR-007, FR-008, US-01 | **proposed** |
| **S-07** | bundle-holding-container | park bundle off-board, survives refresh | FR-011, US-02, Secondary | **proposed** |
| S-08 | editing-undo-redo | undo/redo | FR-013 | **blocked** |

**The old "S-09" is gone.** The current guide's Risk #6 cites "roadmap S-09
(L226–238)" and "S-09, currently `blocked` on prereq S-08" (`test-plan.md:63`) — both
references are now non-existent. The new roadmap tops out at S-08 (`editing-undo-redo`,
`blocked` on undo-scope Open Q #1 — `roadmap.md:39,173-184`), a completely different
slice from the old S-08/S-09.

**Enriched-dimension false-positive FAMILY (Risk #6 reframe), grounded:**
- **S-02 co-teaching** — both teachers count as occupied (`roadmap.md:33,93-104`; PRD
  `prd.md:402-407`). Constraint chain head.
- **S-03 bi-weekly opposite-week overlap** — the unified collision rule rewrite
  (`roadmap.md:34,106-118`; PRD `prd.md:394-400`). "The deepest, most invasive change"
  (`roadmap.md:117`).
- **S-04 cross-cohort symmetric teacher occupancy** (`roadmap.md:35,120-131`; PRD
  `prd.md:409-415`). "The hardest correctness slice."
- **S-06 both-cohorts-at-once** — the combined view validates against both cohorts
  simultaneously (`roadmap.md:37,147-158`; PRD guardrail `prd.md:165`).

Impact **High** × Likelihood **High** is defensible: each is a *new false-positive
class* under the L166-170 guardrail, on the highest-churn subsystem (plan-detail, 212
hot-spot edits/30d). **But all four slices are unbuilt** — so the correct framing is
**refresh inference / not-yet-live**, response = **a parity harness per slice**, NOT a
testable-today defect. **No file anchors** (the classes don't exist yet).

**Bundle / parked-bundle durability risk (new §2 risk, S-05/S-07):**
- **S-05 first-class bundle** (`roadmap.md:36,133-145`) — `ready`; today a bundle is a
  derived flag, move = delete+recreate (PRD `prd.md:60-64`).
- **S-07 holding container** (`roadmap.md:38,160-171`) — `proposed`; **Secondary
  Success Criterion**: a parked bundle survives refresh (`prd.md:157-158`,
  `roadmap.md:164`). The durability NFR is the load-bearing requirement
  (`roadmap.md:170`). Impact High × Likelihood Medium is sound (forward inference;
  Q1 fear #2 "bundle work loss" + Q3 low-confidence "bundle persistence"). Lessons.md
  flags the persistence mechanism risk directly: guard `localStorage` with try/catch
  (`lessons.md:40-45`, cited by `roadmap.md:169`).

**§3 Phase 4 sequencing flag for /10x-plan:** S-03 is the unified-rule rewrite and is
`proposed` (prereq S-02). **S-02 is the *first* touch of the protected core and is
already `ready`** ("First touch of the protected constraint core" — `roadmap.md:103`).
So the parity-harness convention (Phase 4) has urgency: the brief asks for it **before
S-03's rewrite**, but because S-02 also edits `teacher-conflict`/`teacher-availability`
and is plannable now, the stronger position is **land the harness convention before
S-02**. Flag this tension explicitly when planning.

### 3. Test + migration counts (§4 Stack)

Counted at `bb1a568`:

- **Unit: 55** `*.test.ts` files under `src/` (excluding `*.integration.test.ts`),
  matching the guide's "53 co-located + 2 infra-guard." The 2 infra-guards are
  `src/test/no-seed-coupling.test.ts` and `src/test/seed-transcode-identity.test.ts`.
  → **count unchanged (55)**; the brief keeps it and re-centres principle #4 on it.
- **Integration: 10** (`*.integration.test.ts`, repo-wide) — **up from 9** at the prior
  refresh. The new suite is the Phase 2 boundary test
  `src/_pages/plans-list/api/action-boundary.integration.test.ts`. Full list:
  `lifecycle.smoke`, plan-detail `endpoint` / `slot-bundles` / `adapter-parity` /
  `load`, plans-list `clone-plan` / `action-boundary` / `plan-actions`, teachers
  `teacher-availability`, students `students-crud`. → **9 → 10**.
- **e2e: 4 spec files** in `e2e/specs/`: `auth.spec.ts`, `auth-guard.spec.ts`,
  `action-unauth.spec.ts`, `seed.spec.ts`. `e2e/auth.setup.ts` is the **setup
  project**, not a spec. (Phase 2 shipped 3 assertion specs; `seed.spec.ts` was added
  since.) Note: the guide's §4 "Three projects" refers to Playwright **projects**
  (`setup`, `chromium`, `chromium-guard`) — distinct from spec count, **no conflict**.
  → record **4 e2e specs**.
- **Migrations: 14** `.sql` files in `supabase/migrations/`; newest is
  `20260618203532_grant_service_role_table_access.sql` (the `bb1a568`-era
  service_role grant). → **→14**. (Roadmap Baseline still says 13 — `roadmap.md:59` —
  it's one behind; 14 is correct.)

### 4. Dependency versions (§4 Stack, `checked:` → 2026-06-18)

Installed versions (`node_modules/<pkg>/package.json`), all matching the brief:

| Package | Installed | Brief target | Match |
|---|---|---|---|
| astro | 6.4.8 | 6.4.8 | ✓ |
| vitest | 4.1.9 | 4.1.9 | ✓ |
| @playwright/test | 1.61.0 | 1.61 | ✓ |
| wrangler | 4.102.0 | 4.102 | ✓ |
| @astrojs/cloudflare | 13.7.0 | — | (fyi) |

`package.json` declares matching caret ranges (`^6.4.8`, `^4.1.9`, `^1.61.0`,
`^4.102.0`). → bump §4 `checked:` and §8 "Stack versions last verified" to
**2026-06-18**.

### 5. Current collision-core state (grounds the "not-yet-live, no anchors" framing)

The validator is the **original four-class within-cell core** — none of the enriched
dimensions have shipped (confirms every enriched-family risk is forward inference):

1. **Registered constraints** (`constraints/index.ts:9-14`): `duplicateCourse`,
   `teacherConflict`, `studentConflict`, `teacherAvailability` — all within-cell.
2. **Single teacher** (not a set): `GroupingCourse.teacherKey: string | null`
   (`src/shared/lib/catalog-hash/types.ts:8-13`); `teacher-conflict.ts:14` and
   `teacher-availability.ts:25` reference the singular `teacherKey`. → S-02 territory.
3. **No week/fortnight dimension**: `PlannerPlacement = { id, courseId, day, period }`
   (`model/placement.ts:2-6`); cell key is `${day}:${period}` (`model/collisions.ts:8`).
   → S-03 territory.
4. **Single-cohort lock**: `const BOARD_COHORT: Cohort = "dp1"`
   (`src/_pages/plan-detail/api/load.ts:15`); no cross-cohort constraint registered.
   → S-04 territory. (Line 14 above it carries the stale `S-09` comment — see Open Qs.)
5. **Cross-cohort design note** (additive, not built):
   `constraints/types.ts:13-17` — "*board-only constraints (cross-cohort occupancy,
   teacher availability) add optional fields here additively, without touching existing
   evaluators.*" (The old guide's `types.ts:15` anchor lives inside this block.)
6. **Files the unified rule (S-03) would rewrite**: `model/collisions.ts`
   (`deriveCellViolations` :41), `model/collision.ts` (`hasIntersection` :10),
   `model/drop-hints.ts` (`deriveDropHints` :90, `classifyCell` :147),
   `model/constraints/*`, `model/slot-bundle.ts` (`isBundled` :23).
7. **Risk #1 reference test exists**: `src/_pages/plan-detail/model/collisions.test.ts`
   (independent-oracle, hand-typed expectations).

**This is the live grounding for keeping §1 principle #4 and making it MORE central:**
the 55 unit tests (above all `collisions.test.ts`) are the safety net the S-02 → S-04
collision-core rewrite — especially S-03's unified-rule rewrite of `collisions.ts` /
`collision.ts` / `drop-hints.ts` — must survive without behavioral change.

### 6. Phase 2 completion + folder (§3 Phase 2, §6.3, §7)

Phase 2 is **complete and archived** at
`context/archive/2026-06-15-testing-auth-actions-boundary-rls/` (the guide still calls
it `implementing` with folder `context/changes/testing-auth-actions-boundary-rls/` —
`test-plan.md:94`). What shipped (per its `change.md` / `plan.md`):
- Auth + Astro Actions boundary + RLS/PII tests; **hybrid** e2e (3 assertion specs) +
  Vitest integration (`DomainError`→`ActionError` matrix for `CONFLICT`/`NOT_FOUND`,
  malformed-input rejection, `createPlan` persistence at the `.handler` layer).
- New CI **`e2e` job** gating deploy; a `GRANT … TO authenticated` migration pinning
  table reachability.
- **Explicitly deferred** (→ §7 additions): (a) the **cross-author / IDOR half of
  Risk #5** — waits on an ownership-column + real per-author RLS prerequisite (today
  RLS is permissive `using(true)` and integration uses the service-role key, which
  bypasses RLS) — candidate Phase 2.5; (b) the **`createPlan` UI-driven happy-path
  e2e**.

The §7 exclusions and the sub-200ms / IDOR decisions trace to the **Phase 2 interview
Q5** (already the cited source in `test-plan.md:287-304`). This refresh's interview
signal (Phase 2, 2026-06-18) confirms Q5: keep §7, **don't CI-gate sub-200ms** (avoid a
flaky perf gate — manual/feel verification), defer cross-author IDOR.

## Code References

- `src/_pages/plan-detail/model/constraints/index.ts:9-14` — the 4 registered cell constraints
- `src/_pages/plan-detail/model/constraints/teacher-conflict.ts:14` — singular `teacherKey`
- `src/_pages/plan-detail/model/constraints/teacher-availability.ts:25` — singular `teacherKey`
- `src/_pages/plan-detail/model/constraints/types.ts:13-17` — cross-cohort design note (additive)
- `src/_pages/plan-detail/model/placement.ts:2-6` — `PlannerPlacement` (no week dimension)
- `src/_pages/plan-detail/model/collisions.ts:8,41` — `cellKey`, `deriveCellViolations`
- `src/_pages/plan-detail/model/collision.ts:10` — `hasIntersection` fast-path
- `src/_pages/plan-detail/model/drop-hints.ts:90,147` — `deriveDropHints`, `classifyCell`
- `src/_pages/plan-detail/model/slot-bundle.ts:23` — derived `isBundled`
- `src/_pages/plan-detail/model/collisions.test.ts` — Risk #1 independent-oracle test
- `src/_pages/plan-detail/api/load.ts:14-15` — `BOARD_COHORT = "dp1"` + stale `S-09` comment
- `src/shared/lib/catalog-hash/types.ts:8-13` — `GroupingCourse.teacherKey: string | null`
- `supabase/migrations/20260618203532_grant_service_role_table_access.sql` — 14th migration
- `e2e/specs/{auth,auth-guard,action-unauth,seed}.spec.ts` — 4 e2e specs; `e2e/auth.setup.ts` — setup project

## Edit-ready facts (brief instruction → confirmed value)

| Brief instruction | Confirmed | Source |
|---|---|---|
| §2 L57 → L166 (no false-positive) | ✓ L166-170 | `prd.md:166` |
| §2 L130 → L173 (durability) | ✓ L173-174 | `prd.md:173` |
| §2 L131/L158 → L379/L434 (no access-control change) | ✓ L379, L434 (+privacy L177) | `prd.md:379,434,177` |
| §2 Risk #6 cites non-existent S-09 | ✓ no S-09 in new roadmap | `roadmap.md:30-39` |
| §2 family = S-02/S-03/S-04/S-06 | ✓ exact map | `roadmap.md:33-37` |
| §2 family Impact High × Likelihood High, not-yet-live, no anchors | ✓ all 4 unbuilt | `roadmap.md` Done § empty |
| §2 bundle durability = S-05/S-07, High × Medium | ✓ | `roadmap.md:36,38,164,170` |
| §2 sub-200ms NOT a CI gate (manual/feel) | ✓ Q5 decision | Phase 2 interview Q5 |
| §3 Phase 2 → complete, folder 2026-06-15-testing-auth-actions-boundary-rls | ✓ archived | `context/archive/2026-06-15-testing-auth-actions-boundary-rls/` |
| §3 Phase 4 owns enriched wave; harness before S-03 | ✓ (consider before S-02 too) | `roadmap.md:103,117` |
| §3 Phase 3 next-active (optimistic loop + reload-restore) | ✓ Q3/Q4 | `test-plan.md:95` |
| §4 unit 55 | ✓ | `find src -name '*.test.ts'` = 55 |
| §4 integration 9 → 10 | ✓ +action-boundary | 10 `*.integration.test.ts` |
| §4 e2e 4 specs | ✓ | `e2e/specs/*.spec.ts` = 4 |
| §4 migrations → 14 | ✓ | `supabase/migrations/*.sql` = 14 |
| §4 astro 6.4.8 / vitest 4.1.9 / playwright 1.61 / wrangler 4.102 | ✓ all exact | `node_modules/*/package.json` |
| §4/§8 checked: → 2026-06-18 | (edit) | — |
| §7 add sub-200ms-not-CI-gated + cross-author-IDOR-deferred | ✓ grounded | Phase 2 deferrals + Q5 |
| §8 re-stamp 2026-06-18 + change-wave trigger | (edit) | — |

## Architecture Insights

- **The protected constraint core is intact and pre-enrichment.** All four collision
  classes are within-cell, single-teacher, single-cohort, week-agnostic. Every
  enriched dimension the PRD adds is a *new* class on this core — which is exactly why
  the brief frames the false-positive family as forward inference and elevates the
  parity harness (Phase 4) to own the whole wave.
- **The hot-spot ranking (plan-detail 212 / courses 131 / shared-lib 88 / teachers 85,
  src/ 30d) is likelihood evidence, not anchors** — it concentrates on `plan-detail`,
  the home of the constraint core the enriched slices rewrite. Consistent with rating
  the family's likelihood High.
- **Astro Actions are the sole mutation transport** (`lessons.md:19-24`), so Risk #3
  and Risk #5 are correctly framed at the Action boundary, and the closed-author
  model (no self-signup) keeps the IDOR attacker pool small/trusted — supporting the
  deferral, not dismissal, of cross-author tests.
- **Doc-only change discipline:** this refresh must not touch tests or the four-class
  core. The one in-code residue it surfaces (the `S-09` comment at `load.ts:14`) is a
  *finding to flag*, not an edit to make here.

## Historical Context (from prior changes)

- `context/changes/test-plan-refresh-2026-06-15/` — the **prior refresh** of the same
  guide (post-FSD). It established the 55-unit / 9-integration baseline, re-anchored
  stale pre-FSD directories to FSD paths, removed a phantom rollout folder, and
  **introduced the old "S-09" cross-cohort risk framing** (Impact High / Likelihood
  Medium, not-testable-until-shipped). This 2026-06-18 refresh supersedes that S-09
  framing because the roadmap was rewritten and S-09 no longer exists.
- `context/archive/2026-06-15-testing-auth-actions-boundary-rls/` — **Phase 2**. Shipped
  the auth/Actions/RLS hybrid suite + the first Playwright harness + the CI `e2e` job;
  deferred cross-author/IDOR and the `createPlan` UI happy-path e2e. Its `plan.md`
  already noted §3/§6.3 of `test-plan.md` must be reconciled (e2e moved into Phase 2,
  not Phase 3 wholesale) — this refresh closes that loop.
- `context/foundation/archive/prd-2026-06-18-1646.md` and
  `context/foundation/archive/2026-06-18-roadmap.md` — the superseded product PRD and
  roadmap. The drifted line cites and the S-09 reference in the current guide point at
  these archived docs.

## Related Research

- `context/changes/test-plan-refresh-2026-06-15/research.md` — prior-refresh codebase
  research (path re-anchoring, 55/9 baseline) at an earlier commit.
- `context/archive/2026-06-15-testing-auth-actions-boundary-rls/research.md` — Phase 2
  auth/Actions boundary research.

## Open Questions

1. **Stale `S-09` code comment** at `src/_pages/plan-detail/api/load.ts:14`
   ("Year 2 arrives with S-09"). Out of scope for this doc-only refresh; flag for a
   future code cleanup (rename to the new S-04 slice, or drop). **Not** an edit to make
   in `test-plan.md`.
2. **Phase 4 harness sequencing** — the brief says "before S-03's rewrite," but S-02
   (`ready`) is the first core touch. `/10x-plan` should decide whether the parity-harness
   convention must land before **S-02** rather than just before S-03. (Recorded as a
   sequencing flag, not a blocker — this change only re-stamps the guide.)
3. **Integration +1 attribution** — the 9→10 delta is the Phase 2
   `action-boundary.integration.test.ts`; if the guide wants to name it, this is the
   suite. Otherwise just record the count `10`.
