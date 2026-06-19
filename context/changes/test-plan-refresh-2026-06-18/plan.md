# Test Plan Guide Refresh (post-demo domain-fidelity wave) Implementation Plan

## Overview

Refresh `context/foundation/test-plan.md` — the project's phased-test-rollout guide —
so it reflects the **post-demo domain-fidelity change wave**. The PRD and roadmap were
rewritten 2026-06-18 (old roadmap archived), Phase 2 of the rollout shipped and was
archived, and a dependency-bump + migration wave landed. The guide is stamped
`2026-06-15` and is now stale on six fronts: drifted PRD line cites, a Risk #6 that
references a now-deleted roadmap slice ("S-09"), a Phase 2 still marked `implementing`,
stale test/migration counts and dep versions, and a missing record of two team decisions
(sub-200ms-not-CI-gated, cross-author-IDOR-deferred).

**This change edits the guide only. It writes no tests and touches no application code.**
Every numeric, line, slice, and count fact has already been verified against the live
codebase at commit `bb1a568` by `research.md` — this plan executes those verified edits;
it does not re-discover them.

## Current State Analysis

`context/foundation/test-plan.md` (321 lines, stamped 2026-06-15) is internally
consistent but points at superseded sources:

- **§1 Strategy** — four principles. Principle #4 ("tests are the refactor safety net")
  describes the FSD refactor as the anticipated refactor; the *next* refactor (the
  enriched collision-core rewrite) is not yet named.
- **§2 Risk Map** — Risks #1–#6 ordered by impact × likelihood. PRD cites point at the
  archived PRD (L57/L130/L131/L158). Risk #5 frames PII as a possible new access-control
  gap. Risk #6 cites roadmap **S-09** ("L226–238", "blocked on prereq S-08") — a slice
  that no longer exists in the rewritten roadmap.
- **§3 Phased Rollout** — Phase 2 is `implementing` with folder
  `context/changes/testing-auth-actions-boundary-rls/`; Phase 4 "owns S-09."
- **§4 Stack** — "55 unit + 9 integration", e2e count implicit, migrations not counted;
  versions read "(see lockfile)"; tool `checked:` dates are 2026-06-15.
- **§5 Quality Gates** — phase-coupled ("required after §3 Phase N").
- **§7 Deliberately Don't Test** — four exclusions, all sourced to the Phase 2 interview.
- **§8 Freshness Ledger** — all three "last verified" lines read 2026-06-15.

`research.md` confirms the live counts/versions/slice map and supplies the verified
replacement values (see **Key Discoveries**). The protected four-class constraint core is
intact and **pre-enrichment** — all enriched dimensions (co-teaching teacher-sets,
week-aware fortnightly, cross-cohort occupancy, both-cohorts-at-once) are unbuilt, which
is why every enriched-family risk is *forward inference*, not a testable-today defect.

## Desired End State

`context/foundation/test-plan.md` reflects the codebase and product docs at `bb1a568`:

- §1 principle #4 re-centred on the S-02→S-04 collision-core rewrite (esp. S-03's
  unified-rule rewrite) as the next refactor the 55 unit tests must survive.
- §2 PRD cites land on the rewritten PRD; Risk #5 reframed to "preserve the author-only
  privacy invariant"; Risk #6 reframed from S-09 to the **enriched-dimension
  false-positive family** (S-02/S-03/S-04/S-06, High × High, not-yet-live, no anchors);
  a new Risk #7 captures bundle/parked-bundle durability (S-05/S-07, High × Medium); a
  prose note records the sub-200ms budget + the not-a-CI-gate decision.
- §3 Phase 2 → `complete` (archived folder); Phase 3 cued **next active**; Phase 4
  sharpened to own the whole enriched wave, with the harness convention sequenced
  **before S-02** (latest-acceptable: before S-03).
- §4 counts and versions corrected (unit 55, integration 10, e2e 4, migrations 14, exact
  dep versions); §5 gates consistent with Phase 2 now complete.
- §7 gains two exclusions (sub-200ms-not-CI-gated, cross-author-IDOR-deferred).
- §8 re-stamped 2026-06-18 with the change-wave trigger recorded.

