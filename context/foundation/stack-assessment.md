---
project: ib-timetable-planner
assessed_at: 2026-07-16T18:51:36+02:00
agent_readiness: ready-with-compensation
context_type: brownfield
stack_components:
  language: TypeScript 6 (app) + Python 3.12 (solver, poc/cp-sat → services/solver)
  framework: Astro 7 + React 19 islands (app); or-tools CP-SAT, FastAPI planned (solver)
  build_tool: Astro / Vite 8 (app); uv + hatchling (solver)
  test_runner: Vitest 4 + Playwright (app); pytest 8 (solver)
  package_manager: pnpm 11.9.0 (app); uv (solver)
  ci_provider: GitHub Actions
  deployment_target: Cloudflare Workers (+ Cloudflare Containers planned for solver)
gates_passed: 14
gates_failed: 1
---

# Stack Assessment — IB Timetable Planner

> Assessed against the post-POC CP-SAT PRD (`context/foundation/prd.md`,
> 2026-07-16, `context_type: brownfield`). The change scope makes this a
> **two-component assessment**: the TypeScript app at the repo root and the
> Python solver package at `poc/cp-sat/` (promoting to `services/solver/`).
> Replaces the 2026-06-18 assessment, which pre-dated the CP-SAT change and
> covered the TS app only (verdict then: ready).

## Stack Components

**Language (app).** TypeScript 6 (`typescript@^6.0.3`), strict — `tsconfig.json`
extends `astro/tsconfigs/strict`. Lint is type-aware (`typescript-eslint@^8`).
Zod 4 validates runtime boundaries.

**Framework (app).** Astro `^7.0.6` in server-output mode with React 19 islands;
the React Compiler (stable 1.x) runs as a Babel transform (`astro.config.mjs`).
Feature-Sliced Design is layered on top and machine-enforced by steiger.
Note: `CLAUDE.md` still says "Astro 6" — drift, see compensation.

**Build tool (app).** Astro's build pipeline over Vite 8 (Rolldown). Config is
near-zero except a documented SSR pre-bundle workaround for Vite 8's
Environment API (`astro.config.mjs:31`).

**Test runners (app).** Vitest 4 with five configs (unit, integration, bench,
analyze, experiment) + Playwright for E2E. Tests co-located per FSD segment.

**Language (solver).** Python ≥3.12 at `poc/cp-sat/` (~1,300 LOC + ~750 LOC
tests). Heavily annotated by discipline — 92 of 104 function defs carry return
annotations; 17 `dataclass`/`TypedDict` declarations across 5 modules — but
**no type checker is configured** (no mypy/pyright in `pyproject.toml`
dependency-groups or `[tool.*]`; ruff's selected rules `E,F,I,UP,B,SIM` do not
type-check).

**Framework (solver).** or-tools CP-SAT (`ortools>=9.15,<9.16`) as the modeling
core; no service framework yet — the HTTP wrapper (FastAPI per PRD FR-010) is
net-new for this change. Package is standard src-layout (hatchling,
`src/cpsat_engine`), pytest 8 + ruff via uv (`uv.lock`).

**CI/CD.** GitHub Actions (`.github/workflows/ci.yml`): `verify` (sync → check
→ lint → steiger → audit → test → build) → `integration` → `e2e` → `deploy`
(migrations + Worker ship on main). No Python lane yet — net-new per FR-015.

**Deployment.** Cloudflare Workers (workerd) via `@astrojs/cloudflare` +
`wrangler.jsonc`; Cloudflare Containers (GA 2026-04) planned for the solver.

**Instruction files.** `CLAUDE.md` (47 lines, strong hard-rules section),
`AGENTS.md` (an `@CLAUDE.md` include — single canonical file),
`context/foundation/` (PRD, conventions, tech docs), `docs/runbooks/`.

## Quality Gate Assessment

| Component | Typed | Convention | Training Data | Documented | Verdict |
|---|---|---|---|---|---|
| TypeScript 6 (app) | ✓ | — | — | — | pass |
| Astro 7 + React 19 (app) | — | ✓ | ✓ | ✓ | pass |
| Vite 8 via Astro (app) | — | ✓ | ~ | ✓ | pass |
| Vitest 4 + Playwright (app) | — | — | ✓ | ✓ | pass |
| Python 3.12 (solver) | ✗ | — | — | — | fail |
| or-tools CP-SAT (solver) | — | ~ | ✓ | ~ | partial |
| pytest 8 (solver) | — | — | ✓ | ✓ | pass |
| uv + hatchling (solver) | — | ✓ | ✓ | ✓ | pass |

