# Astro v6 → v7 Upgrade Implementation Plan

## Overview

Upgrade the app from Astro 6.4.8 to **7.0.6**, bumping `@astrojs/cloudflare` 13→14 and `@astrojs/react` 5→6 in lockstep (Vite 7→8 arrives transitively). The framework surface used here avoids every hard-breaking v7/adapter-v14 change, so this is a contained version bump verified behind the project's full CI gate — not a migration project. Along the way we resolve one standing decision with evidence (can the dev-only `ssrPrebundleDeps` plugin be removed under Vite 8?) and correct one stale foundation doc.

## Current State Analysis

- **Installed:** `astro ^6.4.8`, `@astrojs/cloudflare ^13.7.0`, `@astrojs/react ^5.0.7`, `@astrojs/sitemap ^3.7.3`, `@astrojs/check ^0.9.9`, `react ^19.2.7`, `vite 7.x` (transitive), `tailwindcss ^4.3.0`, `zod ^4.4.3`, `wrangler ^4.102.0`, Node 24.15.0.
- **Framework footprint is narrow and modern** (from `research.md`): `astro:actions` (31 actions through one `defineDomainAction` factory), one `astro:middleware`, typed `astro:env/server` secrets, `astro:transitions/client` `navigate()` only, `output: "server"`, `cloudflare()` adapter with default options, React islands via `client:load`.
- **The app avoids the two biggest v7 breaking surfaces:** it reads **zero** Cloudflare runtime bindings (`Astro.locals.runtime.*`, KV/D1/R2, sessions, image service) — secrets flow through `astro:env` — and has **no** markdown/MDX/content-collection surface. `wrangler.jsonc` already points `main` at the v14 entrypoint (`@astrojs/cloudflare/entrypoints/server`).
- **No removed/deprecated API in use:** no `src/fetch.ts`, no `@astrojs/db`, no Container API, no `getStaticPaths`/`prerender`, no removed `astro:transitions` internals, no `experimental:` block.
- **The one Vite-internals touchpoint** is the custom `ssrPrebundleDeps` plugin in `astro.config.mjs:19-32` — a **dev-only** workaround (no production-build effect) for a React-instance-duplication bug in dev SSR, using the Vite Environment API (`configEnvironment`) + `optimizeDeps.include`.
- **Established upgrade doctrine** (`context/foundation/infrastructure.md:85-88`): isolated changelog-read PR, keep `compatibility_date`/`nodejs_compat` out of it, gate on `/verify` + branch-preview deploy.

## Desired End State

`package.json` declares `astro ^7.0.6`, `@astrojs/cloudflare ^14.1.1`, `@astrojs/react ^6.0.1`; the lockfile resolves Vite 8; `pnpm build`, `pnpm check`, `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm test:integration`, and `pnpm test:e2e` are all green; `pnpm dev` runs without the React-dedup "Invalid hook call" regression; a branch-preview deploy smoke-passes on the hosted Worker runtime; the `ssrPrebundleDeps` removal decision is settled with evidence and reflected in `astro.config.mjs`; and `context/foundation/ui-conventions.md:232` no longer claims "no React Compiler transform". Verify by running the full `/verify` gate plus the manual smoke checklist in Phase 4.

### Key Discoveries:

- Astro 7 bundles `zod ^4.3.6` — **same major** as Astro 6; our `zod ^4.4.3` stays aligned, **no zod coordination needed** (verified via `pnpm view`).
- Astro 7 pulls `vite ^8.0.13`; `@astrojs/react@6.0.1` peer-pins only `react`/`@types` (React 19 OK), not `astro`.
- `@astrojs/cloudflare@14` requires `wrangler ^4.83.0` — project's `4.102` already satisfies it; Node floor is unchanged (`>=22.12.0`).
- Vite 8 keeps `configEnvironment` and `optimizeDeps.include` but swaps the dep optimizer esbuild→**Rolldown** — the exact behavior the `ssrPrebundleDeps` workaround guards against ([research.md](./research.md) "PRIMARY RISK").
- Adapter v14 changes dev to run **in workerd** and flips the default image service to `cloudflare-binding` (irrelevant — no `astro:assets` usage).