**Verification:** `grep` shows no `S-09` and no old PRD cites (L57/L130/L131/L158) remain
in the guide; the new cites (L166/L173/L379/L434) and corrected counts are present; a
human read-through confirms the reframed risks and sequencing read coherently.

### Key Discoveries:

- **PRD re-cites land** (`research.md:69-95`, `prd.md`): L57→**L166** (no false-positive),
  L130→**L173** (durability), L131/L158→**L379** + **L434** (no access-control change);
  surviving privacy invariant at **L177** ("Student names and choices remain author-only").
- **S-09 is gone** (`research.md:97-135`, `roadmap.md:30-39`): the new roadmap tops out at
  S-08 (`editing-undo-redo`, `blocked`). Enriched-dimension family = **S-02** (co-teaching,
  `ready`) / **S-03** (bi-weekly unified rule, `proposed`) / **S-04** (cross-cohort
  occupancy, `proposed`) / **S-06** (both-cohorts-at-once, `proposed`); bundle durability =
  **S-05** (`ready`) / **S-07** (`proposed`). **All eight slices unbuilt** → forward inference.
- **Counts** (`research.md:156-179`): unit **55** (unchanged), integration **9→10**
  (Phase 2 added `action-boundary.integration.test.ts`), e2e **4 specs**, migrations **14**
  (newest `20260618203532_grant_service_role_table_access.sql`).
- **Dep versions** (`research.md:181-195`): astro **6.4.8**, vitest **4.1.9**,
  @playwright/test **1.61.0**, wrangler **4.102.0**.
- **Phase 2 archived** at `context/archive/2026-06-15-testing-auth-actions-boundary-rls/`
  (`research.md:229-249`); cross-author/IDOR + the `createPlan` UI happy-path e2e deferred.
- **Sequencing tension** (`research.md:148-154`): the brief says "harness before S-03," but
  S-02 is the first `ready` core touch — record **before S-02** as the recommendation,
  before S-03 as the latest-acceptable bound (decision confirmed in planning).
- **Code residue** (`research.md:338-341`): a stale `"Year 2 arrives with S-09"` comment at
  `src/_pages/plan-detail/api/load.ts:14` — out of scope here, flagged for a follow-up.

## What We're NOT Doing

- **No test code, no application code.** This change edits one Markdown file. The four-class
  constraint core, the 55 unit / 10 integration / 4 e2e suites, and all migrations are
  untouched.
- **Not editing the `S-09` code residue** at `src/_pages/plan-detail/api/load.ts:14`. It is
  a real finding but out of scope for this doc-only change. **Follow-up:** open a separate
  small code-cleanup change to rename it to S-04 or drop it (see References).
- **Not renumbering Risks #1–#6.** Existing numbers are stable identifiers cross-referenced
  in the §2 Risk Response table, §3 "Risks covered", and §5 Quality Gates; renumbering risks
  breaking those references. New risks append.
- **Not re-running `/10x-research`.** Research is complete; this plan trusts its verified facts.
- **Not adding a scored §2 table row for the sub-200ms budget** — it is a budget + governance
  decision, not a "validator marks X valid" failure scenario, so it lives as a prose note
  plus a §7 exclusion (no invented impact/likelihood).
- **Not fixing the roadmap's own "13 migrations" baseline drift** (`roadmap.md:59`) — that is
  a roadmap edit, not a test-plan edit.

## Implementation Approach

Sweep the guide top-to-bottom in three cohesive phases, each a self-contained, reviewable
slice of the document:

1. **§1–§2 (Strategy + Risk Map)** — the inference-heavy core: re-center principle #4,
   correct PRD cites, soften Risk #5, reframe Risk #6, append Risk #7, add the sub-200ms note,
   and extend the Risk Response table.
2. **§3–§5 (Rollout + Gates)** — reconcile phase statuses and folders, sharpen Phase 4 with
   the before-S-02 sequencing, confirm §5 gates track Phase 2 completion.
3. **§4 / §7 / §8 (Stack, Exclusions, Freshness)** — mechanical count/version/date corrections,
   two new §7 exclusions, and the §8 re-stamp with the change-wave trigger.

Each phase's automated verification is `grep`-based (the guide is a Markdown doc, not built
code): assert that stale tokens are gone and the verified replacements are present. Manual
verification is a coherence read-through of the affected sections.