Legend: ✓ = pass, ✗ = fail, ~ = partial, — = not applicable
(14 checks pass, 1 fails, 3 partial — partials are compensated, not failed.)

### Gate Details

**Type safety — app: pass.** `tsconfig.json` extends `astro/tsconfigs/strict`;
`pnpm check` (astro check) and type-aware ESLint run in the CI `verify` job;
Zod at API boundaries. Nothing to add.

**Type safety — solver: fail (the one hard gap).** The code is annotated
(92/104 defs) but unenforced — annotations can silently rot. Evidence:
`poc/cp-sat/pyproject.toml` has `dev = ["pytest>=8", "ruff>=0.8"]` and no
`[tool.mypy]`/`[tool.pyright]` section. For agent work this matters doubly
here: the solver owns one side of the frozen wire contract
(`GeneratorSnapshot`/`GenerationResult`), and an agent editing `schema.py`
gets no machine signal when a shape drifts from the TS side.

**Conventions — app: pass.** Astro file-based routing (`src/pages/`,
`src/actions/`) plus FSD with **machine enforcement**: `steiger src
--fail-on-warnings` is a CI gate (`steiger.config.ts`). This is stronger than
framework convention alone — an agent violating layer direction is caught by
CI, not by review. `CLAUDE.md` documents the layer map and hard rules.

**Conventions — solver: partial.** The package itself is Python-conventional
(src layout, `testpaths`, ruff config). Partial because the *service* shape is
net-new: no HTTP framework exists yet, and the repo's instruction file is
100% JS-app-focused — `CLAUDE.md` never mentions `poc/cp-sat/`, uv, ruff, or
pytest, so an agent landing on solver work today gets zero steering from it.

**Training data — app: pass.** Astro, React, Vitest, Playwright, pnpm are all
mainstream JS. One ~ on Vite 8: Rolldown + the Environment API are newer than
most training data — the repo already compensates in-code with the
extensively-commented `ssrPrebundleDeps()` workaround (`astro.config.mjs`).
The same caveat class applies to React Compiler 1.x and Astro 7 specifics.

**Training data — solver: pass (per Python family).** or-tools is *the*
mainstream constraint-programming library in Python; pytest and uv are
family-standard. Nuance: CP-SAT *modeling idiom* is far thinner in training
data than web-framework code — compensated structurally by the POC's ~750 LOC
test suite and the 10/10 objective-parity gate, which catch confabulated
solver code that "looks right".

