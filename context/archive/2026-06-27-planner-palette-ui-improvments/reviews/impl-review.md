<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Planner Palette UI Improvements

- **Plan**: context/changes/planner-palette-ui-improvments/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-06-27
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations (both fixed during triage)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence highlights

- All 9 planned changes verified MATCH; no DRIFT / MISSING / EXTRA-scope. The two cosmetic
  extras found (a `data-slot="palette-count"` and rail-local border/bg) are benign and
  symmetric with the ShelfDrawer template.
- Flash-free hydration confirmed: `index.astro` reads the cookie server-side → `paletteCollapsed`
  prop → `PlanDetailPage.astro` → `PlannerBoard` `usePaletteDisclosure(initialCollapsed)` →
  `useState` seed. Server HTML and first client paint produce the same width class.
- Cookie is a non-HttpOnly cosmetic flag; value is always the literal `true`/`false` (no
  injection/XSS); `Secure` correctly gated on `location.protocol === "https:"` (dev-safe on
  http://localhost).
- Both the collapsed rail and expanded body stay MOUNTED (display-class toggle, not a
  `{collapsed ? <A/> : <B/>}` swap), so dnd-kit draggable sources and `usePaletteFilter`
  selection survive a collapse/expand cycle.
- Semantic tokens only; `motion-reduce:transition-none` byte-identical to ShelfDrawer; the
  collapse flag is a cookie, not an Astro Action (lessons-compliant).
- Automated success criteria re-verified green: `pnpm check` (0 errors), `pnpm lint`,
  `pnpm steiger`, `pnpm test` (628 passed), `pnpm build`.

## Findings

### F1 — Doc comment overstates the "storage-guard idiom" parallel

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/lib/palette-collapsed.ts:36
- **Detail**: The `writePaletteCollapsed` docstring claimed the guard was "consistent with the
  storage-guard idiom in shelf-pinned.ts", but shelf-pinned's try/catch is a localStorage-specific
  lessons rule. A `document.cookie` assignment silently no-ops when cookies are blocked rather than
  throwing, so no try/catch is needed (and none was present). Code correct; comment overstated.
- **Fix**: Trimmed the wording to explain why no try/catch is needed (cookie assignment doesn't throw).
- **Decision**: FIXED (Fix now)

### F2 — writePaletteCollapsed has no unit test

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/_pages/plan-detail/lib/palette-collapsed.test.ts
- **Detail**: Only `parsePaletteCollapsed` was unit-tested (which matched the plan's Testing
  Strategy). `writePaletteCollapsed`'s cookie-attribute string (path / SameSite / Secure-gating)
  was only exercised manually (item 2.11).
- **Fix**: Added a jsdom-scoped (`@vitest-environment jsdom`) describe block capturing the
  `document.cookie` setter: asserts name/value, `path=/plans`, `max-age=31536000`, `SameSite=Lax`,
  `Secure` omitted over http and appended over https (via `vi.stubGlobal("location", …)`).
- **Decision**: FIXED (Fix now)