## What We're NOT Doing

- **Not** touching `compatibility_date` or `nodejs_compat` in `wrangler.jsonc` (separate concern per doctrine).
- **Not** relaxing or moving the exact pins: `@dnd-kit/{react,dom}` `0.5.0`, `babel-plugin-react-compiler` `1.0.0` (neither is Astro-coupled; hold unless resolution forces movement).
- **Not** bumping unrelated/lagging dependencies opportunistically, and **not** upgrading `@astrojs/sitemap` / `@astrojs/check` (already latest).
- **Not** pinning `compressHTML: true` — we accept the new `'jsx'` default and verify visually.
- **Not** migrating any Cloudflare runtime-binding code (none exists), markdown pipeline (none), or Container API (none).
- **Not** refactoring the Vitest `astro:*` stubs unless a verified `astro:actions` break forces it (docs report no `astro:actions` change).

## Implementation Approach

Sequence the work so each variable is isolated and independently verifiable. Phase 1 bumps the three majors and proves compile/type/build integrity under Vite 8 **with the dev workaround still in place**. Phase 2 confirms the dev-SSR runtime is stable (the primary risk) before we change anything else. Only then does Phase 3 run the removal experiment on the `ssrPrebundleDeps` plugin — keeping the upgrade and the removal as separate, attributable changes (if dev SSR breaks, we know which caused it). Phase 4 fixes the stale doc and runs the full doctrine gate — `/verify`, Playwright E2E against the workerd build, and a hosted branch-preview smoke — before merge.

## Critical Implementation Details

- **State sequencing (load-bearing):** never remove `ssrPrebundleDeps` before Phase 2 confirms dev SSR is stable *with* it. Coupling the upgrade and the removal makes a regression unattributable — that's the whole reason Phase 3 is separate.
- **Debug & observability — the cold-start test only signals on the first request.** The React-dedup race fires when Vite discovers a dep late and re-optimizes mid-render; after the first optimize pass, refreshes are clean regardless. So the only valid test is: `rm -rf node_modules/.vite`, cold-start `pnpm dev`, hit an SSR+island route on the **very first** load, and watch for `✨ new dependencies optimized` followed by a reload with mismatched `?v=` hashes and an "Invalid hook call" / "Cannot read null useState". Repeat across ≥3 cold starts. Steady-state "refresh and it's fine" proves nothing here.

## Phase 1: Bump versions & build/type integrity

### Overview

Move the three companion majors, refresh the lockfile (Vite 8 comes transitively), regenerate Astro types, and prove the program builds and type-checks under v7 with no runtime behavior changes yet. The `ssrPrebundleDeps` plugin stays untouched this phase.

### Changes Required:

#### 1. Dependency versions

**File**: `package.json`

**Intent**: Bump Astro and its two coupled integrations to their latest majors; leave everything else (sitemap, check, exact pins, zod, wrangler, react) exactly as-is.

**Contract**: `astro ^6.4.8 → ^7.0.6`, `@astrojs/cloudflare ^13.7.0 → ^14.1.1`, `@astrojs/react ^5.0.7 → ^6.0.1`. No other dependency lines change.

#### 2. Lockfile refresh

**File**: `pnpm-lock.yaml`

**Intent**: Resolve the new majors and let Vite 8 land transitively via Astro 7 / adapter 14.

**Contract**: `pnpm install` regenerates the lockfile; resolved tree shows `astro@7.0.6`, `@astrojs/cloudflare@14.x`, `@astrojs/react@6.x`, `vite@8.x`. Confirm with `pnpm why vite` (single Vite 8 major) and `pnpm ls astro @astrojs/cloudflare @astrojs/react`.

#### 3. Config audit (expected: no functional edit)

**File**: `astro.config.mjs`

**Intent**: Confirm nothing in the config requires a forced v7/adapter-v14 migration (no `experimental:` block to relocate, `cloudflare()` still called with default options, entrypoint already correct). The only permitted edit is a comment refresh — the plugin header at `astro.config.mjs:9-18` says "Vite 7 Environment API"; update the version reference to Vite 8. Do **not** change plugin behavior in this phase.

