---
project: ib-timetable-planner
checked_at: 2026-06-18T15:37:17Z
health_status: needs-attention
context_type: brownfield
language_family: js
stack_assessment_available: true
checks_run:
  - lockfile
  - dependency_audit
  - outdated_deps
  - test_runner
  - ci_cd
  - configuration
audit_findings:
  critical: 0
  high: 4
  moderate: 5
  low: 2
test_runner_detected: true
ci_provider: GitHub Actions
recommended_fixes: 6
---

## Dependency Health

### Lockfile

```
Status: present (pnpm-lock.yaml)
Package manager: pnpm@11.9.0 (pinned in packageManager; Node 24.15.0 pinned in .node-version)
```

Dependency state is fully pinned and reproducible. No action needed.

### Security Audit

```
Tool: pnpm audit --json
Summary: 0 CRITICAL, 4 HIGH, 5 MODERATE, 2 LOW (11 advisories; pnpm reports 12 at the path level)
Direct vs transitive: 2 advisories hit a DIRECT production dependency (astro); the other 9 are
                      transitive, almost all inside dev/build tooling (wrangler, vite-tsconfig-paths,
                      @astrojs/check, steiger, eslint-plugin-react-compiler).
```

The headline is the split: only **astro** is a direct, runtime-shipped dependency with advisories, and both are cleared by a single minor bump. Everything else lives in the dev/build chain, and three of those are **Windows-only dev-server** issues that don't apply to this team's macOS/Linux + workerd workflow — real, but low real-world exposure here.

#### HIGH findings

- **astro** 6.3.7 — GHSA (CVSS 7.5): Host header SSRF in prerendered error-page fetch. **Direct production dependency** — this is the one that matters most. Fix: update astro to 6.4.8.
- **ws** 8.20.1 — GHSA-96hv-2xvq-fx4p / CVE-2026-48779 (CVSS 7.5): memory-exhaustion DoS from tiny fragments. Transitive via `wrangler > miniflare > ws` (dev/build only). Fix: update wrangler to 4.102.0.
- **undici** — GHSA (CVSS 7.4): TLS certificate-validation bypass via dropped request headers. Transitive via `wrangler` (dev/build only). Fix: update wrangler to 4.102.0.
- **vite** 7.3.3 — GHSA-fx2h-pf6j-xcff / CVE-2026-53571 (HIGH): `server.fs.deny` bypass on Windows alternate paths. Transitive via `vite-tsconfig-paths > vite`. **Windows-only**, dev server only. Fix: update vite-tsconfig-paths so it pulls vite ≥ 7.3.5.

#### MODERATE findings (count: 5 — logged, not blocking)

- **astro** 6.3.7 — XSS via unescaped attribute names in spread props (CVSS 4.2). **Direct** — cleared by the same astro 6.4.8 bump as the SSRF above.
- **undici** — cross-user information disclosure via shared cache (CVSS 5.9). Transitive via wrangler; cleared by the wrangler bump.
- **js-yaml** 4.1.1 — quadratic-complexity DoS in merge-key handling (CVSS 5.3). Transitive via `steiger > cosmiconfig > js-yaml` (dev tooling).
- **yaml** 2.7.1 — stack-overflow on deeply nested collections (CVSS 4.3). Transitive via `@astrojs/check` (dev tooling).
- **vite / launch-editor** — NTLMv2 hash disclosure via UNC path handling on Windows. Transitive via `vite-tsconfig-paths`; Windows-only dev server.

#### LOW findings (count: 2 — logged, not blocking)

- **esbuild** 0.27.x — arbitrary file read via the dev server on Windows (CVSS 2.5). Transitive via both `vite-tsconfig-paths` and `wrangler`; Windows-only.
- **@babel/core** ≤7.29.0 — arbitrary file read via sourceMappingURL comment (CVSS 3.2). Transitive via `eslint-plugin-react-compiler` (dev tooling).

### Outdated Dependencies

```
Packages with major version gaps: 0
```

No dependency is 2+ major versions behind — the project rides current majors throughout. Most pending updates are patch/minor bumps. Two are **security-relevant** and overlap with the audit fixes above:

- **astro**: 6.3.7 → 6.4.8 (clears the direct SSRF + XSS advisories)
- **wrangler**: 4.94.0 → 4.102.0 (clears the transitive ws + undici advisories)

Other notable (non-urgent) minor bumps: `@supabase/ssr` 0.10.3 → 0.12.0, `@supabase/supabase-js` 2.106.1 → 2.108.2, `lucide-react` 1.16.0 → 1.21.0, `@dnd-kit/react` + `@dnd-kit/dom` 0.4.0 → 0.5.0 (both pinned to exact versions — bump deliberately and re-run the grid/E2E suite, since the drag-drop core depends on them).

