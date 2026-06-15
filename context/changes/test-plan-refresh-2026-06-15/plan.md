# Test-Plan Guide Refresh (post-FSD, rollout drift) Implementation Plan

## Overview

Rewrite `context/foundation/test-plan.md` so every section reflects the live
codebase after the 2026-06-08 FSD architecture refactor landed, the shipped
integration harness (`data-for-e2e-and-integration-tests`, closed 2026-06-15),
and the locked rollout re-sequencing (auth/RLS promoted ahead of the drag loop).
This change **edits the guide** — it writes no tests. The `/10x-test-plan
--refresh` direction authorizes editing the frozen strategy half (§1/§2), not
just the rollout/cookbook half (§3/§6).

The rewrite is grounded by `research.md`, which verified nearly every claim in
`change.md` against commit `f2ee0ac` and flagged four corrections (C1–C4) plus a
data-quality bug in an archived change. Four planning decisions resolve the
research's open questions (see Key Discoveries).

## Current State Analysis

`context/foundation/test-plan.md` is stamped "Last updated: 2026-06-08" and
describes a pre-FSD world that no longer exists:

- **§1 principle #4** is written in the future tense ("a structural refactor is
  anticipated and not yet done … build the behavioral net (Phases 1–2) first,
  then refactor under it"). The refactor **landed** (archived
  `2026-06-08-architecture-refactor`, all 5 phases checked off).
- **§2 Risk Map** Source column cites pre-FSD hot-spot dirs that are gone:
  `src/lib/placements`, `src/components/planner`, `src/components/auth`,
  `src/pages/api` (for placements/grouping). It also cites PRD lines L56 / L129 /
  L130 / L167 that have **drifted** (the L129 cite now lands on the wrong NFR).
- **§3 Phased Rollout** references a **phantom** change folder
  `testing-validator-trust-core/` (zero git trace), marks Phase 1 around an
  `placements`/`grouping` **API route that no longer exists** (migrated to Astro
  Actions), and orders the drag loop ahead of auth — the opposite of the locked
  direction.
- **§4 Stack** says "15 test files today, 13 in `src/lib`." Live tree: **55 unit
  + 9 integration**, a factory harness in `src/test/factories/`, and a CI
  integration lane — none of which existed at the last review.
- **§6.1 / §7** point at `__tests__/` dirs and `src/components/ui` / `src/lib/grouping`
  paths that are gone; tests are co-located `*.test.ts` siblings under FSD slices,
  shadcn primitives live at `src/shared/ui`, grouping core at
  `model/compute-groupings.ts`.
- **§8 Freshness Ledger** dates are all 2026-06-08; the refactor trigger it lists
  as a refresh condition has fired.

Separately, the archived `context/archive/2026-06-08-architecture-refactor/change.md`
has a **duplicate `archived_at` key** (L7 timestamp, L8 `null`) — a strict YAML
parser keeps the last key, silently nulling the archive timestamp.

## Desired End State

`context/foundation/test-plan.md` reads as an accurate guide for the *current*
tree: FSD paths throughout, the harness reconciled as a complete Phase 0, a
re-sequenced rollout with auth/RLS as the next phase, the S-09 risk promoted and
honestly labeled, the four research corrections applied, and a 2026-06-15
freshness stamp. The archived change.md carries a single valid `archived_at`.

**Verify**: no stale token (`src/lib/placements`, `src/components/planner`,
`src/components/auth`, `src/lib/grouping`, `src/components/ui`, `__tests__`,
`testing-validator-trust-core`) survives in the guide; the new FSD paths and the
55/9 counts are present; the rollout table matches the target sequence; prettier
formats the file clean; the archive change.md has exactly one `archived_at`.

### Key Discoveries:

- **Research is same-commit fresh** (`research.md`, commit `f2ee0ac`, today) — no
  codebase re-research needed; it already mapped every path and count.
- **C1 — PRD line drift** (`research.md:106-117`): cite **L57** (no-wrong-positive),
  **L130** (Work durability), **L131** (Data privacy), **L158** (Access Control).
  The old L129 cite silently mis-points to "Validation responsiveness."