## Critical Implementation Details

- **Numbering stability is load-bearing.** Risk #6 is reframed *in place* (same number, new
  content); Risk #7 (bundle durability) is appended. Because the table claims to be "ordered
  by risk = impact × likelihood" but the reframed High×High #6 now sits below the High×Medium
  #3–#5, add a one-line note under the table that ordering is approximate for the forward-
  inference rows — do not re-sort.
- **Risk #6 carries no file anchors.** The enriched-dimension classes do not exist yet; the
  Source column must read as refresh inference grounded in `roadmap.md` + `prd.md:166-170`,
  explicitly "no code anchor — class not built". Adding an anchor would be a factual error.
- **Phase 4 sequencing wording.** Record "land the parity-harness convention **before S-02**
  (the first `ready` touch of the protected core)"; keep "before S-03's unified-rule rewrite"
  as the latest-acceptable bound. Do not state it as before-S-03 only.

## Phase 1: §1 Strategy + §2 Risk Map

### Overview

Refresh the analytical core of the guide: re-center principle #4 on the coming collision-core
rewrite, correct all PRD line cites, soften Risk #5, reframe Risk #6 to the enriched-dimension
family, append Risk #7 for bundle durability, add the sub-200ms prose note, and extend the
Risk Response guidance table to cover the new/changed risks.

### Changes Required:

#### 1. §1 Principle #4 — re-center on the next refactor

**File**: `context/foundation/test-plan.md` (§1, ~L31-43)

**Intent**: Keep principles 1–4 intact, but update principle #4 so the "anticipated refactor"
language points forward to the enriched collision-core rewrite (S-02→S-04, esp. S-03's
unified-rule rewrite) as the next refactor the 55 unit tests — above all
`collisions.test.ts` — must survive without behavioral change. The FSD refactor stays
recorded as the *prior* one that already landed.

**Contract**: Prose edit to the principle #4 paragraph. Preserve the "observable behavior at a
stable boundary" framing and the interview-Q2 reference. Name the S-02→S-04 rewrite as the
forward case; keep the count phrasing consistent with §4 (55 unit).

#### 2. §2 Risk Map — PRD cites + Risk #5 softening

