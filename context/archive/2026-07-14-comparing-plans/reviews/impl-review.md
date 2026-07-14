<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Comparing Plans

- **Plan**: `context/changes/comparing-plans/plan.md`
- **Scope**: All 6 phases (full plan review)
- **Date**: 2026-07-14
- **Verdict**: NEEDS ATTENTION (nothing blocks; the two that matter are cheap)
- **Findings**: 0 critical, 3 warnings, 4 observations

## Context: this change reverses its own plan, on purpose

Six post-ship commits (`8f62ffe`, `4f0c59f`, `d1a80c4`, `10b77b6`, `3b1d9da`, `a42568b`) reverse five of
the plan's own design notes (baseline + deltas, completeness prose, frozen header, drift enumeration,
zero-JS). `change.md` documents each. The review therefore targeted the real risk: **a reversal justified
by a claim that is false in code.**

**No false claims were found.** Each falsifiable claim was checked against source:

| Claim | Verdict |
|---|---|
| `MetricRow` exposes no numeric reader — nothing downstream *can* subtract a delta | TRUE — `read` returns only `MetricCell {text, href?}`; pinned by a structural key-set test |
| A slot count never renders without its cohort's hour accounting | TRUE — `UNPLACED`/`OVER-PLACED HOURS` are rows 1–2 above every slot count; pinned by a render-level test (see F7 for one edge) |
| A unit test pins that worst-teacher/worst-student are the only linked rows | TRUE — `metric-catalog.test.ts:123-132` |
| No client state on this page may choose what is measured | TRUE — only popover open/closed; rule recorded at both route and component |
| The natural-key fingerprint is the whole drift detector | TRUE — `driftTier` rests only on `catalogEqual` + `gridEqual`; zero dead refs to the deleted diff |
| The `lateFinishes` inversion is stated in copy and pinned by a test | TRUE — sentence asserted verbatim |
| The `bench/` → `_pages` ESLint fence actually works | TRUE — verified by driving the real matcher, not by reading |

## Success criteria — all re-run, not trusted

`astro check` 0 errors (719 files) · `pnpm lint` clean · `pnpm steiger` clean · **1512/1512** unit ·
**112/112** integration · `pnpm audit` clean · **plan-comparison e2e 2/2 green** against the real workerd
preview (incl. the load-bearing clone→no-drift assertion) · `pnpm build` clean.

Progress row **6.4** (CI e2e job on the PR) is open — intentional and disclosed in `change.md:25`.