**Contract**: Config remains functionally identical; at most the doc-comment version string changes. The `ssrPrebundleDeps` `configEnvironment` hook and `optimizeDeps.include` list are unchanged.

### Success Criteria:

#### Automated Verification:

- `pnpm install` completes; lockfile resolves `astro@7.0.6`, `@astrojs/cloudflare@14.x`, `@astrojs/react@6.x`, `vite@8.x`
- `pnpm exec astro sync` completes without error (regenerates `.astro/` types)
- Type gate passes: `pnpm check`
- Production build is clean under Vite 8: `pnpm build`
- Lint passes: `pnpm lint`
- FSD structure gate passes: `pnpm steiger`
- Unit suite passes: `pnpm test`

#### Manual Verification:

- Cross-checked the `@astrojs/cloudflare` v14 and `@astrojs/react` v6 CHANGELOGs against actual usage; confirmed no forced config migration applies (or applied and noted any that did)
- Confirmed React Compiler auto-memoization still active after the `@astrojs/react` bump (Babel `target: "19"` option preserved in `astro.config.mjs`)

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual items before starting Phase 2.

---

## Phase 2: Dev-SSR stability verification

### Overview

Verify the primary risk empirically: that `pnpm dev` under Vite 8's Rolldown optimizer + workerd dev does not reintroduce the React-instance-duplication crash — with the `ssrPrebundleDeps` plugin still in place. Also do a first-pass visual check of the new `compressHTML: 'jsx'` whitespace default.

### Changes Required:

#### 1. Dev-runtime verification protocol (no code change)

**File**: _(verification only — no source edit)_

**Intent**: Establish that the dev loop is healthy under v7 before we touch the workaround. Follow the cold-start protocol in Critical Implementation Details.

**Contract**: Across ≥3 cold starts (`rm -rf node_modules/.vite` each time), first-request loads of `/auth/signin` (island: sign-in form) and a `/plans/:id` board (island: `client:load` planner) render without "Invalid hook call" / null-useState in either the browser console or the dev terminal. HMR and client-side `navigate()` still work.

### Success Criteria:

#### Automated Verification:

- Dev server boots and serves an SSR route on cold start: with `node_modules/.vite` cleared, `pnpm dev` starts and `GET /auth/signin` returns HTTP 200

#### Manual Verification:

- React-dedup cold-start test passes across ≥3 cold starts (WITH the plugin): no "Invalid hook call" / "Cannot read null useState" on first-request SSR of `/auth/signin` and `/plans/:id`
- HMR (edit a React island, see it refresh) and `navigate()`-based client navigation work
- `compressHTML: 'jsx'` first-pass visual check: pages with adjacent inline elements (e.g. sidebar nav labels/badges, sign-in copy) show acceptable spacing — no words run together

**Implementation Note**: Pause for human confirmation of the manual dev-SSR result before starting Phase 3. Do not proceed to removal if any cold start reproduced the crash — instead record that the plugin is required and skip Phase 3's deletion path.

---

## Phase 3: `ssrPrebundleDeps` removal experiment

### Overview

Now that dev SSR is confirmed stable *with* the plugin, test whether Vite 8's optimizer makes it unnecessary. Remove it, re-run the cold-start protocol, and decide from evidence: delete it if the regression stays gone, or restore it (optionally re-tuned) if the crash returns.

### Changes Required:

#### 1. Remove the dev workaround (experimental edit)

**File**: `astro.config.mjs`

**Intent**: Drop the `ssrPrebundleDeps` plugin and its helper so `vite.plugins` is just `[tailwindcss()]`, then test whether the dev-SSR crash returns under Vite 8.

**Contract**: Delete the `ssrPrebundleDeps()` function (`astro.config.mjs:19-32`) and its header comment, and remove it from `vite.plugins` (`astro.config.mjs:49`). This is a reversible probe — the outcome decides whether it stays removed.

#### 2. Decision resolution

**File**: `astro.config.mjs` (final state) + `context/changes/astro-migration-to-v7/research.md` (record outcome)

**Intent**: Encode the evidence-based decision. If the cold-start test stays clean without the plugin, keep it deleted. If the crash returns, restore the plugin (and if a *new* late dep is implicated, extend the `optimizeDeps.include` list per the memory-note recipe rather than reverting blindly).