**File**: `context/foundation/test-plan.md` (§2 table, rows #1/#4/#5; §2 intro)

**Intent**: Replace drifted PRD line cites with the verified ones and reframe Risk #5 from a
possible new access-control gap to preservation of the existing author-only privacy invariant
(the new PRD makes **no** access-control change).

**Contract**: In the Source column — Risk #1 `L57` → `L166`; Risk #4 `L130` → `L173`; Risk #5
`L131`/`L158` → `L379`/`L434` (+ privacy `L177`). Risk #5 risk-text reframes to "preserve the
author-only privacy invariant; per-author RLS / cross-author IDOR is a deferred,
prerequisite-gated concern (Phase 2.5), not a change-introduced surface." Keep Risk #5's number,
impact, and likelihood.

#### 3. §2 Risk #6 — reframe S-09 → enriched-dimension false-positive family

**File**: `context/foundation/test-plan.md` (§2 table, row #6)

**Intent**: Reframe Risk #6 in place from the deleted S-09 cross-cohort risk to the
enriched-dimension false-positive **family**: a new false-positive class could pass under the
L166 no-wrong-positive guardrail as each enriched dimension ships. Rate **Impact High ×
Likelihood High**. Label explicitly as refresh inference / not-yet-live, with the response being
a parity harness per slice (the §3 Phase 4 gate), not a testable-today defect.

**Contract**: Risk #6 risk-text enumerates the family — S-02 co-teaching (both teachers
occupied), S-03 bi-weekly opposite-week overlap, S-04 cross-cohort symmetric teacher occupancy,
S-06 both-cohorts-at-once. Impact `High`, Likelihood `High`. Source column = refresh inference
grounded in `roadmap.md` (S-02/S-03/S-04/S-06) + `prd.md:166-170`; **no code anchor — classes
not built**. Remove every "S-09" / "L226–238" / "blocked on prereq S-08" / "types.ts:15" string
from this row.

#### 4. §2 Risk #7 — append bundle / parked-bundle durability

**File**: `context/foundation/test-plan.md` (§2 table, new row #7)

**Intent**: Append a new risk: a bundle move/remove/replace or a parked off-board bundle loses
in-progress work (no silent loss on refresh/tab-close). Rate **Impact High × Likelihood
Medium**. Forward inference (slices unbuilt).

**Contract**: New row `| 7 |` after Risk #6. Impact `High`, Likelihood `Medium`. Source =
roadmap S-05 (`first-class-bundle-operations`, `ready`) / S-07 (`bundle-holding-container`,
Secondary success criterion: parked bundle survives refresh) + PRD durability `L173`; interview
Q1 fear #2 + Q3 low-confidence. Note the `localStorage` try/catch persistence guard
(`lessons.md:40-45`) as the implementation pitfall when the slices ship.

#### 5. §2 — sub-200ms budget prose note

**File**: `context/foundation/test-plan.md` (§2, after the Risk Response table)

**Intent**: Record the sub-200ms placement-validation budget together with the team decision
that it is **NOT a CI gate** — verified manually / by feel — and the rationale (avoid a flaky
perf gate). Not a scored table row.

**Contract**: A short prose paragraph after the §2 Risk Response Guidance table. State the
budget, the not-a-CI-gate decision, the manual/feel verification, and the why (flaky-perf-gate
avoidance). Source: Phase 2 interview Q5 + the 2026-06-18 refresh interview. Cross-reference §7.

#### 6. §2 Risk Response Guidance table — extend for changed/new risks

**File**: `context/foundation/test-plan.md` (§2 Risk Response Guidance table; ordering note)

**Intent**: Update the Risk Response row for the reframed Risk #6 (family parity guard, no
testable-today path), add a row for Risk #7 (bundle durability reload/park survival), and add a
one-line note that the table ordering is approximate for the forward-inference rows.

**Contract**: Risk #6 response row reframes to the enriched-family parity fixture (expected
values from requirements, guarded as each class is added) — drop the S-09-specific wording.
New Risk #7 response row: prove a bundle op + a parked bundle survive reload; cheapest layer
integration; anti-pattern = asserting the write vs asserting restore. Add the approximate-
ordering note beneath the §2 risk table.

### Success Criteria:

#### Automated Verification:

- No deleted slice id remains: `grep -n "S-09" context/foundation/test-plan.md` returns nothing
- Old PRD cites gone: `grep -nE "L57|L130|L131|L158" context/foundation/test-plan.md` returns nothing
- New PRD cites present: `grep -nE "L166|L173|L379|L434" context/foundation/test-plan.md` returns matches
- Risk #7 row exists: `grep -nE "^\| 7 \|" context/foundation/test-plan.md` returns a match
- sub-200ms note present: `grep -in "200" context/foundation/test-plan.md` returns the budget note

#### Manual Verification:

- Principle #4 reads as forward-pointing at the S-02→S-04 rewrite (esp. S-03), FSD refactor kept as prior
- Risk #5 reads as "preserve author-only invariant; IDOR deferred to Phase 2.5", not a new gap
- Risk #6 reads as the enriched-dimension family (S-02/S-03/S-04/S-06), labeled forward-inference / not-yet-live, no code anchor
- Risk #7 (bundle durability) reads coherently with its S-05/S-07 source and the localStorage guard pitfall
- The approximate-ordering note makes the High×High #6 below High×Medium #3–#5 intelligible

**Implementation Note**: After completing this phase and all automated verification passes,
pause for human confirmation that the §1–§2 read-through is coherent before proceeding.

---

## Phase 2: §3 Phased Rollout + §5 Quality Gates

### Overview

Reconcile the rollout table and notes with what actually shipped: Phase 2 is complete and
archived, Phase 3 is the next active phase, and Phase 4 is sharpened to own the whole enriched
wave with the harness convention sequenced before S-02. Confirm §5 gates track Phase 2 completion.

### Changes Required:

#### 1. §3 Phase 2 → complete + archived folder

**File**: `context/foundation/test-plan.md` (§3 rollout table, Phase 2 row; §3 notes)

**Intent**: Move Phase 2 from `implementing` to `complete` and repoint its change folder to the
archived location. Keep the hybrid e2e + integration description, which is accurate.

