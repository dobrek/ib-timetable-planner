---
project: ib-timetable-planner
checked_at: 2026-07-16T19:01:27+02:00
health_status: healthy
context_type: brownfield
language_family: multi
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
  high: 0
  moderate: 0
  low: 0
test_runner_detected: true
ci_provider: GitHub Actions
recommended_fixes: 6
---

# Health Check — IB Timetable Planner

> Two-component check matching the stack assessment (2026-07-16): the pnpm/TS
> app at the repo root and the uv/Python solver at `poc/cp-sat/` (promoting to
> `services/solver/` per the CP-SAT PRD). Replaces the 2026-06-18 report
> (needs-attention, 4 HIGH advisories) — all four advisories have since been
> resolved; the dependency tree is now clean.

## Dependency Health

### Lockfile

```
Status: present — pnpm-lock.yaml (app), uv.lock (solver)
Package manager: pnpm 11.9.0 (app, pinned in packageManager); uv (solver)
```

Both ecosystems are fully pinned and reproducible. Node is pinned via
`.node-version` (24.15.0); Python via `requires-python >=3.12` + `uv.lock`.

### Security Audit

```
Tool: pnpm audit --json (app)
Summary: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW — across 1,000 resolved packages
Direct vs transitive: no findings to break down

Tool: uv audit (solver — native, lockfile-based; preview feature in uv 0.11.11)
Summary: 0 findings — no known vulnerabilities, no adverse project statuses (17 packages)
```

> Applied as Fix 3 right after this report's initial run: `uv audit` (announced
> 2026-06, astral.sh/blog/uv-audit) replaced the report's original pip-audit
> recommendation — zero added dependencies vs pip-audit's ~20 dev transitives,
> and it audits the full lockfile rather than the installed environment.

The solver's audit surface is currently one runtime dependency
(`ortools>=9.15,<9.16`) — the planned FastAPI wrapper (PRD FR-310) will grow
that tree; see Fix 3.

### Outdated Dependencies

```
Packages with major version gaps: 2 (both dev-only)
```

- **eslint-plugin-astro**: 1.7.0 → 3.0.0 (2 major versions behind)
- **typescript**: 6.0.3 → 7.0.2 (1 major version behind)

Everything else is patch/minor drift (16 packages — e.g. astro 7.0.6→7.0.9,
wrangler 4.102→4.111) — routine, no action needed. Neither major gap is
urgent; see Fix 5 for the review recommendation.

## Test Suite

```
Test runner: Vitest 4.1.9 (app) + pytest 8 (solver)
Tests found: 1,534 (app, 175 files) + 40 (solver)
Test execution: passing — both suites, verified this run
```

```
Configuration: vitest.config.ts (unit; four further configs: integration,
bench, analyze, experiment) + playwright.config.ts (E2E, not executed here —
needs the local Supabase stack + workerd preview)
Framework: Vitest 4.1.9 — app suite green in 21.9 s; pytest — solver suite
green in 8.9 s (poc/cp-sat/pyproject.toml [tool.pytest.ini_options])
```

This is the strongest agent-readiness signal in the project: fast, green,
CI-gated suites on both sides of the wire contract, plus lefthook pre-commit
hooks locally.

## CI/CD

```
Provider: GitHub Actions
Configuration: .github/workflows/ci.yml
```

| Stage      | Status | Notes                                               |
| ---------- | ------ | --------------------------------------------------- |
| Lint       | ✓      | eslint + steiger (FSD gate, --fail-on-warnings)     |
| Test       | ✓      | vitest (verify) + integration + Playwright e2e jobs |
| Build      | ✓      | pnpm build (astro build)                            |
| Type check | ✓      | pnpm check (astro check) after astro sync           |
| Security   | ✓      | pnpm audit --audit-level=high in verify job         |

Deploy job ships migrations + Worker on merge to main after all gates pass.

**Coverage boundary:** the pipeline is JS-only. The solver's 40 tests and ruff
lint run nowhere in CI — the path-filtered solver lane is scoped as net-new
work in PRD FR-315. Flagged as Fix 2 so it lands with a type checker included
(see cross-reference below). No scheduled dependency scanning
(Dependabot/Renovate) — audit runs only on push/PR; acceptable at this scale,
noted in Fix 6.

## Configuration

### High severity

None.

### Medium severity

None. Formatter (`.prettierrc.json` + `.prettierignore`), linter
(`eslint.config.js`, type-aware flat config), strict TS
(`tsconfig.json` extends `astro/tsconfigs/strict`), `.gitignore` (secrets
verified ignored and untracked: `.env*`, `.envs/`, `.dev.vars`), and env
documentation (README's `.envs/local.vars` walkthrough serves the
`.env.example` role) are all present.

### Low severity