- **C2 — Phase 1 inconsistency** (`research.md:81-89`): the `placements`/`grouping`
  API route migrated to Astro Actions (`src/pages/api/` now holds only
  `auth/signin.ts`, `auth/signout.ts`); "#3 (route)" is double-counted across
  Phase 0 and Phase 1; no discrete Phase 1 change ever shipped.
  **Decision: keep a Phase 1 row, relabel it "complete (absorbed)", correct
  "API hot-path" → "domain persist path (route migrated to Actions)", and strip
  "#3 (route)" from it so Phase 0 alone owns the boundary.**
- **C3 — §1 #4 rewrite** (`research.md:91-97`): the archive shows a *pre-existing*
  net holding green through a relocation. Keep the past-tense rewrite; do **not**
  strengthen it into "we built the net first, then refactored under it."
- **C4 — S-09 framing** (`research.md:99-104`): roadmap/PRD describe the
  *constraint to add* (S-09 `blocked`, prereq S-08 `blocked`), not a defect. The
  false-positive wording is the refresh's own interpretation — label it as such.
- **Decision: Risk #1 server-persist gate** — validation and persistence are
  decoupled (`research.md:151`); add an **explicit, currently-unmet** criterion
  that the server write path must refuse to persist a known collision.
- **Decision: Risk #5 ownership prerequisite** — RLS policies are permissive
  `using(true)`, no ownership column exists, integration tests use the
  service-role key that bypasses RLS (`research.md:119-126`). Name an ownership
  column + real policies as an **explicit prerequisite dependency** of the
  auth/RLS phase.
- **Decision: archive fix in-scope** — remove the duplicate `archived_at` in the
  archived change.md as Phase 4.
- **Status vocabulary is parser-literal** (`test-plan.md:92-93`): `not started` →
  `change opened` → `researched` → `planned` → `implementing` → `complete`. The
  target table adds `complete` (valid) and a "NEXT" emphasis — keep the literal
  status values intact and express "NEXT" as a separate cue, not a new status token.

## What We're NOT Doing

- **Not writing or modifying any tests**, factories, CI config, or app code.
- **Not editing the PRD, roadmap, or lessons.md** — C1 corrects the guide's
  *citations*, not the PRD itself (the PRD lines are correct; only the cites drifted).
- **Not building** the S-09 constraint class, the Risk #1 server re-validation
  gate, or the Risk #5 ownership column — the guide *documents* these as
  pending/prerequisite; implementing them is future rollout-phase work.
- **Not re-running codebase research** — `research.md` is authoritative and fresh.
- **Not changing §6.2** (integration cookbook) substance — research confirms the
  plan-rooted factory pattern there is already current; only verify, don't rewrite.

## Implementation Approach

Edit the guide top-to-bottom in three section-grouped phases (strategy → rollout
→ reference), then a fourth tiny phase for the archive fix. Phasing follows the
reader's path through the document so each phase leaves the guide internally
coherent and independently reviewable. Cross-reference integrity is the main
risk: re-sequencing §3 ripples into §5 (gate "Phase N" rows) and §6 (cookbook
"see §3 Phase N" pointers), so Phase 2 and Phase 3 must re-point those together.

Verification is grep-based (stale tokens absent, new paths present) plus a
prettier format check and a careful manual read for coherence and the C3/C4
wording nuances that grep cannot catch.

## Critical Implementation Details

- **Cross-reference ordering.** The §3 re-sequence (Phase 2 = auth/RLS, Phase 3 =
  drag loop) inverts the current order. Every "Phase N" reference in §5 Quality
  Gates and §6.3/§6.4/§6.5 cookbook must be re-pointed to the new numbers in the
  same pass that renumbers §3, or the guide will cross-link to the wrong phase.