**Contract**: Phase 2 Status `implementing` → `complete`; Change folder
`context/changes/testing-auth-actions-boundary-rls/` →
`context/archive/2026-06-15-testing-auth-actions-boundary-rls/`. The §3 Phase 2 note keeps the
deferrals (cross-author/IDOR half of #5 → Phase 2.5; `createPlan` UI happy-path e2e) and the
"introduced the first Playwright harness + CI `e2e` job gating deploy" facts.

#### 2. §3 Phase 3 → next active

**File**: `context/foundation/test-plan.md` (§3 rollout table, Phase 3 row)

**Intent**: Cue Phase 3 (drag → validate → feedback loop + persistence reload-restore) as the
**next active** phase — the optimistic reconciliation loop is the #1 under-tested worry (interview
Q3+Q4) — and fold bundle-persistence durability in as S-05/S-07 ship.

**Contract**: Add the `**next active**` cue to the Phase 3 Phase-name cell (the cue is not a
status value; status stays `not started`). Note that bundle-persistence durability folds in as
the bundle slices ship.

#### 3. §3 Phase 4 → own the enriched wave + sequencing

**File**: `context/foundation/test-plan.md` (§3 rollout table, Phase 4 row; §3 notes)

**Intent**: Sharpen Phase 4 from "owns S-09" to owning the **whole enriched-dimension wave**
(S-02/S-03/S-04/S-06), and record the sequencing recommendation: the parity-harness convention
should land **before S-02** (the first `ready` touch of the protected core), with **before S-03**
(the unified-rule rewrite) as the latest-acceptable bound.

**Contract**: Phase 4 Goal/Risks-covered drop "S-09" and reference the enriched family + the
§2 Risk #6 reframe. Add a §3 note stating the before-S-02 sequencing recommendation and the
before-S-03 latest-acceptable bound, flagged for each slice's `/10x-plan`.

#### 4. §5 Quality Gates — track Phase 2 completion

**File**: `context/foundation/test-plan.md` (§5 gates table)

**Intent**: Confirm the "auth + RLS ownership integration — required after §3 Phase 2" gate now
reads as active (Phase 2 complete), and the "drag→feedback e2e — required after §3 Phase 3" gate
remains pending. No structural change unless a gate's wording still implies Phase 2 is in flight.

**Contract**: Verify/adjust §5 phase-coupled wording so it is consistent with Phase 2 = complete
and Phase 3 = next active. No renumbering of gates.

### Success Criteria:

#### Automated Verification:

- Phase 2 no longer `implementing`: `grep -n "implementing" context/foundation/test-plan.md` returns nothing in the §3 table
- Archived folder referenced: `grep -n "archive/2026-06-15-testing-auth-actions-boundary-rls" context/foundation/test-plan.md` returns a match
- Old non-archived folder gone: `grep -n "changes/testing-auth-actions-boundary-rls" context/foundation/test-plan.md` returns nothing
- Phase 4 sequencing recorded: `grep -n "before S-02" context/foundation/test-plan.md` returns a match

#### Manual Verification:

- Phase 3 is clearly cued **next active**; status vocabulary still parses
- Phase 4 reads as owning the enriched-dimension wave (S-02/S-03/S-04/S-06), not S-09
- The before-S-02 / before-S-03 sequencing flag reads correctly for downstream `/10x-plan`
- §5 gates are consistent with Phase 2 complete / Phase 3 pending

**Implementation Note**: After this phase and automated verification, pause for human
confirmation that the §3–§5 reconciliation reads correctly before proceeding.

---

## Phase 3: §4 Stack + §7 Exclusions + §8 Freshness

### Overview

Apply the mechanical corrections — counts, versions, and `checked:` dates — plus the two new §7
exclusions and the §8 re-stamp with the change-wave trigger. Flag (do not fix) the `S-09` code
residue as a follow-up.

### Changes Required:

#### 1. §4 Stack — counts and versions

**File**: `context/foundation/test-plan.md` (§4 stack table + grounding-tools block)

**Intent**: Correct the test/migration counts and pin exact dependency versions, and bump the
tool `checked:` dates to 2026-06-18.