## Test Suite

```
Test runner: Vitest 4 (unit + integration) + Playwright 1.61 (E2E)
Tests found: 65 unit test files + 10 integration test files; Playwright E2E specs under e2e/specs/
Test execution: collected cleanly (vitest list exit 0); CI runs the full suite as a gate
```

```
Configuration: vitest.config.ts, vitest.integration.config.ts, playwright.config.ts
Framework: Vitest ^4.1.8, @playwright/test ^1.61.0
```

Strong, layered coverage — co-located unit tests, a separate integration config (Supabase-backed), and an E2E lane with an author-provisioning pretest. The agent can verify its own changes at every level. No action needed.

## CI/CD

```
Provider: GitHub Actions
Configuration: .github/workflows/ci.yml (+ composite actions in .github/actions/setup and .github/actions/supabase-stack)
```

| Stage      | Status | Notes                                                                 |
|------------|--------|-----------------------------------------------------------------------|
| Lint       | ✓      | `pnpm run lint` (ESLint flat config, type-checked) + `pnpm run steiger` (FSD gate) |
| Test       | ✓      | `pnpm run test` (Vitest unit) + dedicated `integration` and `e2e` jobs |
| Build      | ✓      | `pnpm run build` (astro build)                                        |
| Type check | ✓      | `pnpm exec astro sync` + tsconfig `astro/tsconfigs/strict`; lint is type-checked |
| Security   | ✗      | No `pnpm audit` / Dependabot / CodeQL stage configured                |

This is a strong pipeline: three test lanes (unit, integration, E2E), extracted composite actions, a concurrency guard that won't cancel an in-flight `main` deploy, and a `deploy` job gated on `needs: [verify, integration, e2e]` that pushes migrations then ships to Cloudflare Workers. The single gap is a **security-scan stage** — there's no automated gate that would have surfaced the astro SSRF advisory. See Category B.

## Configuration

### Low severity

- **`.editorconfig`** — missing. Without it, editors may disagree on indentation/EOL for contributors not using the repo's Prettier-on-save setup. Fix: add a minimal `.editorconfig` (Prettier already enforces formatting on commit, so this is convenience, not correctness).

All other expected configuration is present: `.prettierrc.json`, `eslint.config.js` (flat config), `tsconfig.json` (extends `astro/tsconfigs/strict` — strict mode on), `.gitignore`, `.env.example`, `lefthook.yml`, plus `CLAUDE.md` and `AGENTS.md` (the latter a one-line `@CLAUDE.md` pointer — a clean single-source pattern).

## Stack Assessment Cross-Reference

```
Stack assessment: context/foundation/stack-assessment.md
Agent readiness (from stack-assess): ready (4/4 quality gates pass, no compensation required)
```

stack-assess found no gate failures, so this table tracks its **watch-items** and recommended compensation against what's actually in the repo:

| Stack-assess item                              | Health-check finding                                                              | Status     |
|------------------------------------------------|-----------------------------------------------------------------------------------|------------|
| Workers-runtime ceiling (no Node-only APIs)    | Documented in CLAUDE.md "Hard rules"; `pnpm build` is a CI gate                    | Mitigated  |
| FSD import-direction discipline                | `steiger --fail-on-warnings` runs in CI; layer rule documented in CLAUDE.md        | Mitigated  |
| Version skew — recommended version-pinning block in CLAUDE.md/AGENTS.md | **Not yet added** — CLAUDE.md has no "current-major / do-not-regress" section | Open (Category A #4) |
| Security (stack-assess noted CI = lint→steiger→test→build, no security scan) | Confirmed: no security stage in CI **and** 4 live HIGH advisories exist  | Reinforced |

The version-skew block is the one concrete recommendation stack-assess left open; it's quick to close and listed below. The security observation is now reinforced by real findings — the missing CI scan is why the astro advisory went uncaught.

## Recommended Fixes

### Fix before agent work (Category A)

### 1. Astro direct dependency — Host header SSRF (HIGH) + spread-props XSS (MODERATE)

**Impact**: astro is the production framework shipped to workerd. The SSRF is the only HIGH advisory in a runtime dependency, and an agent extending routes/error pages could unknowingly build on the vulnerable surface.
**Severity**: high
**Effort**: quick (< 5 min)
**Fix**:

```bash
pnpm update astro          # 6.3.7 → 6.4.8 (clears both astro advisories)
pnpm audit                 # confirm the astro HIGH + MODERATE are gone
pnpm run build             # confirm the Workers build stays clean
```

### 2. wrangler transitive HIGH — ws DoS + undici TLS bypass

**Impact**: both live in wrangler's bundled miniflare/undici (dev + CI deploy tooling). Not shipped to production, but they sit in the toolchain the agent runs locally and in CI.
**Severity**: high
**Effort**: quick (< 5 min)
**Fix**:

```bash
pnpm update wrangler       # 4.94.0 → 4.102.0 (pulls patched miniflare/ws + undici)
# Keep the CI deploy step's wranglerVersion in lockstep — bump the pin in
# .github/workflows/ci.yml ("wranglerVersion: 4.94.0") to match the new lockfile version.
pnpm audit
```

### 3. vite (via vite-tsconfig-paths) — fs.deny bypass (HIGH, Windows-only)

**Impact**: dev-server-only and Windows-only, so low real-world exposure for this macOS/Linux + workerd team — but it's a HIGH and trivially patched.
**Severity**: high (low practical exposure here)
**Effort**: quick (< 5 min)
**Fix**:

```bash
pnpm update vite-tsconfig-paths   # pulls vite ≥ 7.3.5; clears vite fs.deny, launch-editor, and esbuild advisories
pnpm audit
# If a transitive vite remains pinned below 7.3.5, add a pnpm override in package.json:
#   "pnpm": { "overrides": { "vite": ">=7.3.5", "esbuild": ">=0.28.1" } }
```

### 4. Add the version-pinning block to CLAUDE.md (close the stack-assess recommendation)

**Impact**: the stack rides newer majors than the training corpus (React 19, Astro 6, Tailwind 4, ESLint 10). Without an explicit reminder, an agent may emit React 18 effect patterns, v3 Tailwind config, or `.eslintrc` snippets. stack-assess recommended this block and it isn't in CLAUDE.md yet.
**Severity**: medium
**Effort**: quick (< 5 min)
**Fix**: paste the ready-made "Versions are current-major — do not regress to older idioms" block from `context/foundation/stack-assessment.md` (§ Recommended Instruction File Additions) into CLAUDE.md. AGENTS.md inherits it via its `@CLAUDE.md` pointer.

### 5. Add a `.editorconfig`

**Impact**: minor consistency for contributors/agents not relying on Prettier-on-save. Prettier already gates formatting at commit, so this is convenience.
**Severity**: low
**Effort**: quick (< 5 min)
**Fix**: add a root `.editorconfig` with `root = true`, UTF-8, LF, 2-space indent, final newline — matching the Prettier config.

### Addressed in upcoming lessons (Category B)

### Security-scan stage in CI

**Lesson**: [Sprint Zero z Agentem: infrastruktura, walking skeleton i pierwszy deploy (M1L5)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l5)
**What you'll do there**: formalize the CI pipeline, including a dependency-audit / scanning gate (e.g. a `pnpm audit` step, Dependabot, or CodeQL) so advisories like the astro SSRF surface automatically instead of in a manual check. The pipeline itself is already strong — this is the one missing stage.

> Agent instruction files (CLAUDE.md + AGENTS.md) — normally a Category B item from agent onboarding ([M1L4](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l4)) — are **already present and substantial** here, so no action is needed beyond the version-pinning addition in Category A #4. Deployment configuration (`wrangler.jsonc`, deploy job) is also already in place.

## Summary

```
Health status: needs-attention
```

This is a strong, modern, well-instrumented project: a pinned pnpm lockfile, end-to-end strict TypeScript, three working test lanes (Vitest unit + integration, Playwright E2E), and an excellent GitHub Actions pipeline with FSD enforcement and a guarded deploy. The reason it lands at *needs-attention* rather than *healthy* is four HIGH security advisories — one of them (astro Host header SSRF) in a direct, production-shipped dependency. The good news is that nearly all of it closes with three quick version bumps (`astro`, `wrangler`, `vite-tsconfig-paths`), and the remaining transitive findings are dev/build-only, with several being Windows-only dev-server issues that don't apply to this team's macOS/Linux + workerd workflow. Two non-code items round it out: paste in the version-pinning block stack-assess recommended, and add a security-scan stage to CI (coming up in the infrastructure lesson).

Next step: apply the three dependency bumps and re-run `pnpm audit` + `pnpm build`, add the version-pinning block to CLAUDE.md, then proceed to agent onboarding — the project is in good shape for agent-assisted work once the HIGH advisories are cleared.