**Contract**: Final `astro.config.mjs` reflects the decision (plugin absent, or present/re-tuned). The outcome is noted in `research.md`'s open-decision entry so the "why" is captured.

### Success Criteria:

#### Automated Verification:

- Production build still clean whichever way the decision lands: `pnpm build`
- Type gate still clean: `pnpm check`

#### Manual Verification:

- Cold-start test run WITHOUT the plugin across ≥3 cold starts; result recorded (regression returned: yes/no)
- Decision applied and `astro.config.mjs` matches it (deleted if clean; restored/re-tuned if not)
- Outcome documented in `research.md` open-decision entry

**Implementation Note**: Pause for human confirmation of the removal decision before starting Phase 4.

---

## Phase 4: Full gate, doc fix & merge readiness

### Overview

Correct the stale foundation doc, then run the complete doctrine gate — local `/verify`, Playwright E2E against the real workerd build, and a hosted branch-preview smoke — plus the CI pin check, so the change is merge-ready.

### Changes Required:

#### 1. Fix stale React-Compiler doc

**File**: `context/foundation/ui-conventions.md` (~line 232)

**Intent**: The doc claims "There is no React Compiler transform — only the eslint rule"; this is false since commit `8b843e0`. Correct it to state the compiler runs as a real build transform via `@astrojs/react`'s Babel option (`target: "19"`).

**Contract**: The stale sentence at `ui-conventions.md:232` is replaced with an accurate description; no other doc content changes.

#### 2. CI wrangler pin check

**File**: `.github/workflows/ci.yml`

**Intent**: The adapter bump can shift the resolved wrangler; confirm the CI `wranglerVersion:` pin still matches the lockfile and update it only if it drifted.