**Contract**: unit **55** (unchanged); integration **9 → 10** (name the added suite
`action-boundary.integration.test.ts` from Phase 2); e2e record **4 specs**
(`auth`, `auth-guard`, `action-unauth`, `seed`; `auth.setup.ts` is the setup project, not a spec —
keep the "three Playwright projects" wording, which is distinct from spec count); migrations
**→ 14** (newest `20260618203532_grant_service_role_table_access.sql`). Replace "(see lockfile)"
where the brief targets exact versions, or add them in Notes: astro **6.4.8**, vitest **4.1.9**,
@playwright/test **1.61.0**, wrangler **4.102.0**. Grounding-tools `checked:` dates → 2026-06-18.

#### 2. §7 — two new exclusions

**File**: `context/foundation/test-plan.md` (§7 list)

**Intent**: Add the two team decisions as deliberate exclusions: the sub-200ms budget is **not
CI-gated** (manual/feel, flaky-perf-gate avoidance), and cross-author / IDOR testing is
**deferred** (waits on the ownership-column + real per-author RLS prerequisite — candidate
Phase 2.5).

**Contract**: Two new bullets in §7 (total 4 → 6), each with its source: sub-200ms decision
(Phase 2 interview Q5 + 2026-06-18 refresh interview) and cross-author/IDOR deferral (Phase 2
deferral). Keep the existing four exclusions verbatim.

#### 3. §8 — re-stamp + change-wave trigger

**File**: `context/foundation/test-plan.md` (§8 freshness ledger + the header "Last updated" line)

**Intent**: Re-stamp the three "last verified" lines and the document header to 2026-06-18, and
record that this refresh was triggered by the post-demo domain-fidelity change wave (PRD +
roadmap rewrite, Phase 2 ship, dep-bump + migration wave).

**Contract**: §8 "Strategy last reviewed", "Stack versions last verified", "AI-native tool
references last verified" → 2026-06-18; header `Last updated:` line → 2026-06-18 with a short
change-wave descriptor. Optionally add a one-line ledger entry noting the trigger.

### Success Criteria:

#### Automated Verification:

- Counts present: `grep -nE "10 integration|integration.*10|14 migration|4 e2e|55 unit" context/foundation/test-plan.md` returns matches
- Exact versions present: `grep -nE "6\.4\.8|4\.1\.9|1\.61|4\.102" context/foundation/test-plan.md` returns matches
- Dates re-stamped: `grep -c "2026-06-18" context/foundation/test-plan.md` returns ≥4 (header + §4 tools + three §8 lines)
- §7 grew by two: `grep -in "200\|IDOR\|cross-author" context/foundation/test-plan.md` returns the new exclusions

#### Manual Verification:

- §4 counts/versions match `research.md` exactly; "three Playwright projects" vs "4 specs" distinction preserved
- §7's two new exclusions read coherently with their sources and don't contradict §2/§3
- §8 + header re-stamp records the change-wave trigger
- The plan's "What We're NOT Doing" flags the `load.ts:14` S-09 residue follow-up (no code edited)

**Implementation Note**: After this phase and automated verification, pause for a final
full-document read-through confirming the guide is internally consistent end-to-end.

---

## Testing Strategy

This is a documentation change; there is no code under test. "Testing" is verification that the
edited guide is factually correct against `research.md` and internally consistent.

### Unit Tests:

- None. No source code changes.

### Integration Tests:

- None. No source code changes.

### Manual Testing Steps:

1. Full read-through of `context/foundation/test-plan.md` top-to-bottom — confirm §1–§8 are
   internally consistent (no risk references a slice/section that no longer exists).
2. Cross-check every §4 count and version and every §2 PRD cite against the `research.md`
   "Edit-ready facts" table — each must match.
3. Confirm no `S-09`, no `L57/L130/L131/L158`, and no `changes/testing-auth-actions-boundary-rls`
   (non-archived) strings remain.
4. Confirm Risk numbering #1–#7 is internally referenced consistently in §2/§3/§5.
5. (Optional) Run `/verify` to confirm the doc change did not disturb the CI gate — the guide is
   not compiled, so this should be a no-op pass, but it confirms nothing else regressed.

## Performance Considerations

None. Documentation-only change.