- **C3 wording trap.** When rewriting §1 principle #4 to past tense, do not import
  "build the net first, then refactor under it" — the live history is "a
  pre-existing net held green through the relocation." This is a wording
  constraint grep cannot verify; it is a manual-review checkpoint.
- **Status-token discipline.** "NEXT" is not a status value. Keep the §3 Status
  column to the parser-literal vocabulary and mark the next active phase with a
  separate, non-status cue so the orchestrator's parser stays valid.

## Phase 1: Strategy & Risk Map (§1–§2 + header)

### Overview

Bring the frozen strategy half up to date: past-tense the refactor principle,
re-anchor the risk evidence to FSD dirs and correct PRD lines, add the S-09 risk
(honestly labeled), and add the explicit unmet Risk #1 server-persist criterion.

### Changes Required:

#### 1. Header freshness stamp

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that this is a refresh, not the 2026-06-08 Phase-1 open.

**Contract**: The blockquote "Last updated:" line (≈L9). Change to
`2026-06-15 (refresh — post-FSD, rollout re-sequenced)`.

#### 2. §1 principle #4 — past-tense rewrite (C3-safe)

**File**: `context/foundation/test-plan.md`

**Intent**: Rewrite the "refactor anticipated / not yet done" principle to record
that the refactor landed and an existing behavioral net held green through it,
while preserving the still-valid rule ("assert observable behavior at stable
boundaries"). Drop the "build Phases 1–2 first, then refactor" sequencing.

**Contract**: §1 item 4 (L31–42). Past tense; the net "held green through a
5-phase FSD relocation" and grew (15 → 55 unit + 9 integration since that
baseline). Do **not** assert build-first sequencing (C3). Keep the Phase 4 parity
gate reference. Update §1.4's closing pointer if it names a now-renumbered phase.

#### 3. §2 Risk Map — Source-column FSD re-anchor + PRD line corrections (C1)

**File**: `context/foundation/test-plan.md`

**Intent**: Replace gone hot-spot dirs with FSD evidence dirs and fix the drifted
PRD citations, keeping the "evidence, not anchor" convention (no `file:line`).

**Contract**: §2 table rows #1–#5 Source column (L57–61):
- Risk #1: `src/lib/placements` + `src/pages/api` → `src/_pages/plan-detail/{model,api}`;
  PRD **L56 → L57**.
- Risk #2: `src/components/planner` + `src/pages/api` → `src/_pages/plan-detail/{ui,api}`.
- Risk #3: keep the Actions/route framing's *evidence* but correct it to
  "Actions are the sole mutation transport" (route gone) — see change #5 below.
- Risk #4: PRD **L129 → L130** (Work durability); hot-spot dir → `src/_pages/plan-detail/api`.
- Risk #5: PRD **L130 → L131** (Data privacy), **L167 → L158** (Access Control);
  `src/components/auth` → `src/_pages/sign-in/ui` + `src/pages/auth`; keep the
  `/_actions/*`-exempt note.

#### 4. §2 Risk #1 — explicit unmet server-persist criterion (Decision 2)

**File**: `context/foundation/test-plan.md`

**Intent**: Make the validation/persistence decoupling visible so a reader does
not mistake the in-memory unit oracle for full Risk #1 closure.

**Contract**: §2 Risk-Response table Risk #1 row (L73) — add to "What would prove
protection" (or a parenthetical) that full closure also requires a test proving
the **server write path refuses to persist a known collision**, and note it is
**currently unmet** (no server re-validation gate exists; validation is a pure
in-memory board check). Frame as an open criterion, not a shipped guarantee.

#### 5. §2 Risk #3 — drop the dead API-route half

**File**: `context/foundation/test-plan.md`

**Intent**: The "both Astro Actions and API routes are Supabase boundaries"
premise collapsed — all app-data mutations/compute are Actions now.

**Contract**: §2 Risk #3 cell (L59) and the Risk-Response Risk #3 row (L75):
recast the untested boundary as "the Action wrapper over a real HTTP `/_actions/*`
request" rather than "a real Action *and* the placements API route." Keep the
auth-enforcement / error-translation / persistence / untrusted-input surface.

