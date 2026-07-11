---
project: ib-timetable-planner
assessed_at: 2026-06-18T15:32:22Z
agent_readiness: ready
context_type: brownfield
stack_components:
  language: TypeScript
  framework: Astro 7 + React 19 (islands)
  build_tool: Astro/Vite
  test_runner: Vitest (unit/integration) + Playwright (E2E)
  package_manager: pnpm
  ci_provider: GitHub Actions
  deployment_target: Cloudflare Workers (workerd)
gates_passed: 4
gates_failed: 0
---

## Stack Components

- **Language — TypeScript ^6.** Strict, end-to-end typing. `tsconfig.json` extends
  `astro/tsconfigs/strict`; `typescript-eslint` is wired into the ESLint flat
  config; `zod ^4` supplies runtime validation at boundaries (forms via
  `react-hook-form` + `@hookform/resolvers`). The change's most type-sensitive
  surface — the two-cohort constraint core in `src/_pages/plan-detail/model/` —
  benefits directly: input/output shapes for the new week-aware/co-teaching
  occupancy checks are expressible and checkable in source.
- **Framework — Astro ^6.3 (server-first) + React ^19 islands.** Astro provides
  file-based routing (`src/pages/`) and island architecture; React 19 carries the
  interactive surfaces (drag-drop grid via `@dnd-kit/react`, validation feedback).
  Layered on top is Feature-Sliced Design, enforced as a CI gate by `steiger`
  (`steiger src --fail-on-warnings`, `@feature-sliced/steiger-plugin`) — a second,
  project-specific convention system beyond Astro's own.
- **Build tool — Astro/Vite.** `astro build` is the production gate; Tailwind v4
  is wired through `@tailwindcss/vite`; `vite-tsconfig-paths` resolves the `@/*`
  alias. Zero bespoke build scripting.
- **Test runner — Vitest ^4 + Playwright ^1.61.** Vitest runs the unit suite
  (`pnpm test`) and a separate integration config (`vitest.integration.config.ts`);
  Playwright drives E2E (`test:e2e`) with an author-provisioning pretest. Co-located
  `*.test.ts` convention is documented in CLAUDE.md.
- **Package manager — pnpm 11.9.0** (pinned in `packageManager`, `pnpm-lock.yaml`).
- **CI/CD — GitHub Actions** (`.github/workflows/ci.yml`): install → astro sync →
  lint → steiger → test → build, then deploy on push to `main`.
- **Deployment — Cloudflare Workers / workerd** (`wrangler.jsonc`,
  `@astrojs/cloudflare`). Persistence via Supabase (`@supabase/supabase-js`,
  `@supabase/ssr`).
- **Instruction files present — CLAUDE.md and AGENTS.md** (both already substantial).

## Quality Gate Assessment

| Component                         | Typed | Convention | Training Data | Documented | Verdict |
|-----------------------------------|-------|------------|---------------|------------|---------|
| Language (TypeScript)             | ✓     | —          | —             | —          | pass    |
| Framework (Astro 7 + React 19)    | —     | ✓          | ✓             | ✓          | pass    |
| Build tool (Astro/Vite)           | —     | ✓          | ✓             | ✓          | pass    |
| Test runner (Vitest + Playwright) | —     | —          | ✓             | ✓          | pass    |

Legend: ✓ = pass, ✗ = fail, ~ = partial, — = not applicable

### Gate Details

**Type safety — pass.** Evidence: `tsconfig.json` extends `astro/tsconfigs/strict`
(strict mode on, not merely `tsc` present); `typescript ^6.0.3` and
`typescript-eslint ^8` in devDependencies; `zod ^4.4.3` in dependencies for
runtime contract validation at I/O boundaries. The language is typed by default
and the project enforces strictness rather than opting out of it.

**Convention-based — pass.** Evidence: Astro ships file-based routing and island
architecture (`src/pages/`, `src/actions/`, `src/middleware.ts`). Beyond the
framework defaults, the repo enforces Feature-Sliced Design as a hard gate —
`steiger src --fail-on-warnings` in `package.json` plus `steiger.config.ts` and
`@feature-sliced/steiger-plugin`. Import direction (`app → _pages → shared`),
slice/segment layout, and naming are machine-checked, so an agent can predict
where code lives and is blocked at CI if it places code wrongly. `lefthook` runs
hooks pre-commit/pre-push. This is stronger-than-typical convention enforcement.