## Migration Notes

None. No schema or data changes. (The "14 migrations" figure is reported, not applied.)

## References

- Change brief: `context/changes/test-plan-refresh-2026-06-18/change.md`
- Grounding research: `context/changes/test-plan-refresh-2026-06-18/research.md`
- Guide under refresh: `context/foundation/test-plan.md`
- Rewritten sources: `context/foundation/prd.md` (L166/L173/L177/L379/L434),
  `context/foundation/roadmap.md` (S-01…S-08, slice table L30-39)
- Archived Phase 2: `context/archive/2026-06-15-testing-auth-actions-boundary-rls/`
- Prior refresh: `context/changes/test-plan-refresh-2026-06-15/`
- **Follow-up (out of scope here):** stale `S-09` comment at
  `src/_pages/plan-detail/api/load.ts:14` — open a separate code-cleanup change to rename it to
  S-04 or drop it (`research.md:338-341`).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: §1 Strategy + §2 Risk Map

#### Automated

- [x] 1.1 No deleted slice id remains (`grep "S-09"` empty) — e68e597
- [x] 1.2 Old PRD cites gone (`grep "L57|L130|L131|L158"` empty) — e68e597
- [x] 1.3 New PRD cites present (`grep "L166|L173|L379|L434"` matches) — e68e597
- [x] 1.4 Risk #7 row exists (`grep "^| 7 |"` matches) — e68e597
- [x] 1.5 sub-200ms note present (`grep "200"` matches the budget note) — e68e597

#### Manual

- [x] 1.6 Principle #4 re-centred on the S-02→S-04 rewrite (esp. S-03), FSD kept as prior — e68e597
- [x] 1.7 Risk #5 reframed to "preserve author-only invariant; IDOR deferred to Phase 2.5" — e68e597
- [x] 1.8 Risk #6 reads as the enriched-dimension family, forward-inference / not-yet-live, no anchor — e68e597
- [x] 1.9 Risk #7 bundle durability coherent with S-05/S-07 + localStorage guard pitfall — e68e597
- [x] 1.10 Approximate-ordering note makes the High×High #6 placement intelligible — e68e597

### Phase 2: §3 Phased Rollout + §5 Quality Gates

#### Automated

- [x] 2.1 Phase 2 no longer `implementing` in the §3 table — b792bae
- [x] 2.2 Archived folder referenced (`grep "archive/2026-06-15-testing-auth-actions-boundary-rls"`) — b792bae
- [x] 2.3 Old non-archived folder gone (`grep "changes/testing-auth-actions-boundary-rls"` empty) — b792bae
- [x] 2.4 Phase 4 sequencing recorded (`grep "before S-02"` matches) — b792bae

#### Manual

- [x] 2.5 Phase 3 cued **next active**; status vocabulary still parses — b792bae
- [x] 2.6 Phase 4 reads as owning the enriched-dimension wave (S-02/S-03/S-04/S-06) — b792bae
- [x] 2.7 before-S-02 / before-S-03 sequencing flag reads correctly for downstream `/10x-plan` — b792bae
- [x] 2.8 §5 gates consistent with Phase 2 complete / Phase 3 pending — b792bae

### Phase 3: §4 Stack + §7 Exclusions + §8 Freshness

#### Automated

- [x] 3.1 Counts present (`grep "10 integration|14 migration|4 e2e|55 unit"`) — 25868bb
- [x] 3.2 Exact versions present (`grep "6.4.8|4.1.9|1.61|4.102"`) — 25868bb
- [x] 3.3 Dates re-stamped (`grep -c "2026-06-18"` ≥ 4) — 25868bb
- [x] 3.4 §7 grew by two new exclusions (sub-200ms-not-CI-gated + cross-author-IDOR-deferred) — 25868bb

#### Manual

- [x] 3.5 §4 counts/versions match research exactly; "three Playwright projects" vs "4 specs" preserved — 25868bb
- [x] 3.6 §7's two new exclusions coherent with sources; no contradiction with §2/§3 — 25868bb
- [x] 3.7 §8 + header re-stamp records the change-wave trigger — 25868bb
- [x] 3.8 Plan flags the `load.ts:14` S-09 residue follow-up (no code edited) — 25868bb