#### 6. §2 — add risk S-09 (cross-cohort teacher collision), labeled as inference (C4)

**File**: `context/foundation/test-plan.md`

**Intent**: Promote S-09 into the Risk Map per the locked direction, worded as the
refresh's own risk interpretation grounded in the no-wrong-positive guardrail —
not as a roadmap quote.

**Contract**: New §2 table row (e.g. "#6 / S-09"): Impact High / Likelihood Medium.
Description states this is the refresh's inference — *if/when* the cross-cohort
teacher class ships (roadmap S-09, currently `blocked` on S-08), the validator
could mark a Y2 placement valid that reuses a Y1-occupied teacher (a new
false-positive class), per the L57 guardrail. Source column: roadmap S-09
(L226–238), PRD L57; **no code anchor** (class not built — `types.ts:15` carries
only a design-note comment). Note explicitly: **not testable until S-09 ships**;
response is the §3 Phase 4 parity gate. Add a matching Risk-Response row pointing
to Phase 4.

### Success Criteria:

#### Automated Verification:

- No stale risk-evidence tokens remain in §1–§2: `grep -nE 'src/lib/placements|src/components/(planner|auth)' context/foundation/test-plan.md` returns nothing.
- Corrected PRD anchors present: `grep -nE 'L57|L130|L131|L158' context/foundation/test-plan.md` matches the four cites.
- S-09 row present: `grep -n 'S-09' context/foundation/test-plan.md` matches.
- Prettier formats clean: `pnpm exec prettier --check context/foundation/test-plan.md`.

#### Manual Verification:

- §1 principle #4 reads in past tense and does **not** claim build-first sequencing (C3).
- The S-09 row reads as the refresh's inference, not a roadmap quote (C4).
- The Risk #1 server-persist criterion reads as currently-unmet, distinct from the unit oracle.
- Risk #3 no longer references a placements/grouping API route.

**Implementation Note**: After this phase and all automated verification passes,
pause for human confirmation that the §1–§2 read is correct before proceeding.

---

## Phase 2: Phased Rollout & Quality Gates (§3 + §5)

### Overview

Re-sequence §3 to the target table (harness as complete Phase 0, Phase 1
relabeled "complete (absorbed)", auth/RLS promoted to the next phase carrying the
ownership prerequisite, drag loop and parity following), delete the phantom
folder, and re-point §5's gate "Phase N" references to the new sequence.

### Changes Required:

#### 1. §3 Phased Rollout — re-sequence to target table

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the 4-row pre-FSD rollout with the re-sequenced target,
reconciling the shipped harness and promoting auth ahead of the drag loop.

**Contract**: §3 table (L85–90). New rows (status uses parser-literal values;
"NEXT" expressed as a non-status cue):

| # | Phase | Risks | Status |
|---|-------|-------|--------|
| 0 | Integration harness + CI lane (`data-for-e2e-and-integration-tests`) | enabler; #1, #3 (persist half), #4 (partial) | complete |
| 1 | Validator trust core (independent oracle) — **complete (absorbed)**; domain persist path (route migrated to Actions) | #1 | complete |
| 2 | Auth + Astro Actions boundary + RLS / PII — **next active** | #5, #3 (Actions) | not started |
| 3 | Drag → validate → feedback loop + persistence reload-restore | #2, #4 (reload-restore) | not started |
| 4 | Parity harness for new validator classes (owns S-09) | #1-class, S-09 | not started |

Notes under the table: Phase 1 absorbed into organic feature/refactor growth (no
discrete change shipped); **"#3 (route)" removed** — Phase 0 owns the boundary
(C2). Phase 2 carries an explicit **prerequisite**: an ownership column + real
per-author RLS policies must land before cross-author tests are meaningful
(today policies are permissive `using(true)`, service-role tests bypass RLS) —
Decision 3. Map Phase 0's three risks honestly to the harness (research §3:
Risk #1 oracle holds; Risk #3 persist-half only, Actions-HTTP + auth boundary
still unit-only; Risk #4 write-read-back holds, reload-restore deferred to Phase 3).

