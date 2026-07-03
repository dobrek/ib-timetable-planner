---
date: 2026-07-03T09:07:31+02:00
researcher: Dobromir Kropielnicki
git_commit: e97dd9043ea80cd04b673446805587108b546f0d
branch: main
repository: dobrek/ib-timetable-planner
topic: "Feasibility of upgrading to the latest Astro (v7), including companion libraries and dependencies"
tags: [research, codebase, astro, upgrade, cloudflare-adapter, vite, react]
status: complete
last_updated: 2026-07-03
last_updated_by: Dobromir Kropielnicki
---

# Research: Astro v6 → v7 upgrade feasibility (companion libs + dependencies)

**Date**: 2026-07-03T09:07:31+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: e97dd9043ea80cd04b673446805587108b546f0d
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check the feasibility of upgrading the project to the latest version of Astro (v7), especially in the context of companion libraries and other dependencies.

## Summary

**Verdict: FEASIBLE — high confidence, low risk. This is a small, contained upgrade PR, not a migration project.**

The latest Astro is **v7.0.6**. Moving to it pulls two companion majors — **`@astrojs/cloudflare` 13 → 14** and **`@astrojs/react` 5 → 6** — plus a transitive **Vite 7 → 8** bump. `@astrojs/sitemap` (3.7.3) and `@astrojs/check` (0.9.9) are already at their latest and need no change. **Node stays put** (`>=22.12.0`, unchanged from v6; project runs 24.15.0), and **`wrangler` 4.102 already satisfies** the adapter-v14 floor (`^4.83.0`).

The app is unusually well-insulated from v7's two most disruptive breaking changes:

- **Cloudflare adapter v14 restructured `Astro.locals.runtime.*`** — but this app reads **zero** Cloudflare runtime bindings. Secrets flow through framework-agnostic `astro:env/server`; there is no KV/D1/R2/session/image-service/platformProxy usage. The adapter is invoked with default options and `wrangler.jsonc` already points `main` at the v14 entrypoint. **No impact.**
- **The default Markdown processor changed** — but there is **no** markdown/MDX/content-collection surface anywhere. **No impact.**

Scanning the entire framework surface, the app uses **no removed or deprecated Astro API**. `src/fetch.ts` (newly reserved), `@astrojs/db` (removed), the Container API, `getStaticPaths`, `prerender`, `astro:transitions` internal constants, and the experimental flags that v7 removes are **all absent**. The only `astro:transitions` usage is the stable public `navigate()` client helper.

**The single real engineering uncertainty is the custom `ssrPrebundleDeps` Vite plugin** (`astro.config.mjs`), which touches the Vite Environment API (`configEnvironment`) and `optimizeDeps.include` to work around a dev-only React-instance-duplication bug. Vite 8 keeps the `configEnvironment` hook and `optimizeDeps.include`, but swaps the dependency optimizer from esbuild to **Rolldown** — which changes the exact behavior the workaround guards against. This is dev-only, contained, and empirically verifiable (`pnpm dev` + the documented diagnostic tell), and even in the worst case degrades to "re-tune or drop the include list", not a blocker.