The plan's "What We're NOT Doing" guardrails hold: the three app `courses` loaders (`plan-detail`'s
`fetchCourseLevels`, both plan-views' `fetchCourseInfo`) are **untouched** — verified as an empty diff — so
no regression to UUID card titles. `GroupingCourse` and `computeCatalogHash` unchanged (golden digest test
still passes). No steiger override added. No middleware allowlist change.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — The drift detector is a binary file to git

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/_pages/plan-comparison/model/catalog-fingerprint.ts:68`
- **Detail**: `const SEP` is written as a **literal 0x00 byte**, not the escape `"\u0000"`. `file` reports
  the module as `data`; git reports `Bin 0 -> 6462 bytes`. This 141-line module — which `change.md` calls
  "the WHOLE drift detector" — therefore landed with **no reviewable diff at all**: no line-level blame, no
  3-way merge, nothing for a PR reviewer to read. It also produces a false lead on read: the NUL renders as
  a space, making the docblock ("a space would be ambiguous") appear to contradict its own constant. The NUL
  *delimiter* is correct and well-argued (Postgres `text` cannot hold one — confirmed collision-proof by
  executing a probe). The *encoding* is the defect.
- **Fix**: `const SEP = "\u0000";` — byte-identical at runtime; the file becomes plain ASCII that diffs,
  blames, and merges normally.
- **Decision**: FIXED

### F2 — No cap on N: "Select all plans" → Compare is one click from a 500

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `src/_pages/plan-comparison/lib/compare-params.ts:27`,
  `src/_pages/plans-list/model/plan-selection.ts:25,40`, `src/_pages/plans-list/ui/PlansHub.tsx:107`
- **Detail**: `readCompareParams` dedupes and UUID-filters but never caps; `loadComparison` then runs
  `planIds.map(loadPlanAnalysis)` fully concurrent, unbounded. The hub ships a one-click "Select all plans"
  checkbox whose `compareHref` joins every selected id. The shipped loader fires **18** subrequests per plan
  (it grew `loadPlanTeachers` + `fetchStudentNames` for the natural keys), but the plan's headroom math —
  *"safe past N ≈ 60"* (`plan.md:107,793`) — was computed against ~15. True ceiling is ~55; at N ≥ 56 the
  page exceeds the Workers 1000-subrequest cap and hard-500s. The plan says "ship the UI comfortable at
  N = 2–4"; nothing encodes that. Not a public DoS (deny-by-default auth), but reachable by an ordinary
  author with enough plans, in one click, and the failure is a blank 500 rather than a degraded page.
- **Fix A ⭐ Recommended**: Cap in `readCompareParams` (`MAX_COMPARE_PLANS` ≈ 8, `.slice(0, MAX)`) and tell
  the reader the selection was truncated.
  - Strength: One choke point — the URL is the single source of truth for what is measured, so a cap there
    covers the hub, a hand-edited link, and a stale bookmark alike.
  - Tradeoff: A shared link naming 12 plans silently shows 8; needs copy so it does not read as data loss.
  - Confidence: HIGH — the codec is already the sole parser and already drops malformed ids.
  - Blind spot: The number itself (8) is anchored on "2N columns stays readable", not on author input.
- **Fix B**: Bound the hub's select-all instead.
  - Strength: Keeps the compare page's contract "render exactly what the URL names" perfectly intact.
  - Tradeoff: Leaves the hand-edited/bookmarked URL uncapped — the exact case the URL was designed for.
  - Confidence: MEDIUM — closes the one-click path, not the class.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `MAX_COMPARE_PLANS = 8` enforced in `readCompareParams`, which also now
  returns `omittedForCap` so the page states the truncation instead of silently showing fewer plans.
  6 new tests.

### F3 — The reference catalog is fingerprinted N−1 times

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: `src/_pages/plan-comparison/api/load-comparison.ts:71,171-172`
- **Detail**: `toDriftReport` hashes both sides and is called once per comparand against the same reference,
  so the reference is re-projected and re-hashed per column: **2(N−1)** fingerprints where **N** would do.
  Each re-projects the full catalog including `choices` (O(students × courses) — thousands of tokens for a
  real school), sorts five arrays, stringifies, SHA-256s. `projectCatalog` also calls `projectCourses` twice.
- **Fix**: Hash each plan once into a `Map<planId, digest>`; have `toDriftReport` compare two precomputed strings.
- **Decision**: FIXED

### F4 — Dead exports and stale docblocks citing the deleted `catalog-diff`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/_pages/plan-comparison/model/catalog-fingerprint.ts:29-33,106-108`
- **Detail**: Ten symbols (`projectCourses`, `teacherCodes`, `studentNames`, `projectChoices`,
  `projectAvailability*`, `availabilityKey`, `courseKey`, + 3 types) are `export`ed with no consumer outside
  the module and its own test — residue of the structured diff deleted in `3b1d9da`. Two docblocks still
  explain themselves in terms of it: *"Exported because **the diff** folds over exactly these categories…"*
  and *"**The diff** needs (teacher, day, period) as an identity…"*. This is a direct hit on the recorded
  lesson *"A convention that cites a code mechanism is coupled to it — update the doc when the refactor
  deletes it."* Also `load-comparison.ts:184` re-exports `Distribution` "so the island can name the
  distribution shape" — no `.tsx` consumes it.
- **Fix**: Demote the eight helpers to module-private; delete the two stale paragraphs and the dead
  `Distribution` re-export.
- **Decision**: FIXED

### F5 — The bench→`_pages` fence states a false premise, and misses relative paths

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture / Pattern Consistency
- **Location**: `eslint.config.js:87-88,105-107`; `src/_pages/plan-comparison/api/index.ts:1-14`
- **Detail**: Both say the ban exists because "the slice ROOT re-exports `ui/`" — but
  `_pages/plan-comparison/index.ts` is literally `export {}`. The rule is worth keeping; the rationale should
  be forward-looking ("keep it empty so it can never pull React in") rather than a present-tense claim that is
  untrue. Separately, the fence only matches the `@/` alias — a relative `../src/_pages/plan-detail/...` from
  `bench/` resolves and is caught by nothing.
- **Fix**: Reword the rationale; add `"**/src/_pages/**"` to the restricted patterns.
- **Decision**: FIXED