#### 2. §3 — remove phantom change folder

**File**: `context/foundation/test-plan.md`

**Intent**: Delete the only on-disk origin of the phantom folder.

**Contract**: The "Change folder" cell `context/changes/testing-validator-trust-core/`
(L87). Replace Phase 0's folder cell with the real
`context/changes/data-for-e2e-and-integration-tests/`; leave unstarted phases' folder cell `—`.

#### 3. §5 Quality Gates — re-point Phase references

**File**: `context/foundation/test-plan.md`

**Intent**: Keep the "Required after §3 Phase N" rows aligned to the new sequence
(auth/RLS now Phase 2, drag→feedback now Phase 3, parity still Phase 4).

**Contract**: §5 table (L124–131) "Required?" column: auth+RLS gate → "after §3
Phase 2"; drag→feedback e2e gate → "after §3 Phase 3"; unit+integration gate →
"after §3 Phase 1" stays valid (now complete); parity gate → "after §3 Phase 4".

### Success Criteria:

#### Automated Verification:

- Phantom folder gone: `grep -n 'testing-validator-trust-core' context/foundation/test-plan.md` returns nothing.
- Real Phase 0 folder present: `grep -n 'data-for-e2e-and-integration-tests' context/foundation/test-plan.md` matches.
- "complete (absorbed)" present and "#3 (route)" absent from §3: `grep -n 'absorbed' context/foundation/test-plan.md` matches; `grep -n '#3 (route)' context/foundation/test-plan.md` returns nothing.
- Prettier formats clean: `pnpm exec prettier --check context/foundation/test-plan.md`.

#### Manual Verification:

- §3 rows match the target sequence; Status column uses only parser-literal values; "next active" cue is not a status token.
- Phase 2 names the ownership-column prerequisite clearly.
- §5 gate "Phase N" references all resolve to the correct new-sequence phase.

**Implementation Note**: Pause for human confirmation that the §3/§5
re-sequencing and cross-references read correctly before proceeding.

---

## Phase 3: Stack, Cookbook, Don't-Test & Freshness (§4, §6, §7, §8)

### Overview

Update the reference half: real test counts and harness/CI facts (§4), co-located
test location and re-pointed cookbook stubs (§6), FSD don't-test paths (§7), and
2026-06-15 freshness dates with the refactor trigger logged resolved (§8).

### Changes Required:

#### 1. §4 Stack — counts, harness, CI lane, e2e status

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "15 files, 13 in `src/lib`" snapshot with the live base.

**Contract**: §4 table (L100–111). Unit row: **55 unit** (note: 53 slice-source
co-located + 2 infra-guard suites in `src/test/`) — drop the `src/lib`
concentration claim. Integration row: **9 integration**, factory harness at
`src/test/factories/`, live **CI integration lane** (seed regen → trimmed
Supabase → `pnpm test:integration --maxWorkers=2`); correct the "both Actions and
API routes" note to Actions-only via `/_actions/*`. e2e row: still **none**
(Playwright candidate-only). Bump the four `checked:` tool dates (L108–111) to
2026-06-15.

#### 2. §6.1 — co-located unit-test location

**File**: `context/foundation/test-plan.md`

**Intent**: Kill the `__tests__/` convention; tests are co-located `*.test.ts`
siblings under FSD slices.