**Documentation — app: pass.** docs.astro.build (versioned), react.dev,
vitest.dev, developers.cloudflare.com are all current and version-pinned.
Caveat: Cloudflare **Containers** went GA 2026-04 — docs are current but the
platform is young and post-cutoff for most models (the PRD itself cites open
issues like containers#162); agents must verify against live docs, not memory.

**Documentation — solver: partial.** or-tools official docs
(developers.google.com/optimization) are real but CP-SAT's Python reference is
thin — much working knowledge lives in the community primer
(`d-krupke/cpsat-primer`) and the or-tools GitHub examples, outside the main
doc site. FastAPI (planned wrapper) passes cleanly when it lands.

## Gaps & Compensation

Never a stack-replacement question — every gap below has a cheap, concrete
patch, and most land naturally inside the migration this PRD already scopes.

### 1. Solver type checking is unenforced (failed gate)

**Why it matters.** The solver is about to become a production service owning
one side of a frozen, parity-gated wire contract. Unenforced annotations give
an agent false confidence: the types read as guarantees but nothing checks
them. The cheapest moment to fix this is now — FR-015 is already adding the
path-filtered solver CI lane (ruff + pytest); a type checker is one more line
in a lane being built anyway.

**Compensation.** Add mypy (strict) to the solver package and its CI lane:

```toml
# poc/cp-sat/pyproject.toml (carries over to services/solver/)
[dependency-groups]
dev = [
  "pytest>=8",
  "ruff>=0.8",
  "mypy>=1.14",
]

[tool.mypy]
strict = true
packages = ["cpsat_engine"]
mypy_path = "src"
```

Plus the instruction-file rule in the block below (solver section).

### 2. Instruction file is blind to the Python half (partial gate)

**Why it matters.** `CLAUDE.md` steers agents well on the JS app but never
mentions the solver package, its toolchain (uv/ruff/pytest/mise), the wire
contract, or the wrapper-level-testing lesson. As `services/solver/` becomes a
first-class citizen, an unsteered agent will guess at commands and layout.

**Compensation.** Ready-to-paste section in the block below.

### 3. Post-training-cutoff platform surfaces (partial gates)

**Why it matters.** Four load-bearing pieces are newer than most training
data: Cloudflare Containers (GA 2026-04), Vite 8 Rolldown/Environment API,
Astro 7, React Compiler stable. Agents will confidently generate v6-era Astro
or pre-GA Containers config. The PRD's Open Question 3 (CF token scopes)
already mandates doc-verification for one instance of this; generalize it.

**Compensation.** Doc-first rules in the block below, plus fix the existing
drift: `CLAUDE.md` says "Astro 6" while `package.json` pins `^7.0.6`.

### 4. CP-SAT idiom is thin in training data (nuance, not a failed gate)

**Why it matters.** Agents writing or-tools modeling code confabulate
plausible-looking constraints more readily than web code. The project already
has the right structural defenses (oracle, parity gate, wrapper tests); the
compensation is to *name them as gates for agents* so generated solver changes
are always run through them.

### Recommended Instruction File Additions

Paste into `CLAUDE.md` (AGENTS.md includes it automatically):

```markdown
## Solver service (services/solver/ — formerly poc/cp-sat/)

- Python ≥3.12, managed by **uv** (dedicated venv — ortools pins protobuf/numpy
  tightly; never share a venv). Run tooling via `uv run <cmd>` from the package
  dir: `uv run pytest`, `uv run ruff check`, `uv run mypy`.
- **All solver code is fully type-annotated and must pass `mypy --strict`.**
  The wire contract types in `schema.py` mirror the TS
  `GeneratorSnapshot`/`GenerationResult` — never change one side alone; the
  schema artifact in `contracts/` plus golden-fixture tests in BOTH suites
  gate every contract change (`formatVersion` bumps on incompatibility).
- **CP-SAT changes are gated by tests, not review-reading.** Any change to
  modeling/objective code must keep the objective-parity suite at exact 10/10
  and pass the oracle on golden fixtures. Do not trust generated or-tools
  code that hasn't run — CP-SAT idiom is easy to confabulate.
- Test at the wrapper level (HTTP surface), not just the core — the untested
  `cli.py` was the POC's recorded lesson.
- Cross-ecosystem tasks run through **mise**; pnpm scripts remain the JS-side
  canon. Never add solver steps to package.json.

## Post-cutoff platform rules

- **Astro is v7** (not v6) with Vite 8 (Rolldown). Before using Astro/Vite
  config APIs, verify against current docs — several v6-era idioms changed.
  The `ssrPrebundleDeps()` workaround in astro.config.mjs is deliberate; read
  its comment before touching dev-SSR or optimizeDeps behavior.
- **Cloudflare Containers went GA 2026-04** — post-cutoff for most models.
  Never write wrangler.jsonc container bindings, lifecycle config
  (sleepAfter/SIGTERM), or CF API token scopes from memory; fetch current
  Cloudflare docs first. Known platform issue: containers may sleep mid-job
  (containers#162) — job-aware lifecycle is a correctness requirement (FR-011).
- React islands compile through the **React Compiler** — keep render-purity
  discipline; don't hand-add useMemo/useCallback where the compiler already
  memoizes.
```

And one correction to the existing `CLAUDE.md` first paragraph: change
"Astro 6" → "Astro 7".

## Summary

**Overall: ready-with-compensation.** The TypeScript app is agent-ready
outright — strict types, machine-enforced conventions (steiger + type-aware
lint as CI gates), mainstream well-documented stack; on its own it would keep
the previous assessment's *ready* verdict. The compensation burden sits
entirely on the seams this change opens: the Python solver's unenforced type
hints (the single failed gate — one `[tool.mypy]` block plus a CI line,
cheapest to add while FR-015 builds the lane anyway), an instruction file
that doesn't yet know the Python half exists, and four post-cutoff platform
surfaces (Cloudflare Containers above all) where agents must be pointed at
live docs instead of memory.

Key strength: the trust boundary (oracle + parity gate + atomic RPC) doubles
as an agent-error firewall — exactly the structure that makes agent-generated
solver code safe to accept. Key gap: everything Python-side is currently
invisible to the instruction files.

Recommended next step: `/10x-health-check` to turn this into a prioritized
fix list (it reads this assessment and focuses on the identified gaps).