### F6 — `scoreboard.ts` is the only model file with no unit test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Success Criteria
- **Location**: `src/_pages/plan-comparison/model/scoreboard.ts`
- **Detail**: Every sibling (`catalog-fingerprint`, `drift-tier`, `extremes`, `format`, `metric-catalog`) has
  one; this is the module that assembles the whole matrix. Mitigating: `buildCohortSection` derives `columns`
  and each row's `cells` from the same array, so column↔cell alignment is correct **by construction**, not by
  convention — real risk is low.
- **Fix**: Add `scoreboard.test.ts` covering section assembly for N=2 and N=3.
- **Decision**: FIXED

### F7 — Golden-slots renders cell counts in a table with no hour accounting

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence (the load-bearing invariant)
- **Location**: `src/_pages/plan-comparison/model/metric-catalog.ts:115-138`
- **Detail**: `change.md`'s escape clause reads: *"If a slot count ever moves into a section carrying no hour
  accounting, the annotation has to come back with it."* The Golden-slots section renders `Golden cells`,
  `Near-golden cells`, `Golden inside the mid-day band` in its own table with no UNPLACED/OVER-PLACED beside
  them. Two reasons this is an observation rather than a breach: it is exact `bench/plan-report.ts` parity
  (the bench annotates the cohort table only), and the failure mode is **inverted** — incompleteness *reduces*
  golden coverage, so an incomplete board reads as worse, not flattered. The flattery case (`Occupied slots`)
  is covered.
- **Fix**: Author's call — most likely "accept, and record why the inversion makes it safe" rather than a code change.
- **Decision**: ACCEPTED — no code change. The rationale is now recorded on `goldenCensusRows`' docblock:
  the invariant guards against *flattery* (an incomplete board using fewer slots and so reading as better),
  and incompleteness can only *reduce* golden coverage — so there is no flattery here to guard against.
  The docblock names the condition that would reverse the call: "add hours here only if a row ever appears
  whose value a *missing* lesson could improve."

## Nits (not findings)

- `clonePlan` promoted to `e2e/support/` on **first** use; `e2e/CLAUDE.md` asks for a second consumer first.
  Defensible — it is entity-lifecycle plumbing beside `createPlan`/`deletePlan`.
- `compare-params.ts:40` re-declares the UUID regex with a "keep them in step" comment. The stated reason
  (the `@/shared/api` barrel drags `astro:env/server`) is real, but importing the leaf module — or moving
  `isPlanId` to `@/shared/lib` — would remove the drift risk rather than document it.

## Triage outcome (2026-07-14)

All 7 findings triaged: 6 fixed in code, 1 accepted with its rationale recorded.

| ID | Decision | What changed |
|---|---|---|
| F1 | FIXED | The raw 0x00 byte in `SEP` replaced with a `\u0000` escape. The module is plain UTF-8 again and diffs normally; the golden digest is unchanged, so the runtime bytes are identical. |
| F2 | FIXED (Fix A) | `MAX_COMPARE_PLANS = 8` enforced in `readCompareParams`, which now also returns `omittedForCap` so the page states the truncation instead of silently showing fewer plans. 6 new tests. |
| F3 | FIXED | One fingerprint per plan (`Map<planId, digest>`) instead of 2(N−1) — plus an explicit guard, because two absent digests are two `undefined`s that compare equal and would fail **open** as `clean`. |
| F4 | FIXED | 8 helpers + 2 types demoted to module-private; 3 stale docblocks citing the deleted `catalog-diff` rewritten; the dead `Distribution` import and re-export removed. |
| F5 | FIXED | ESLint fence rationale corrected (the slice root is `export {}`, so the ban is forward-looking, not a present-tense fact) and the relative-path hole closed with `**/src/_pages/**` — verified against deliberate violations. |
| F6 | FIXED | `scoreboard.test.ts` added — 8 tests covering the 2N-column layout at N=3 and the cell↔column alignment that would put one plan's numbers under another plan's name. |
| F7 | ACCEPTED | No code change. Rationale recorded on `goldenCensusRows`: the invariant guards against *flattery*, and incompleteness can only *reduce* golden coverage. The docblock names the condition that would reverse the call. |

**One correction to the review itself.** F5 originally also flagged `api/index.ts` as repeating the fence's
false premise. It does not — its claims (that `load-comparison` value-imports the entity barrel, which
re-exports a React component) are true and verified. It was left untouched. The false premise lived only in
`eslint.config.js`.

### Gate after the fixes

`astro check` 0 errors · `pnpm lint` clean · `pnpm steiger` clean · **1526/1526** unit (+14) ·
**112/112** integration · **plan-comparison e2e 2/2** against the real workerd preview · `pnpm build` clean.