Secondary watch-items: the stricter **Rust HTML compiler** (19 `.astro` files spot-checked clean), the **`compressHTML: 'jsx'`** whitespace default (cosmetic; pinnable), and the Vitest **`astro:*` stubs** drifting if `astro:actions` semantics changed (they didn't, per the docs).

**Rough effort: ~3–5 hours** — bump five package versions, `pnpm build` + `pnpm check` to shake out the Rust-compiler/type surface, hand-verify `pnpm dev` for the React-dedup regression, run the Playwright workerd smoke, and branch-preview-deploy before merge. Follows the project's existing "isolated changelog-read PR" doctrine.

## Version compatibility matrix

| Package | Current | Latest / target | Constraint check | Verdict |
|---|---|---|---|---|
| `astro` | ^6.4.8 | **7.0.6** | engines `node >=22.12.0` (unchanged), `pnpm >=7.1.0` | ✅ upgrade |
| `@astrojs/cloudflare` | ^13.7.0 | **14.1.1** | peer `astro ^7.0.0`, `wrangler ^4.83.0` (project 4.102) | ✅ upgrade in lockstep |
| `@astrojs/react` | ^5.0.7 | **6.0.1** | peer `react ^17‖18‖19`, `@types/react ^19` — React 19 OK | ✅ upgrade in lockstep |
| `@astrojs/sitemap` | ^3.7.3 | **3.7.3** | already latest | ✅ no change |
| `@astrojs/check` | ^0.9.9 | **0.9.9** | already latest; peer `typescript ^5‖^6` (project TS 6) | ✅ no change |
| `vite` (transitive) | 7.x | **8.1.3** | pulled by astro 7 / adapter 14 | ⚠️ verify custom Vite plugin |
| `node` | 24.15.0 | — | astro 7 needs `>=22.12.0` | ✅ unchanged |
| `wrangler` | ^4.102.0 | — | adapter 14 needs `^4.83.0` | ✅ already satisfied |
| `react` / `react-dom` | ^19.2.7 | — | `@astrojs/react` 6 supports 19 | ✅ unchanged |
| `tailwindcss` / `@tailwindcss/vite` | ^4.3.0 | — | Vite-plugin path, Astro-version-independent | ✅ unchanged |
| `zod` | ^4 | — | "version-aligned with Astro's bundled copy" (lessons.md) | ⚠️ confirm v7 didn't bump bundled zod |

> Sources: `pnpm view <pkg> engines peerDependencies`; official v7 upgrade guide; `@astrojs/cloudflare` and `@astrojs/react` CHANGELOGs; Vite migration guide (all fetched 2026-07-03).

## Detailed Findings

### Astro v7 breaking changes — impact on this app

Cross-verified against the [official v7 upgrade guide](https://docs.astro.build/en/guides/upgrade-to/v7/) and Context7 (`/withastro/docs`).

| # | v7 breaking change | Present in this app? | Impact |
|---|---|---|---|
| 1 | **Vite 8** (esbuild → Rolldown dep optimizer) | Yes — `ssrPrebundleDeps` plugin | ⚠️ **PRIMARY RISK** (see below) |
| 2 | **Rust compiler** — stricter HTML, no auto-correction of unclosed non-void tags | 19 `.astro` files, all balanced | 🟡 Low — build gate catches; spot-check clean |
| 3 | **`compressHTML` default `true` → `'jsx'`** — strips whitespace between inline elements | No explicit `compressHTML`; app inherits new default | 🟡 Low/cosmetic — eyeball inline text; pin `compressHTML: true` if spacing regresses |
| 4 | **`src/fetch.ts` reserved** for advanced routing (now default) | Absent | ✅ None |
| 5 | **Default Markdown processor changed** (`@astrojs/markdown-remark` no longer default) | No markdown/MDX/content | ✅ None |
| 6 | **Experimental flags removed** (`logger`, `queuedRendering`, `rustCompiler`, `advancedRouting`, `cache`, `routeRules`) | No `experimental:` block | ✅ None |
| 7 | **`getContainerRenderer` moved** to `/container-renderer` entrypoint | Container API absent | ✅ None |
| 8 | **`astro:transitions` internal APIs removed** (`TRANSITION_*`, `createAnimationScope`) | Only `navigate()` (public) used | ✅ None — confirm `navigate` still exported |
| 9 | **`@astrojs/db` removed** | Absent | ✅ None |

**Framework surface actually used** (all stable, all public, no documented v7 change): `astro:actions` (31 actions via one factory), `astro:middleware` (`defineMiddleware`), `astro:env/server` (typed secrets), `astro:transitions/client` (`navigate` only), `astro/config` (`defineConfig`, `envField`), and `astro` types (`APIRoute`, `AstroCookies`). See [Code References](#code-references).

### Cloudflare adapter v14 breaking changes — impact on this app

From the `@astrojs/cloudflare` CHANGELOG (14.0.0). **This is where the app's decoupling pays off:**

| v14 breaking change | Present in this app? | Impact |
|---|---|---|
| `Astro.locals.runtime.*` restructured (`.env` → `import { env } from 'cloudflare:workers'`; `.cf` → `Astro.request.cf`; `.caches` → global `caches`; ExecutionContext → `Astro.locals.cfContext`) | **No `locals.runtime` usage anywhere** | ✅ None |
| Dev server now runs **in workerd** (was Node) | App forbids Node-only APIs; runtime `src/` has zero `node:` imports | 🟡 Low — verify dev; may interact with the Vite dep workaround |
| `main` entrypoint → `@astrojs/cloudflare/entrypoints/server` | **Already set** in `wrangler.jsonc` | ✅ None |
| Default image service `compile` → `cloudflare-binding` | No `astro:assets`/`<Image>`/`getImage` | ✅ None |
| Custom entrypoint `createExports()` → direct export | No custom entrypoint | ✅ None |
| Removed `workerEntryPoint`, `cloudflareModules` options | Not used (`cloudflare()` called with no options) | ✅ None |
| **Cloudflare Pages support dropped** | Deploys to Workers | ✅ None |

### React integration v6 — impact on this app

From the `@astrojs/react` CHANGELOG (6.0.0): the only breaking changes are the Vite 8 bump and the `getContainerRenderer` entrypoint move (unused). `experimentalReactChildren`, `include`/`exclude`, client directives, and the **Babel/React-Compiler config path are explicitly preserved**. The app wires `babel-plugin-react-compiler` (`target: "19"`) through `@astrojs/react`'s `babel` option — verify auto-memoization still activates after the bump (no config change expected). Only `client:load` is used (6 sites); no exotic directives.

### PRIMARY RISK — the `ssrPrebundleDeps` Vite plugin vs Vite 8

`astro.config.mjs` registers a custom Vite plugin that force-includes `astro/env/runtime`, `react`, `react-dom`, `react-dom/server`, `react/jsx-runtime` in `optimizeDeps` for non-client environments, via the Vite **Environment API** `configEnvironment` hook:

```js
function ssrPrebundleDeps() {
  return {
    name: "ssr-prebundle-deps",
    configEnvironment(name) {
      if (name === "client") return;
      return { optimizeDeps: { include: ["astro/env/runtime", "react", "react-dom", "react-dom/server", "react/jsx-runtime"] } };
    },
  };
}
```

- **Why it exists:** a dev-only bug. Vite discovers `astro/env/runtime` (reached transitively via the Supabase client's `astro:env/server` import) **late, on first request**, re-optimizes mid-render, and reloads — leaving evaluated modules on a stale `react` chunk while `react-dom/server` reloads fresh → two React instances → *"Invalid hook call" / "Cannot read null useState"* in dev SSR. Introduced S-01, commit `38b05a2` ("fix: prevent dev-SSR React split"); documented in memory note `note-astro-vite-react-dedup`.
- **Vite 8 delta:** the migration guide does **not** list `configEnvironment` or `optimizeDeps.include` as changed (both should keep working), but Vite 8 **replaces esbuild with Rolldown as the dependency optimizer**. The plugin guards a re-optimization *race*, so the optimizer swap is exactly the kind of change that could alter — resolve *or* resurface — the underlying behavior. Adapter v14's shift to **workerd dev** changes the dev environment too.
- **De-risk:** dev-only (no production-build effect). Verify by running `pnpm dev`, exercising an SSR route with a React island, and watching for the documented tell (`✨ new dependencies optimized` + mismatched `?v=` hashes). Worst case: re-tune or remove the `include` list. **Contained, not a blocker.**

### Test toolchain coupling

- **Vitest** (`vitest.config.ts`, `vitest.integration.config.ts`) doesn't import Astro/`getViteConfig`; it stubs the two used virtual modules by string alias — `astro:env/server` → `test/stubs/astro-env-server.ts`, `astro:actions` → `test/stubs/astro-actions.ts`. `test/stubs/astro-actions.ts` reimplements `ActionError`/`defineAction`/`ActionAPIContext`, and `defineAction` is stubbed as a passthrough assuming the `{ input, handler }` shape. If v7 changed `astro:actions` these would drift — **but the docs report no `astro:actions` change**, so this is a low watch-item, not expected work.
- **Playwright** (`playwright.config.ts`) drives the **real workerd build** (`pnpm build && pnpm preview`) — the best post-upgrade end-to-end smoke, exercising the Cloudflare adapter output directly.

### Dependencies not coupled to Astro (should not be forced by v7)

- **`@dnd-kit/react` / `@dnd-kit/dom` — exact-pinned `0.5.0`** (no caret) to insulate against pre-1.0 churn; the drag-drop core is the north-star surface. Not Astro-coupled — **hold the pin**; if a resolution forces movement, re-run grid + E2E.
- **`babel-plugin-react-compiler` — exact-pinned `1.0.0`**, wired through `@astrojs/react`'s Babel option. Not Astro-coupled — hold; confirm the compiler still runs post-bump.
- **`zod ^4`** — deliberately "version-aligned with Astro's bundled copy" (lessons.md). Confirm Astro 7 didn't bump its bundled zod to a new major; if it did, coordinate.
- **Tailwind v4** — Vite-plugin-only (`@tailwindcss/vite`), no PostCSS/`tailwind.config`. Astro-version-independent. No expected impact.

## Code References

- [`astro.config.mjs:19-32`](https://github.com/dobrek/ib-timetable-planner/blob/e97dd9043ea80cd04b673446805587108b546f0d/astro.config.mjs#L19-L32) — `ssrPrebundleDeps` plugin (**primary Vite 8 risk**)
- [`astro.config.mjs:41-45`](https://github.com/dobrek/ib-timetable-planner/blob/e97dd9043ea80cd04b673446805587108b546f0d/astro.config.mjs#L41-L45) — React Compiler Babel config (`target: "19"`), the `@astrojs/react` 5→6 surface
- [`astro.config.mjs:51`](https://github.com/dobrek/ib-timetable-planner/blob/e97dd9043ea80cd04b673446805587108b546f0d/astro.config.mjs#L51) — `cloudflare()` adapter, default options (the 13→14 surface)
- [`astro.config.mjs:52-57`](https://github.com/dobrek/ib-timetable-planner/blob/e97dd9043ea80cd04b673446805587108b546f0d/astro.config.mjs#L52-L57) — `env.schema` (`astro:env` — insulates secrets from adapter runtime bindings)
- [`wrangler.jsonc:4-6`](https://github.com/dobrek/ib-timetable-planner/blob/e97dd9043ea80cd04b673446805587108b546f0d/wrangler.jsonc#L4-L6) — `main` already the v14 entrypoint; `compatibility_date`, `nodejs_compat`
- [`src/shared/api/supabase.ts:3`](https://github.com/dobrek/ib-timetable-planner/blob/e97dd9043ea80cd04b673446805587108b546f0d/src/shared/api/supabase.ts#L3) — `astro:env/server` secret access (not `locals.runtime.env`)
- [`src/middleware.ts:1`](https://github.com/dobrek/ib-timetable-planner/blob/e97dd9043ea80cd04b673446805587108b546f0d/src/middleware.ts#L1) — `defineMiddleware` (stable)
- [`src/shared/lib/actions/define-domain-action.ts:22`](https://github.com/dobrek/ib-timetable-planner/blob/e97dd9043ea80cd04b673446805587108b546f0d/src/shared/lib/actions/define-domain-action.ts#L22) — the single `defineAction` call site (31 actions funnel through it)
- [`src/shared/lib/forms/refresh-page.ts:1`](https://github.com/dobrek/ib-timetable-planner/blob/e97dd9043ea80cd04b673446805587108b546f0d/src/shared/lib/forms/refresh-page.ts#L1) — `navigate` from `astro:transitions/client` (public API, unaffected by removed internals)
- [`src/env.d.ts:1-5`](https://github.com/dobrek/ib-timetable-planner/blob/e97dd9043ea80cd04b673446805587108b546f0d/src/env.d.ts#L1-L5) — `App.Locals` declares only `user`, no `runtime` binding
- `test/stubs/astro-actions.ts` — reimplements `astro:actions` for Vitest; watch for drift
- `playwright.config.ts` — `pnpm build && pnpm preview` workerd smoke (post-upgrade verification)

## Architecture Insights

- **Deliberate decoupling from the runtime is the single biggest de-risking factor.** By reading secrets through `astro:env` rather than `Astro.locals.runtime.env`, and by never touching KV/D1/R2/sessions/image-service, the app sidesteps the entire `@astrojs/cloudflare` v14 breaking surface. The FSD boundaries and the "Astro Actions are the single transport" convention keep the Astro API footprint tiny and centralized (one `defineAction` factory, one middleware, one env schema).
- **`astro check` is the real type gate**, not `build`/`test`/`lint` (lessons.md — "Green build ≠ type-safe"). Run `pnpm check` **after `astro sync`** so it consumes freshly-generated v7 types. `steiger --fail-on-warnings` (FSD) is the other machine gate; neither should be affected by the upgrade but both must stay green.
- **The stack consciously rides recent majors** (React 19 + compiler, Astro 6, Tailwind v4, ESLint 10, TS 6, Vitest 4) and treats "newer than the training corpus" as a managed watch-item — reinforcing the project's rule to fetch versioned docs (Context7) rather than trust model memory. Moving to Astro 7 is consistent with that philosophy.

## Historical Context (from prior changes)

- **Established upgrade doctrine** — `context/foundation/infrastructure.md:85-88`: *"Pin Astro and `@astrojs/cloudflare` minor versions… Read CHANGELOG before upgrading. Keep the /verify skill happy as the canary"* and *"Treat compat-date bumps in wrangler.jsonc as code changes — own PR, own changelog read, own preview-deploy test. Never bundle with feature work."* → Do v7 as an isolated PR; **keep `compatibility_date`/`nodejs_compat` changes out of it** unless v7 mandates them.
- **Adapter shape-shift warning** — `context/foundation/infrastructure.md:66`: *"The `@astrojs/cloudflare` adapter has changed shape between major versions… Trust only the official adapter README pinned to your version."* Confirmed: v14 is a real major with runtime-binding restructuring (mitigated here by non-usage).
- **Dependency-health snapshot** — `context/foundation/health-check.md:68-79`: repo "rides current majors, 0 packages 2+ majors behind"; notes the CI `wranglerVersion:` pin in `.github/workflows/ci.yml` must stay in lockstep with the lockfile — an adapter bump may re-touch it.
- **The React-dedup workaround origin** — `astro.config.mjs` inline comment + memory note `note-astro-vite-react-dedup`; introduced S-01 (`38b05a2`), flagged as "a documented React-SSR-dedup fragility" in `context/archive/2026-06-07-app-shell/reviews/plan-review.md:62`.
- **Exact-pin rationale** — `@dnd-kit` 0.5.0 (`context/archive/2026-06-05-first-valid-drop-with-validation/plan.md:66`); `babel-plugin-react-compiler` 1.0.0 with `target:"19"` and no runtime polyfill (`context/archive/2026-06-29-use-placements-cleanup/plan.md:297-301`).
- **Doc drift to fix during the upgrade** — `context/foundation/ui-conventions.md:232` is **stale**: it claims "There is no React Compiler transform — only the eslint rule", but the compiler became a real build transform in commit `8b843e0`. Worth correcting in this change.

## Suggested sequencing (for the plan)

1. **Isolated PR, changelog-read first.** Bump `astro` 6→7, `@astrojs/cloudflare` 13→14, `@astrojs/react` 5→6 in lockstep. Leave `sitemap`/`check` as-is. Keep `@dnd-kit` and `react-compiler` pins; keep `compatibility_date`/`nodejs_compat` untouched.
2. **`astro sync` → `pnpm check`** — regenerate v7 types, catch the Rust-compiler HTML surface and any type drift.
3. **`pnpm dev` hand-verify the React-dedup regression** against Vite 8 / workerd dev — the primary risk. Watch the documented diagnostic tell.
4. **`pnpm build`** — confirm clean under Vite 8 / Rolldown; **eyeball inline whitespace** for the `compressHTML: 'jsx'` default (pin `compressHTML: true` if needed).
5. **Full `/verify` mirror** (`astro sync` → `astro check` → lint → steiger → test → build) + **Playwright workerd smoke** + **branch-preview deploy** before merge.
6. Refresh the stale `ui-conventions.md:232` compiler note; check the CI `wranglerVersion` pin.

## Open Questions

- Does Astro 7 bundle a new `zod` major? If so, the `zod ^4` alignment (lessons.md) needs a coordinated bump. (Verify at plan time.)
- **Decision: can `ssrPrebundleDeps` be removed entirely?** It is dev-only (no production-build effect), so removal carries zero production risk. But it fixes a documented, observed dev-SSR "Invalid hook call" bug, and a working fix is indistinguishable from "bug never happens" — do **not** remove it on the "hard to reproduce" premise alone (Chesterton's Fence). Decide empirically, and only *after* v7 is confirmed stable with the plugin in place: clear the pre-bundle cache (`rm -rf node_modules/.vite`), cold-start `pnpm dev`, and load an SSR route with a React island (e.g. `/auth/signin`, `/plans/:id`) on the **very first** request across several cold starts. The steady-state "refresh and it's fine" signal does *not* settle this — the race only fires on the first request after a cold optimize. Vite 8 (Rolldown optimizer) + workerd dev may make the workaround obsolete (delete config with evidence) or require a re-tuned `include` list. Sequence: (1) upgrade with plugin in place → (2) confirm dev stable → (3) then test removal.
- Confirm `navigate` is still exported from `astro:transitions/client` in v7 (expected: yes — public API; the removals were internal transition constants only).

## Related Research

- Memory note `note-astro-vite-react-dedup` — root cause + fix for the dev-SSR React split (the `optimizeDeps` workaround).
- `context/foundation/infrastructure.md` — risk register / upgrade doctrine.
- `context/foundation/stack-assessment.md` — "current-major, do not regress" stack philosophy + quality gates.
- `context/archive/2026-06-29-use-placements-cleanup/plan.md` — React Compiler adoption decisions.