- **.editorconfig** — missing; cross-editor consistency for non-Prettier
  files (TOML, YAML, Python — Prettier doesn't format the solver). Fix: add a
  minimal `.editorconfig` (see Fix 4).
- **Stale Next.js remnants** — `next-env.d.ts` at the repo root and Next.js
  sections in `.gitignore` (`/.next/`, `/out/`) from a pre-Astro past; noise
  an agent may pattern-match on ("is this a Next app?"). Fix: delete (Fix 5).

## Stack Assessment Cross-Reference

```
Stack assessment: context/foundation/stack-assessment.md (2026-07-16)
Agent readiness (from stack-assess): ready-with-compensation
```

| Quality Gate Gap                                                             | Health-Check Finding                                                                                                            | Status                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Solver typed: fail (no mypy/pyright)                                         | No Python CI lane exists at all — annotations unenforced locally AND in CI                                                      | **Reinforced**                                               |
| Solver conventions: partial (instruction file blind to Python)               | CLAUDE.md/AGENTS.md present but the recommended solver + post-cutoff sections are not yet pasted; "Astro 6" drift still present | **Reinforced — compensation pending**                        |
| Post-cutoff platforms: partial (Containers, Vite 8, Astro 7, React Compiler) | No operational counterpart yet (wrangler.jsonc has no container bindings); doc-first rules not yet in CLAUDE.md                 | Pending — becomes operational when FR-315/FR-311 work starts |
| CP-SAT idiom thin in training data                                           | Structural defenses verified working: 40 solver tests green, parity suite in place                                              | **Mitigated**                                                |

The two reinforced rows compound into one message: the solver currently has
**zero machine enforcement** — no type checker, no CI lane, no instruction-file
steering. Each is individually cheap, and FR-315 is the natural vehicle for
all of them.

## Recommended Fixes

The project sits inside the brownfield chain with CI, deployment, and agent
instruction files already in place — so every finding is actionable now
(Category A); nothing needs to wait for an upcoming lesson.

### Fix before agent work (Category A)

### 1. Paste the stack-assessment compensation into CLAUDE.md

**Impact**: agents doing solver or Containers work currently get zero steering
— the instruction file never mentions the Python half, and its "Astro 6" claim
actively misleads. This is the highest-leverage five minutes available.
**Severity**: high
**Effort**: quick (< 5 min)
**Fix**:

Copy the two ready-to-paste sections ("Solver service" and "Post-cutoff
platform rules") from `context/foundation/stack-assessment.md` →
"Recommended Instruction File Additions" into `CLAUDE.md`, and change
"Astro 6" → "Astro 7" in its first paragraph.

### 2. Add mypy --strict to the solver (with the FR-315 CI lane)

**Impact**: the solver owns one side of the frozen wire contract; today a
shape drift in `schema.py` produces no machine signal anywhere — the stack
assessment's one failed gate, reinforced by the missing CI lane.
**Severity**: high
**Effort**: moderate (15–30 min — strict mode may surface fixes across ~1,300 LOC)
**Fix**:

Apply the `[tool.mypy]` block from the stack assessment to
`poc/cp-sat/pyproject.toml`, run `uv run mypy` until clean, and include
`uv run mypy` next to ruff + pytest when building the FR-315 path-filtered
CI lane.

### 3. Python vulnerability scanning — ✅ applied via `uv audit`

**Impact**: the Python tree had no vulnerability scanning; trivial now (one
runtime dep), load-bearing once the FastAPI wrapper lands.
**Severity**: medium
**Effort**: quick (< 5 min)
**Fix** (applied 2026-07-16):

`uv audit` is the canonical scanner — native in uv (≥0.11.11), lockfile-based,
zero added dependencies. pip-audit was trialed first and removed in its favor.

```bash
cd poc/cp-sat && uv audit          # local; --frozen for lockfile-only in CI
```

Remaining: add `uv audit --frozen` to the FR-315 CI lane alongside
ruff/pytest/mypy. Caveat: the command is a **preview feature** ("may change
without warning") — re-check its stability when wiring the CI lane, and pin
the uv version there.

### 4. Add .editorconfig

**Impact**: Prettier doesn't cover the solver's Python or TOML/YAML; a minimal
.editorconfig keeps agents' cross-ecosystem edits consistent.
**Severity**: low
**Effort**: quick (< 5 min)
**Fix**:

```ini
# .editorconfig
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2

[*.py]
indent_size = 4
max_line_length = 110
```

### 5. Clean stale Next.js remnants; review dev-tool major gaps

**Impact**: `next-env.d.ts` + Next.js `.gitignore` sections are misleading
context for agents. Separately, `eslint-plugin-astro` is 2 majors behind
(1.7.0 → 3.0.0) and TypeScript 7 is out — worth a deliberate review, not an
automatic bump, mid-migration.
**Severity**: low
**Effort**: quick (remnants) + moderate (major-gap review, 15–30 min)
**Fix**:

```bash
git rm next-env.d.ts   # then delete the "# next.js" block in .gitignore
```

Review `eslint-plugin-astro@3` and `typescript@7` changelogs when convenient;
defer the bumps if they'd share a diff with CP-SAT migration work.

### 6. (Optional) Scheduled dependency scanning

**Impact**: `pnpm audit` runs only on push/PR — a quiet repo won't hear about
new advisories. At single-author scale this is acceptable; Dependabot/Renovate
would close the gap.
**Severity**: low
**Effort**: moderate (15–30 min)
**Fix**: add `.github/dependabot.yml` with `package-ecosystem: npm` (weekly)
— and `pip` once `services/solver/` exists.

### Addressed in upcoming lessons (Category B)

None — this project is past the point where Category B applies: CI/CD,
deployment (Cloudflare Workers, automated on merge), and agent instruction
files (CLAUDE.md/AGENTS.md) all exist already.

## Summary

Health status: **healthy**

The operational foundation is unusually strong: clean audit across 1,000
packages (all four HIGH advisories from the June report resolved), both
lockfiles pinned, two green test suites verified this run (1,534 app tests +
40 solver tests), and a five-stage CI pipeline with deploy automation. The
gaps are concentrated on exactly the seam the stack assessment flagged — the
Python solver has zero machine enforcement (no mypy, no CI lane, no
instruction-file coverage), which matters because that seam is where the
CP-SAT migration work is about to happen. Fixes 1–3 close it for well under
an hour, and FR-315 is the natural vehicle.

Next step: apply Fix 1 (five minutes, highest leverage) before starting agent
work on the CP-SAT change; fold Fixes 2–3 into the FR-315 CI-lane work. Both
brownfield artifacts (stack-assessment.md + health-check.md) are now current
for agent onboarding.