**Contract**: §6.1 (L138–147). Location → co-located `*.test.ts` next to source
(e.g. `src/_pages/plan-detail/model/collision.test.ts`); remove the
`src/lib/placements/__tests__/` example and the dead
`validate.test.ts` reference test → use `model/collisions.test.ts` (the live
Risk #1 independent-oracle example).

#### 3. §6.4 / §6.5 — re-point cookbook stubs

**File**: `context/foundation/test-plan.md`

**Intent**: §6.4 ("new API endpoint") described a placements API hot-path that no
longer exists; §6.5 ("new Astro Action") must point at the auth/Actions phase's
new number.

**Contract**: §6.4 (L203–207): re-scope to the remaining real API routes
(`src/pages/api/auth/*`) or note the placement/grouping hot path moved to Actions
(§6.5); point to §3 Phase 2. §6.5 (L209–213): "see §3 Phase 2" (was Phase 3);
keep the `requireSession` / `DomainError`→`ActionError` / RLS substance, correct
the "already-covered `src/lib/courses`" path to its FSD location. §6.2 substance
unchanged (verify only).

#### 4. §7 — FSD don't-test paths

**File**: `context/foundation/test-plan.md`

**Intent**: Re-anchor the negative-space paths; substance (shadcn, marketing,
generated types, grouping parity) is unchanged.

**Contract**: §7 bullets (L225–238): `src/components/ui/*` → `src/shared/ui/*`;
grouping core `src/lib/grouping` → `model/compute-groupings.ts` (parity oracles
at `api/parity.test.ts`).

#### 5. §8 — Freshness Ledger dates + resolved trigger

**File**: `context/foundation/test-plan.md`

**Intent**: Stamp the refresh and record that the refactor-landed trigger fired
and is resolved.

**Contract**: §8 (L240–253): the three "last reviewed/verified" dates → 2026-06-15;
annotate the "anticipated architecture refactor … lands" refresh-trigger bullet
as **resolved 2026-06-15** (refactor landed; this refresh re-anchored the boundaries).

### Success Criteria:

#### Automated Verification:

- No `__tests__` or pre-FSD reference paths remain: `grep -nE '__tests__|src/lib/grouping|src/components/ui' context/foundation/test-plan.md` returns nothing.
- Live counts present: `grep -nE '55 unit|9 integration' context/foundation/test-plan.md` matches.
- Freshness dates bumped: `grep -n '2026-06-15' context/foundation/test-plan.md` matches §8 lines.
- Prettier formats clean: `pnpm exec prettier --check context/foundation/test-plan.md`.
- Guide-wide stale-token sweep is clean: `grep -nE 'src/lib/placements|src/components/(planner|auth|ui)|src/lib/grouping|__tests__|testing-validator-trust-core' context/foundation/test-plan.md` returns nothing.

#### Manual Verification:

- §4 counts and CI-lane description match research (55/9, factory harness, 2-worker cap, e2e none).
- §6.1 reference test points at a file that exists; §6.4/§6.5 phase pointers resolve to the new sequence.
- §7 substance is unchanged, only paths re-anchored.
- §8 records the refactor trigger as resolved.

**Implementation Note**: Pause for human confirmation of the full-guide read
before proceeding to the archive fix.

---

## Phase 4: Archive data-quality fix

### Overview

Remove the duplicate `archived_at` key in the archived architecture-refactor
change so the archive timestamp is not silently nulled by a strict YAML parser.

### Changes Required:

#### 1. Deduplicate `archived_at`

**File**: `context/archive/2026-06-08-architecture-refactor/change.md`

**Intent**: Keep the real archive timestamp; drop the stray `archived_at: null`.

**Contract**: Frontmatter L7 (timestamp) and L8 (`null`). Remove the `null`
duplicate so exactly one `archived_at` (the timestamp) remains. Touch nothing else.

### Success Criteria:

#### Automated Verification:

- Exactly one `archived_at`: `grep -c 'archived_at' context/archive/2026-06-08-architecture-refactor/change.md` returns `1`.
- The remaining value is the timestamp, not null: `grep -n 'archived_at' context/archive/2026-06-08-architecture-refactor/change.md` shows a date, not `null`.

#### Manual Verification:

- The frontmatter still parses as valid YAML and no other field changed.

**Implementation Note**: Final phase — after this, the change is complete.

---

## Testing Strategy

This change edits documentation only; there is no application test surface. The
"tests" are grep assertions over the rewritten guide and a prettier format check.

### Unit Tests:

- N/A — no code changes.

### Integration Tests:

- N/A — no code changes. (`pnpm test` / `pnpm test:integration` are unaffected;
  do not run them as acceptance for this change.)

### Manual Testing Steps:

1. Read the rewritten `test-plan.md` end to end; confirm it reads coherently and
   no section contradicts another.
2. Verify §3 → §5 → §6 cross-references all resolve to the correct new-sequence phases.
3. Confirm the C3 (no build-first sequencing) and C4 (S-09 labeled as inference)
   wording nuances are honored — grep cannot catch these.
4. Open the archived change.md and confirm a single, valid `archived_at`.

## Performance Considerations

None — documentation edits.

## Migration Notes

None. A later `/10x-test-plan` run against the refreshed guide will tee up the
auth/RLS rollout phase (Risk #5, now §3 Phase 2); that is out of scope here.

## References

- Change spec: `context/changes/test-plan-refresh-2026-06-15/change.md`
- Research (grounding + corrections C1–C4): `context/changes/test-plan-refresh-2026-06-15/research.md`
- Target file: `context/foundation/test-plan.md`
- Shipped Phase 0 harness: `context/changes/data-for-e2e-and-integration-tests/`
- Refactor that landed (§1 #4 basis): `context/archive/2026-06-08-architecture-refactor/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Strategy & Risk Map (§1–§2 + header)

#### Automated

- [x] 1.1 No stale risk-evidence tokens remain in §1–§2 (grep placements/planner/auth) — a33e0f2
- [x] 1.2 Corrected PRD anchors present (L57/L130/L131/L158) — a33e0f2
- [x] 1.3 S-09 row present — a33e0f2
- [x] 1.4 Prettier formats test-plan.md clean — a33e0f2

#### Manual

- [x] 1.5 §1 principle #4 past tense, no build-first sequencing (C3) — a33e0f2
- [x] 1.6 S-09 row reads as the refresh's inference (C4) — a33e0f2
- [x] 1.7 Risk #1 server-persist criterion reads as currently-unmet — a33e0f2
- [x] 1.8 Risk #3 no longer references a placements/grouping API route — a33e0f2

### Phase 2: Phased Rollout & Quality Gates (§3 + §5)

#### Automated

- [x] 2.1 Phantom folder reference gone — fae7364
- [x] 2.2 Real Phase 0 folder (data-for-e2e-and-integration-tests) present — fae7364
- [x] 2.3 "complete (absorbed)" present and "#3 (route)" absent from §3 — fae7364
- [x] 2.4 Prettier formats test-plan.md clean — fae7364

#### Manual

- [x] 2.5 §3 rows match target sequence; Status column uses only parser-literal values — fae7364
- [x] 2.6 Phase 2 names the ownership-column prerequisite clearly — fae7364
- [x] 2.7 §5 gate "Phase N" references resolve to correct new-sequence phases — fae7364

### Phase 3: Stack, Cookbook, Don't-Test & Freshness (§4, §6, §7, §8)

#### Automated

- [x] 3.1 No `__tests__` or pre-FSD reference paths remain — 53e9869
- [x] 3.2 Live counts present (55 unit / 9 integration) — 53e9869
- [x] 3.3 Freshness dates bumped to 2026-06-15 — 53e9869
- [x] 3.4 Prettier formats test-plan.md clean — 53e9869
- [x] 3.5 Guide-wide stale-token sweep is clean — 53e9869

#### Manual

- [x] 3.6 §4 counts and CI-lane description match research — 53e9869
- [x] 3.7 §6.1 reference test exists; §6.4/§6.5 phase pointers resolve — 53e9869
- [x] 3.8 §7 substance unchanged, only paths re-anchored — 53e9869
- [x] 3.9 §8 records the refactor trigger as resolved — 53e9869

### Phase 4: Archive data-quality fix

#### Automated

- [x] 4.1 Exactly one `archived_at` in the archived change.md
- [x] 4.2 The remaining `archived_at` value is the timestamp, not null

#### Manual

- [x] 4.3 Frontmatter still parses as valid YAML; no other field changed