**Contract**: `wranglerVersion` in the deploy job equals the wrangler version resolved in `pnpm-lock.yaml` (no change expected — wrangler line wasn't bumped — but verify).

### Success Criteria:

#### Automated Verification:

- Full local CI mirror passes via the `/verify` skill: `astro sync` → `check` → `lint` → `steiger` → `pnpm audit --audit-level=high` → `test` → `build`
- Integration suite passes: `pnpm test:integration`
- Playwright E2E passes against the workerd preview build: `pnpm test:e2e`

#### Manual Verification:

- Branch-preview deploy smoke on the hosted Worker: sign in, load the planner board, drag-drop a course with live validation, perform one catalog CRUD op (course/teacher/student), sign out — all functional
- `compressHTML: 'jsx'` spacing re-confirmed on the preview render (no inline-text regressions)
- `ui-conventions.md:232` reads correctly; CI `wranglerVersion` pin verified against the lockfile

**Implementation Note**: After the gate is green and the preview smoke passes, the change is ready to merge (squash onto `main` with a `(#NN)` suffix). Per doctrine, keep this an isolated PR.

---

## Testing Strategy

### Unit Tests:

- Existing `pnpm test` suite must stay green under Astro 7 / Vitest 4 — it exercises the domain cores and the `astro:*` stubs (`test/stubs/*`). A red here after the bump most likely signals `astro:actions` stub drift (not expected per docs).

### Integration Tests:

- `pnpm test:integration` (local Supabase) must pass — exercises the Astro Actions ↔ Supabase path that couples to `astro:env`.

### E2E Tests:

- `pnpm test:e2e` (Playwright) drives `pnpm build && pnpm preview` (the real workerd/adapter output) — the authoritative end-to-end check that the Cloudflare adapter v14 output serves the app correctly.

### Manual Testing Steps:

1. Cold-start React-dedup protocol (Phase 2 & 3): clear `node_modules/.vite`, `pnpm dev`, first-request `/auth/signin` and `/plans/:id`, ≥3 cold starts, watch for "Invalid hook call".
2. `compressHTML: 'jsx'` visual spacing on pages with adjacent inline elements (dev in Phase 2, preview in Phase 4).
3. Branch-preview smoke: auth → planner board → drag-drop with live validation → one CRUD op → sign out.

## Performance Considerations

No runtime performance change is expected — this is a framework version bump, not a logic change. The sub-200ms placement/constraint budget lives in pure domain code (`_pages/plan-detail/model/`) untouched by the upgrade. Vite 8's Rolldown optimizer affects dev-server startup/optimize time only, not the shipped Worker.

## Migration Notes

- No Supabase schema/migration changes — this change is code/deps only.
- No data migration. Rollback is a code revert of the dependency bump + `pnpm install`; nothing persisted changes.
- Keep the PR isolated (no `compatibility_date`/`nodejs_compat` changes) so a bisect cleanly attributes any regression to the version bump.

## References

- Research: `context/changes/astro-migration-to-v7/research.md`
- Upgrade doctrine / risk register: `context/foundation/infrastructure.md:66,85-88`
- Dev React-dedup workaround: `astro.config.mjs:9-32`; memory note `note-astro-vite-react-dedup`
- Official guide: https://docs.astro.build/en/guides/upgrade-to/v7/
- Type-gate rule: `context/foundation/lessons.md:54-59` ("Green build ≠ type-safe" → `pnpm check` after `astro sync`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bump versions & build/type integrity

#### Automated

- [x] 1.1 `pnpm install` completes; lockfile resolves astro@7.0.6, @astrojs/cloudflare@14.x, @astrojs/react@6.x, vite@8.x — 09bbcad
- [x] 1.2 `pnpm exec astro sync` completes without error — 09bbcad
- [x] 1.3 Type gate passes: `pnpm check` — 09bbcad
- [x] 1.4 Production build clean under Vite 8: `pnpm build` — 09bbcad
- [x] 1.5 Lint passes: `pnpm lint` — 09bbcad
- [x] 1.6 FSD structure gate passes: `pnpm steiger` — 09bbcad
- [x] 1.7 Unit suite passes: `pnpm test` — 09bbcad

#### Manual

- [x] 1.8 Cross-checked adapter v14 / react v6 CHANGELOGs vs usage; confirmed no forced config migration (or applied it) — 09bbcad
- [x] 1.9 Confirmed React Compiler auto-memoization still active (Babel `target: "19"` preserved) — 09bbcad

### Phase 2: Dev-SSR stability verification

#### Automated

- [x] 2.1 Cold-start dev boots and serves `GET /auth/signin` → HTTP 200 (with `node_modules/.vite` cleared) — c274824

#### Manual

- [x] 2.2 React-dedup cold-start test passes across ≥3 cold starts WITH the plugin (no "Invalid hook call" on `/auth/signin` and `/plans/:id`) — c274824
- [x] 2.3 HMR and `navigate()` client navigation work — c274824
- [x] 2.4 `compressHTML: 'jsx'` first-pass visual spacing acceptable on pages with adjacent inline elements — c274824

### Phase 3: `ssrPrebundleDeps` removal experiment

#### Automated

- [x] 3.1 Production build still clean whichever way the decision lands: `pnpm build`
- [x] 3.2 Type gate still clean: `pnpm check`

#### Manual

- [x] 3.3 Cold-start test run WITHOUT the plugin (≥3 cold starts); regression result recorded — regression RETURNED (reloads=3, crashes=23 on /plans/:id, all 3 cold starts)
- [x] 3.4 Decision applied — `astro.config.mjs` matches it (deleted if clean; restored/re-tuned if not) — restored + re-tuned (astro runtime modules added), landed in c274824
- [x] 3.5 Outcome documented in `research.md` open-decision entry

### Phase 4: Full gate, doc fix & merge readiness

#### Automated

- [ ] 4.1 Full `/verify` gate passes (astro sync → check → lint → steiger → audit → test → build)
- [ ] 4.2 Integration suite passes: `pnpm test:integration`
- [ ] 4.3 Playwright E2E passes against workerd preview: `pnpm test:e2e`

#### Manual

- [ ] 4.4 Branch-preview deploy smoke: auth → planner board → drag-drop with live validation → one CRUD op → sign out
- [ ] 4.5 `compressHTML: 'jsx'` spacing re-confirmed on preview render
- [ ] 4.6 `ui-conventions.md:232` corrected; CI `wranglerVersion` pin verified against lockfile
