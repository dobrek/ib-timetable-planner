<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Gated Author Provisioning

- **Plan**: context/changes/gated-author-provisioning/plan.md
- **Scope**: Phase 1–3 of 3 (full plan)
- **Date**: 2026-06-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 2 warnings · 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — [auth.email] enable_signup not set to false per plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: supabase/config.toml:207
- **Detail**: Plan contract specified setting `[auth.email] enable_signup = false`. Implementation keeps it `true` with an inline comment explaining GoTrue semantics — setting false disables the email provider entirely, breaking sign-in. Top-level `[auth] enable_signup = false` blocks signups. Manual verification confirmed the gate works.
- **Fix A ⭐ Recommended**: Accept as documented deviation and update plan text to reflect actual GoTrue semantics.
  - Strength: Gate intent is verifiably met (POST to /auth/v1/signup rejected). Plan's literal contract was incorrect.
  - Tradeoff: Plan becomes a post-hoc record rather than a pure pre-commit contract.
  - Confidence: HIGH — manual step 1.5 verified this works.
  - Blind spot: None significant.
- **Fix B**: Set [auth.email] enable_signup = false and verify sign-in still works
  - Strength: Satisfies plan contract literally.
  - Tradeoff: HIGH RISK — may disable email sign-in entirely.
  - Confidence: LOW — would need restart + test cycle.
  - Blind spot: Haven't verified GoTrue semantics independently.
- **Decision**: FIXED (Fix A) — plan contract updated to reflect GoTrue semantics

### F2 — Extension-based regex in middleware is overly broad

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:19
- **Detail**: `/\.[a-zA-Z0-9]+$/` exempts ANY pathname ending with a file extension from auth. Future routes like /api/export.csv would silently bypass the auth gate. Current surface is safe but this is a latent bypass.
- **Fix A ⭐ Recommended**: Tighten regex to known static extensions (.css, .js, .png, .svg, .ico, .woff2, etc.)
  - Strength: Only known-safe extensions exempted; future API routes stay gated.
  - Tradeoff: Must maintain extension list.
  - Confidence: HIGH — sign-in page assets are known and finite.
  - Blind spot: None significant.
- **Fix B**: Remove regex, rely on /\_astro/ prefix + explicit favicon
  - Strength: No regex maintenance.
  - Tradeoff: Must verify all assets load from /\_astro/.
  - Confidence: MEDIUM.
  - Blind spot: Root-level statics.
- **Decision**: FIXED (Fix A) — regex tightened to known static asset extensions

### F3 — getUser() error field not inspected

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:27–29
- **Detail**: `supabase.auth.getUser()` returns `{ data: { user }, error }`. Only `user` was destructured; `error` discarded. Transient auth failures silently look like "logged out" — fail-closed (secure) but loses diagnostic signal.
- **Fix**: Destructure `error` and log when present, keeping fail-closed behavior unchanged.
- **Decision**: FIXED — error now destructured and logged via console.error
