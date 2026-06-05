<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Port Grouping Algorithm (F-03)

- **Plan**: context/changes/port-grouping-algorithm/plan.md
- **Scope**: Full plan, Phases 0–3 (all complete)
- **Date**: 2026-06-05 (re-review)
- **Verdict**: NEEDS ATTENTION → resolved via triage (APPROVED after fixes)
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

> Note: this re-review reopened the prior-review F1. It had been marked FIXED, but
> the committed change bounded memory/results — not the exponential traversal the cap
> was meant to guard. Now genuinely fixed (node-visit ceiling).

## Findings

### F1 — Enumeration cap bounds results, not the exponential traversal

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance / Reliability)
- **Location**: src/lib/grouping/enumerate.ts:13-32
- **Detail**: The cap was checked only at a leaf, after the `seen.has(key)` early-return. The recursion still explored every compatible ordering, so a dense/fully-compatible catalog (N courses → ~N! internal nodes, 1 distinct set) left `seen.size` small and the cap never fired — CPU explodes. Plan contract (plan.md:57,154) is "fail loud, no silent cap". dp2 is safe (194 ≪ 10,000); was latent, not active.
- **Fix**: Added a recursive node-visit counter (`maxVisits = cap * TRAVERSAL_LIMIT_FACTOR`) in `collect()` that throws independent of `seen.size`; added a fully-compatible-clique test proving the bound holds; golden parity re-run green.
- **Decision**: FIXED — node-visit ceiling added to enumerate.ts; clique test added; parity + cap tests green (20/20).

### F2 — NaN score when every course in a set has hours = 0

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/lib/grouping/score.ts:4-6
- **Detail**: `maxHours = Math.max(...hours)` is 0 when all members have hours 0 → 0/0 = NaN → score = NaN, corrupting the sort comparator and rejected by the RPC numeric cast (500). Reachable via merge-child / virtual courses. Verified NOT occurring on dp2.
- **Fix**: Guard `maxHours === 0` → score 0.
- **Decision**: FIXED — guard added in score.ts.

### F3 — Cap-error → 422 mapping relies on a substring match

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/pages/api/grouping.ts:50 (matched enumerate.ts throw)
- **Detail**: `err.message.includes("Enumeration cap")` coupled HTTP status to the exact prose of the thrown Error; a reworded message would silently downgrade the 422 to a 500.
- **Fix**: Added `EnumerationCapError` class in enumerate.ts (thrown at both cap sites), re-exported from the package entry, and branched on `instanceof` in the endpoint.
- **Decision**: FIXED — tagged error class; endpoint uses instanceof.

### F4 — `.in()` filters scale with cohort course count

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/lib/grouping/adapters/supabase.ts:94,107,120
- **Detail**: fetchChoices/Overlaps/Merges pass all cohort course ids into `.in()`. Bounded and fine at dp2 scale; a very large cohort could approach PostgREST URL limits.
- **Fix**: No action now; revisit with chunked `.in()` or a join/RPC if cohort course counts grow large.
- **Decision**: SKIPPED — accepted as risk; fine at current scale.

### F5 — `legacy-grouping-algorithm/` untracked with no .gitignore entry

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline (hygiene)
- **Location**: legacy-grouping-algorithm/ (repo root)
- **Detail**: Reference-only legacy code sat untracked with no ignore rule; a future `git add -A` could accidentally commit it. (`cookies.txt` not present.)
- **Fix**: Remove the directory (no longer needed).
- **Decision**: FIXED — user to run `rm -rf legacy-grouping-algorithm/` (Bash removal denied by sandbox; authorized manual removal).

### F6 — Dev seed delivered as gen-seed.mjs, not the planned named file

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline / Plan Adherence
- **Location**: scripts/gen-seed.mjs → supabase/seed.sql
- **Detail**: Plan named `supabase/seed-dp2.sql` / `scripts/seed-dp2.ts` (either/or); implemented as `scripts/gen-seed.mjs` generating `supabase/seed.sql` from dp1+dp2. Same intent, broader scope, undocumented.
- **Fix**: Add a note to change.md recording the actual seed approach.
- **Decision**: FIXED — note added to change.md Notes.