**Popular in training data (within JS family) — pass.** Evidence: React, Astro,
Vite, Vitest, and Playwright are all mainstream within the JavaScript/TypeScript
ecosystem; the agent has internalized their idioms. One caveat worth tracking (not
a failure): the project rides very recent major versions — Astro 6, React 19,
Tailwind 4, TypeScript 6, ESLint 10, Vitest 4 — newer than much of the training
corpus, which skews toward React 18 / Astro 4–5 / Tailwind 3 / ESLint 8 (eslintrc)
patterns. See Gaps & Compensation.

**Well-documented — pass.** Evidence: Astro, React, Vite, Vitest, Playwright, and
Tailwind all publish current, version-pinned official docs reachable by URL. No
component depends on scattered or stale community docs.

## Gaps & Compensation

**No quality-gate failures.** All four agent-friendly criteria pass for every
component, so there is no gap that requires compensation to make the stack
workable. The verdict is **ready** out of the box.

Two friction points are real for an agent but are **already compensated** by the
existing instruction files — recorded here so they are legible, not because they
need new work:

- **Workers-runtime ceiling (no Node-only APIs).** An agent's reflex is to reach
  for `fs`, `child_process`, `net`, or native modules; these break under workerd.
  Already covered: CLAUDE.md "Hard rules" name this explicitly and require
  `pnpm build` to stay clean. This matters directly for the change — the new
  week-aware / cross-cohort constraint logic and any new persistence must stay
  Workers-safe.
- **FSD import-direction discipline.** An agent may import upward (`shared` →
  `_pages`) or place domain logic in the wrong segment. Already covered: steiger is
  a `--fail-on-warnings` CI gate and CLAUDE.md documents the layer rule and points
  at `steiger.config.ts`. The change's work lands in
  `src/_pages/plan-detail/model/`, squarely inside the enforced structure.

The one item worth a light, preventive addition (below) is **version skew**: the
agent may emit older-major idioms (React 18 effects instead of the React 19
compiler model; flat-config-incompatible ESLint v8 snippets; Tailwind v3 config
syntax). This is a "pass with a watch-item," not a gate failure.

### Recommended Instruction File Additions

The existing CLAUDE.md / AGENTS.md already carry the Workers and FSD conventions.
The only suggested addition is a version-pinning block to neutralize training-data
version skew. Ready to paste into CLAUDE.md (or AGENTS.md):

```markdown
## Versions are current-major — do not regress to older idioms

This project rides recent majors; training data skews older. When generating code:

- **React 19** — assume the React Compiler is in play (`eslint-plugin-react-compiler`
  is active). Do not hand-add `useMemo`/`useCallback` for compiler-handled cases;
  do not reach for legacy patterns (`forwardRef` boilerplate, `useEffect` data-fetch
  in islands). Hooks/helpers stay `.ts`; `.tsx` only for JSX.
- **Astro 6** — file-based routes in `src/pages/`; Actions in `src/actions/` stay
  thin. Confirm any API against Astro 6 docs, not v4/v5 memory.
- **Tailwind v4** — CSS-first config via `@tailwindcss/vite`; do NOT scaffold a
  `tailwind.config.js` v3-style export.
- **ESLint v10 flat config** — edit `eslint.config.*`; never add `.eslintrc*`.
- **TypeScript ^6 / Vitest ^4** — verify flags and APIs against current docs before
  using anything you're unsure carried forward.

If unsure about a current API, fetch the versioned docs rather than relying on
memory.
```

> Note: this overlaps the project's existing context7 doc-fetch rule, which is good
> — the block makes the version expectation explicit at the point of code generation.

## Summary

**Verdict: ready.** This is a strong, modern, convention-heavy TypeScript stack
that meets all four agent-friendly criteria with no compensation required to be
workable.

- **Key strengths.** End-to-end strict TypeScript with Zod at boundaries (an agent
  can reason about the new constraint shapes from source); convention enforcement
  that goes *beyond* the framework — FSD is machine-checked at CI via steiger, so
  structural mistakes fail fast rather than drifting; mainstream, well-documented
  tooling throughout; CI that already runs lint → steiger → test → build.
- **Watch-items (not gaps).** (1) Version skew — the stack is newer than the
  training corpus; the version-pinning block above keeps generated code on the
  current majors. (2) Workers-runtime and FSD constraints are real agent traps but
  are already documented in CLAUDE.md/AGENTS.md.
- **Relevance to the planned change.** The change concentrates on
  `src/_pages/plan-detail/model/` (the <200 ms constraint core) and the React 19
  drag-drop islands — both inside the typed, FSD-enforced zone. The stack supports
  the work; the agent-facing risk is idiom version-skew and the Workers ceiling,
  both already addressable via instruction files.

**Recommended next step:** `/10x-health-check` — audit dependency health, security,
the test suite, and CI/CD coverage, using this assessment to focus on the
change-relevant components.
