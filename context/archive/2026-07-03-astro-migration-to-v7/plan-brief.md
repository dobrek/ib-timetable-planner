# Astro v6 → v7 Upgrade — Plan Brief

> Full plan: `context/changes/astro-migration-to-v7/plan.md`
> Research: `context/changes/astro-migration-to-v7/research.md`

## What & Why

Upgrade to the latest Astro (**7.0.6**), bumping `@astrojs/cloudflare` 13→14 and `@astrojs/react` 5→6 in lockstep (Vite 7→8 comes transitively). Keeps the stack on current majors — the project's stated philosophy — and clears the way before the version gap widens. Research confirmed the app avoids every hard-breaking v7 change, so this is a contained, low-risk bump.

## Starting Point

Astro 6.4.8 on Cloudflare Workers, React 19 islands, Tailwind v4. The framework footprint is narrow and modern (Actions via one factory, one middleware, typed `astro:env` secrets, `client:load` islands) and — critically — reads **zero** Cloudflare runtime bindings and has **no** markdown/content surface, which are exactly the two areas v7 + adapter-v14 break hardest.

## Desired End State

`package.json` on `astro ^7.0.6` / `@astrojs/cloudflare ^14.1.1` / `@astrojs/react ^6.0.1`, Vite 8 resolved, all gates green (`build`, `check`, `lint`, `steiger`, `test`, `test:integration`, `test:e2e`), `pnpm dev` free of the React-dedup crash, and a hosted branch-preview smoke passing. The long-standing `ssrPrebundleDeps` "is it still needed?" question is settled with evidence.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Target version | Astro 7.0.6 + adapter 14 + react 6, lockstep | Latest majors; companions require astro ^7 | Research |
| Node / wrangler / zod | Unchanged | v7 Node floor unchanged; wrangler 4.102 already ≥4.83; astro 7 still bundles zod ^4 | Research |
| PR scope | Core bump + one stale-doc fix only | Doctrine: isolated changelog-read PR; keep compat-date/nodejs_compat/exact pins out | Plan |
| `ssrPrebundleDeps` plugin | Keep through upgrade → confirm stable → then test removal in-scope | Resolve the open decision with evidence without coupling variables (Chesterton's Fence) | Plan |
| `compressHTML: 'jsx'` default | Accept it; verify visually (no config pin) | Stay on framework default; spacing risk is cosmetic and checkable | Plan |
| Verification gate | Full doctrine gate: `/verify` + Playwright + branch-preview deploy | Adapter major → workerd-only regressions need the hosted smoke | Plan |

## Scope

**In scope:** bump `astro`/`@astrojs/cloudflare`/`@astrojs/react`; refresh lockfile (Vite 8); `astro sync` + type/build/lint/steiger/test gates; empirical dev-SSR verification; `ssrPrebundleDeps` removal experiment; fix stale `ui-conventions.md:232`; CI `wranglerVersion` pin check; full gate + preview smoke.

**Out of scope:** `compatibility_date` / `nodejs_compat` changes; moving exact pins (`@dnd-kit` 0.5.0, `react-compiler` 1.0.0); bumping unrelated deps or `sitemap`/`check`; pinning `compressHTML`; any Supabase schema/data change; refactoring the Vitest `astro:*` stubs (unless a verified break forces it).

## Architecture / Approach

Isolate each variable so regressions are attributable: **(1)** bump + build/type integrity with the dev workaround untouched → **(2)** confirm dev SSR is stable *with* the plugin (the primary risk) → **(3)** only then experiment with removing the plugin → **(4)** doc fix + full gate + hosted preview smoke. The primary risk lives entirely in dev tooling (Vite 8's Rolldown optimizer vs the `configEnvironment`/`optimizeDeps` workaround) and cannot affect the production Worker.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Bump & build/type integrity | v7 deps + Vite 8 resolved; build/check/lint/steiger/test green | A forced config migration we didn't foresee (none expected) |
| 2. Dev-SSR stability | Evidence `pnpm dev` has no React-dedup regression under Vite 8 | Rolldown optimizer resurfaces the "Invalid hook call" race |
| 3. `ssrPrebundleDeps` removal experiment | Evidence-based keep/delete decision for the dev plugin | Removing too eagerly reintroduces the dev-SSR crash |
| 4. Full gate, doc fix & merge readiness | Stale doc fixed; `/verify` + E2E + preview smoke pass | A workerd/adapter-v14-only regression only visible on the hosted runtime |

**Prerequisites:** local Supabase running for integration tests; Docker for the local stack; ability to run a Cloudflare branch-preview deploy.
**Estimated effort:** ~3–5 hours across 4 phases (mostly verification, not code).

## Open Risks & Assumptions

- Vite 8's Rolldown optimizer + workerd dev may either obsolete or subtly change the `ssrPrebundleDeps` workaround — resolved empirically in Phases 2–3, not assumed.
- Docs report no `astro:actions` change, so the Vitest `astro:*` stubs should hold; if `pnpm test` reddens on the action boundary, the stub is the first suspect.
- Assumes `@astrojs/sitemap 3.7.3` / `@astrojs/check 0.9.9` (both already latest) work under Astro 7 — verified by `pnpm check` + build in Phase 1.

## Success Criteria (Summary)

- App builds, type-checks, and passes unit + integration + E2E suites on Astro 7 / Vite 8.
- `pnpm dev` runs cleanly with no React-instance-duplication crash; the plugin's fate is decided from evidence.
- A hosted branch-preview smoke (auth → planner board → drag-drop with live validation → CRUD → sign out) passes before merge.
