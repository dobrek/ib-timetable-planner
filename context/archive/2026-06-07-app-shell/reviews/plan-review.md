<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Authenticated App Shell & Navigation Convention

- **Plan**: context/changes/app-shell/plan.md
- **Mode**: Deep
- **Date**: 2026-06-07
- **Verdict**: REVISE → SOUND (after triage)
- **Findings**: 1 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

9/9 paths ✓, symbols ✓ (signin.ts:19 redirect, planner header at plans/[id].astro:20, 8 `--sidebar-*` tokens in global.css:31-38/65-72/103-110, lucide-react@^1.16.0 installed, plans table schema), brief↔plan ✓.

## Findings

### F1 — Success Criteria use checkboxes; violates Progress-format contract

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1–3 — `#### Automated/Manual Verification` sub-sections
- **Detail**: Every phase body duplicated its success criteria as `- [ ]` checkboxes. The Progress-format contract requires phase blocks to use plain `- ` bullets — checkboxes ONLY in `## Progress`. The repo's other plans (first-valid-drop, port-grouping, minimal-domain-schema) all confirm this. `/10x-implement` flips checkboxes only inside `## Progress` (SKILL.md 58, 126, 308), so the phase-body checkboxes would never flip — staying `[ ]` forever and contradicting real Progress state.
- **Fix**: Convert all `- [ ]` bullets under the verification headings in Phase 1–3 bodies to plain `- ` bullets. Progress section already mirrors them.
- **Decision**: FIXED (Fix in plan — all 6 blocks converted to plain bullets)

### F2 — Dangling-ref guard `grep 'Welcome\|Topbar'` false-fails on greeting copy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — criterion (line 182) and Contract (line 173)
- **Detail**: `! grep -RIn 'Welcome\|Topbar' src/` matches the English word "Welcome" anywhere in src/ (dashboard.astro:14 renders `Welcome, {email}`), so it flags legitimate greeting copy as a dangling component reference rather than a real import.
- **Fix**: Scope the guard to component usage: `! grep -REn 'Welcome\.astro|Topbar\.astro|<Welcome|<Topbar' src/`.
- **Decision**: FIXED (Fix in plan — both the criterion and the contract prose updated)

### F3 — AppShellLayout duplicates Layout.astro boilerplate

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §2 — AppShellLayout.astro contract (line 73)
- **Detail**: Contract said "wraps the same boilerplate (or composes it)", leaving it to the author. The likely outcome is a verbatim copy of head/favicon/global-css + the `missingConfigs` Banner loop across two files, plus an unspecified Banner-vs-sidebar placement.
- **Fix**: Prescribe composition — AppShellLayout renders `<Layout title=…>` and places the two-column chrome in its slot; head/Banner stay single-sourced.
- **Decision**: FIXED (Fix in plan — contract now mandates composing Layout.astro)

### F4 — No precedent for lucide-react icons rendered in .astro

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1–2 — nav.ts icon type + AppShellLayout icons
- **Detail**: All 8 current lucide-react usages are inside `.tsx` islands; none render directly in `.astro`. The project carries a documented React-SSR-dedup fragility (astro.config `ssrPrebundleDeps`). Static SSR of stateless icons is the safe case and the plan names inline-SVG as fallback, but no success criterion asserts icons render.
- **Fix**: Prescribe inline SVG as default, or accept the manual "five nav items visible" check as the implicit guard.
- **Decision**: ACCEPTED (risk accepted — keep React-icon-with-SVG-fallback; manual nav check is the guard)
