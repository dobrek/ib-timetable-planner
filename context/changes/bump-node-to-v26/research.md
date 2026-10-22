---
date: 2026-10-22T16:32:53+0200
researcher: Claude (Opus 5.5) with Dobromir Kropielnicki
git_commit: 4978c99d9b3bf05d20baa23ac1a7b09907e8b351
branch: main
repository: dobrek/ib-timetable-planner
topic: "Feasibility of bumping Node (local + CI) from 24.15.0 to the latest release, 26.12.1"
tags: [research, toolchain, node, ci, vitest, jsdom, mise, bump-node-to-v26]
status: complete
last_updated: 2026-10-22
last_updated_by: Claude (Opus 5.5)
---

# Research: Feasibility of bumping Node (local + CI) to 26.12.1

**Date**: 2026-10-22T16:32:53+0200
**Researcher**: Claude (Opus 5.5) with Dobromir Kropielnicki
**Git Commit**: [`4978c99`](https://github.com/dobrek/ib-timetable-planner/commit/4978c99d9b3bf05d20baa23ac1a7b09907e8b351)
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Is it feasible to bump our Node-related services, locally and on CI, to the latest version of Node?

Scope decisions (from the user, 2026-10-22):
- **Target:** pin Node **26.12.1** now. Node 26 is still "Current" and becomes LTS on 2026-10-28.
- **Depth:** a full empirical trial, covering install, the verify gate, the integration lane and the E2E lane, all under Node 26.

## Summary

**Feasible, and low-risk. The whole CI surface passed under Node 26.12.1 on an unmodified checkout.**

There is one real compatibility problem: **Vitest 4 + jsdom lose `window.localStorage` on Node ≥25**. It is latent today, because no jsdom test touches `localStorage`. It has a one-line fix, and that fix was verified to work on **both** Node 24 and Node 26.

The minimum change set:

1. Change [`.node-version`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/.node-version#L1) from `24.15.0` to `26.12.1`. This is the **only** normative pin. CI's setup-node reads it; nothing else pins Node.
2. Add `execArgv: ["--no-experimental-webstorage"]` to the `dom` project in [`vitest.config.ts:36-41`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/vitest.config.ts#L36-L41).
3. Update the docs that state the version (list below).

Bumping is also overdue for two reasons:

- **The current pin misses three Node 24 security releases:** 24.17.0, 24.18.1 and 24.22.1.
- **It already falls outside a dependency's declared `engines`:** `eslint-plugin-astro@3.1.0` and `astro-eslint-parser@3.0.0` require `^22.22.3 || ^24.16.0 || >=26.3.0`. pnpm doesn't enforce `engines` by default, so this has gone unnoticed.

Node 24 itself moved to Maintenance LTS on 2026-10-20.

### Empirical trial: everything under Node v26.12.1

The trial ran in a throwaway `git worktree` at `4978c99`, with `.node-version` set to `26.12.1` and Node 26 first on `PATH`. It used the local Supabase stack plus the native CP-SAT solver, started with `SOLVER_MAX_CONCURRENT_JOBS=2` as CI does.

| CI step (in `ci.yml` order) | Result on 26.12.1 | Notes |
|---|---|---|
| `pnpm install --frozen-lockfile` (pnpm 12.9.1) | ✅ 6.5 s | No engine warnings. Lockfile unchanged. Lockfile supply-chain policy passed. |
| `pnpm astro sync` | ✅ | `DEP0205` deprecation warning (see below) |
| `pnpm check` (astro check) | ✅ 0 errors / 0 warnings | 905 files |
| `pnpm lint` | ✅ | |
| `pnpm steiger` | ✅ | |
| `pnpm audit --audit-level=high` | ✅ | 1 already-ignored high (braces, `pnpm-workspace.yaml`) |
| `pnpm test` (unit + dom) | ✅ 228 files / 2211 tests | One `ExperimentalWarning: localStorage is not available…` (see below) |
| `pnpm build` (+ `postbuild` assert) | ✅ | `assert-server-only-supabase`: 42 client files clean |
| `node scripts/provision-solver-user.mjs` | ✅ | Run as in `ci.yml:129`/`:222`, using a dedicated trial machine user that was deleted afterwards |
| `pnpm test:integration --maxWorkers=2` (with `SOLVER_URL`) | ✅ 39 files / 300 tests | Both solver suites dispatched real jobs (3 `POST /jobs`) |
| `pnpm test:e2e` (build → preview on workerd → Playwright 1.61 chromium) | ✅ 48 passed | `generation.spec.ts` drove a real solve (4th `POST /jobs`). `pretest:e2e` provisioning ran on 26. |
| supabase-stack action's `node -p "require(...)"` CLI-version check | ✅ | 2.117.0 = 2.117.0 |
| `wrangler deploy --dry-run --containers-rollout=none` | ✅ | Bundles 85 modules / 4.1 MiB. Exercises the deploy job's wrangler-on-PATH-Node path, without publishing. |
| `pnpm db:types` | ✅ | Zero diff against the committed `database.types.ts` |
| `pnpm test` again, with the `execArgv` fix, on **24.19.0 and 26.12.1** | ✅ 2212 / 2212 on both | Includes a storage probe test. jsdom storage restored on 26, and the warning is gone. |

**Not exercised:**

- **A real GitHub `ubuntu-latest` runner.** The trial ran on macOS arm64.
- **The tier-3 container path** (`mise run solver:tier3`, which is `wrangler dev --enable-containers` and needs Docker).
- **A real `wrangler deploy`.**
- **The live campaign runner.** It was only loaded via `bench/campaign/main.test.ts`, which passed and asserts `stderr === ""` under bare Node.

The bump PR's own CI run is what closes the first gap.

## Detailed Findings

### 1. Release landscape (verified directly, 2026-10-22)

Sources: `https://nodejs.org/dist/index.json` and `nodejs/Release` `schedule.json`.

| Line | Latest | Status |
|---|---|---|
| **26** | **26.12.1** (2026-10-21, security release; V8 14.6, npm 11.20.0) | Current since 2026-05-05 → **Active LTS 2026-10-28** → maintenance 2027-10-20 → EOL 2029-04-30 |
| 25 | 25.9.0 | EOL 2026-06-01 |
| 24 | 24.22.1 (2026-10-20, security release) | **Maintenance LTS since 2026-10-20** → EOL 2028-04-30 |
| 27 | — | The project moved to annual majors: 27 enters **alpha** 2026-10-28 and is released 2027-04-22. So 26 is "the latest" for the next six months. |

The repo pin, 24.15.0, was released 2026-04-15. These security releases came after it and are missing: **24.17.0** (06-17), **24.18.1** (07-28) and **24.22.1** (10-20).

### 2. Where Node is pinned and how it is consumed

**The single normative pin**

- [`.node-version:1`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/.node-version#L1) holds `24.15.0`, with no trailing newline.
- Created in `ed02fd0` (2026-05-21) and unchanged since.

**Not a pin**

- `package.json` has no `engines` field and no direct `@types/node`. [`package.json:100`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/package.json#L100) is only `packageManager: pnpm@12.9.1`.
- No Node pin in `pnpm-workspace.yaml`, `mise.toml` (whose `[tools]` hold only `uv` and `shellcheck`), `tsconfig.json`, any vitest/playwright/astro config, or `lefthook.yml`.
- `services/solver/Dockerfile` is `python:3.13-slim`. **No image contains Node.**
- The production runtime is workerd. [`wrangler.jsonc:10-11`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/wrangler.jsonc#L10-L11) (`compatibility_date`, `nodejs_compat`) are a workerd concern and are independent of the local Node. **Production behaviour does not change.**

**CI**

- [`.github/actions/setup/action.yml:17-20`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/.github/actions/setup/action.yml#L17-L20) runs `actions/setup-node@v7.0.0` with `node-version-file: .node-version`, after `pnpm/action-setup@v6.1.0` (`:13`).
- The `verify`, `integration`, `e2e` and `deploy` jobs all go through it. The `solver` job never runs Node.
- Direct `node` invocations, all of which passed under 26:
  - [`ci.yml:129`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/.github/workflows/ci.yml#L129) and [`:222`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/.github/workflows/ci.yml#L222): `provision-solver-user.mjs`
  - [`supabase-stack/action.yml:26`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/.github/actions/supabase-stack/action.yml#L26): the `node -p` CLI-version check
  - [`:37`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/.github/actions/supabase-stack/action.yml#L37): `gen-seed.mjs`, which ran under 26 via `seed-transcode-identity.test.ts`
- Third-party actions (checkout, setup-node, pnpm/action-setup, setup-uv, upload-artifact, wrangler-action) run on their **own** bundled `node24` action runtime, regardless of `.node-version`.
- [`ci.yml:387`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/.github/workflows/ci.yml#L387) ("node24 JS action") describes that runtime. It is **not** a reference to the repo's Node: leave it.
- `cloudflare/wrangler-action@v4.1.3` ([`ci.yml:424-429`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/.github/workflows/ci.yml#L424-L429), `wranglerVersion: "4.130.0"`) runs Wrangler on the Node found on `PATH`, which is the `.node-version` one. The dry-run deploy above covers that path.
- **No CI file needs editing.**

**Locally: the pin is not honoured today**

- mise 2026.6.14 has `idiomatic_version_file_enable_tools = []`, so it **ignores `.node-version`**.
- The user-global `~/.config/mise/config.toml` sets `node = "lts"`, so the active Node is **24.19.0**, not 24.15.0.
- Once 26 becomes LTS on 2026-10-28, `lts` will move developers to Node 26 by itself, whether or not the repo bumps. The jsdom storage fix therefore matters even if the pin stays.
- [`context/foundation/tech-stack.md:67-68`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/context/foundation/tech-stack.md#L67-L68) claims "mise provides toolchain pins (node/python/uv)". That is **already false**: `mise.toml` pins no node.
- `pnpm` resolves through mise's `npm:pnpm`, a Node script that hands off to the `packageManager` pnpm 12.9.1, a native executable. **Corepack is not involved anywhere.** Node 25 stopped bundling corepack, and the repo has no references to it.

### 3. The one real incompatibility: Web Storage vs jsdom under Vitest 4

**Mechanism**

- Node 25 turned the Web Storage API on by default.
- On Node 26, the global `localStorage` returns `undefined` unless `--localstorage-file` is given, and the first access logs `ExperimentalWarning: localStorage is not available…`.
- Vitest 4's jsdom environment copies window keys onto the global and drops the storage keys on Node ≥25. Upstream issue [vitest-dev/vitest#10867](https://github.com/vitest-dev/vitest/issues/10867) ("jsdom: localStorage/sessionStorage dropped by getWindowKeys on Node 25+") is **closed as not planned** for 4.x. The fix ships in Vitest 5.

**Verified with a probe test in the `dom` project:**

| Node | `NODE_OPTIONS` | `window.localStorage` | `window.sessionStorage` |
|---|---|---|---|
| 24.19.0 | none | Storage, round-trips | Storage, round-trips |
| 26.12.1 | none | **`undefined`** | Storage, round-trips |
| 26.12.1 | `--no-webstorage` | Storage, round-trips | Storage, round-trips |
| 24.19.0 | `--no-webstorage` | — **node exits 9: `--no-webstorage is not allowed in NODE_OPTIONS` / `bad option`** | — |
| 24.19.0 and 26.12.1 | `--no-experimental-webstorage` | Storage, round-trips | Storage, round-trips |

**Impact today: latent.** `pnpm test` is fully green on 26.

- No `*.test.tsx` touches `localStorage`.
- [`use-lens.test.tsx:19-30`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/src/_pages/plan-detail/ui/lens/use-lens.test.tsx#L19-L30) uses `sessionStorage`, which still works.
- `board-zoom.test.ts` and `lens-session.test.ts` are node-env tests that stub `window` themselves.
- The first jsdom test of a `localStorage` helper would fail on 26. The helpers would not crash, though: per the lessons rule they are try/catch-guarded, so they would silently fall back to defaults.

**Fix, verified:** add `execArgv: ["--no-experimental-webstorage"]` to the `dom` project ([`vitest.config.ts:36-41`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/vitest.config.ts#L36-L41)). Vitest 4.1.12 types declare `execArgv?: string[]` on the test config.

- With it, the full suite passed **2212/2212 on both 24.19.0 and 26.12.1**, with zero `ExperimentalWarning`s.
- **Use the `--no-experimental-webstorage` spelling, not `--no-webstorage`.**
  - Node 24 rejects `--no-webstorage`. Node 26's `--help` lists `--no-experimental-webstorage` as an alias of `--webstorage`, and neither version prints a warning for it.
  - This keeps the config valid for a developer whose mise still resolves Node 24.
- When the repo moves to Vitest 5, re-check whether the flag is still needed.

### 4. Warnings and noise (non-blocking)

**`DEP0205: module.register() is deprecated`**

- Printed by every `astro` command (`sync`/`check`/`build`/`dev`).
- Traced to `@tailwindcss/node@4.3.0` (`dist/index.mjs:18`), which `@tailwindcss/vite` loads through `astro.config.mjs:72`.
- From `@tailwindcss/node@4.3.1` on, it prefers `module.registerHooks` when available. Latest is 4.3.3 (2026-10-19).
- `package.json:45,60` (`^4.3.0`) already admit it, so a lockfile refresh of `tailwindcss` + `@tailwindcss/vite` removes the warning.
- It is a runtime deprecation only. It could become a removal in a later Node major.

**`ExperimentalWarning: localStorage is not available…`**

- Emitted when `@supabase/auth-js`'s `supportsLocalStorage()` probe (`lib/helpers.js:66`, evaluated when `locks.js` loads) runs in the jsdom lane.
- Harmless, and it disappears with the `execArgv` fix above.

**Not a warning**

- The Node 26 runs printed nothing under `bench/campaign/main.ts`'s bare-Node launch. [`bench/campaign/main.test.ts:17-25`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/bench/campaign/main.test.ts#L17-L25) asserts `stderr === ""` and passed, so native type stripping behaves the same on 26.

### 5. Toolchain compatibility (static, verified in `node_modules`)

**Declared `engines`**

- All 510 packages that declare `engines.node`, out of 936 installed, accept 26.12.1. Key ranges:
  - astro `>=22.12.0`
  - vite / rolldown `^20.19.0 || >=22.12.0`
  - vitest `^20 || ^22 || >=24`
  - eslint / jsdom `… || >=24`
  - wrangler / miniflare `>=22.0.0`
  - playwright `>=18`
  - sharp `>=20.9.0`
  - undici `>=22.19.0`
- pnpm's `engineStrict` defaults to false, and the repo sets neither `.npmrc` nor `engineStrict`, so engine mismatches only warn.

**Native code: nothing is ABI-bound**

- Node 26 is `NODE_MODULE_VERSION` 147 (Node 24 is 137). That doesn't matter here: there are no `node-gyp` addons.
- napi-rs / N-API, which is ABI-independent: rolldown, `@astrojs/compiler-binding`, `@tailwindcss/oxide`, lightningcss, sharp, fsevents.
- Standalone executables: esbuild, workerd, lefthook, the Supabase CLI, pnpm 12.

**`@types/node`** resolves transitively to 24.12.4: `sitemap@9.0.1` pins `^24.9.2`, and `@types/pg` pulls it into `tsc`. No repo code uses a 25/26-only API, so no bump is needed.

**Removed or changed APIs in Node 25/26**

- Covers `SlowBuffer`, `fs.F_OK…`, `rmdir recursive`, `assert.CallTracker`, `_stream_*`, `http.writeHeader`, `--experimental-transform-types`, `url.parse` and corepack.
- None are used by `scripts/`, `bench/`, `src/test/`, `e2e/` or the configs (grep).

**Upstream support statements**

- Astro 7: even-numbered Node, at least 22.
- Playwright: "latest 22.x, 24.x or 26.x".
- Wrangler: Current, Active and Maintenance lines.
- pnpm 12: ✔ Node 26.
- Vitest: "non-LTS not officially supported". That stops applying on 2026-10-28.

### 6. Pre-existing issue found during the trial (not caused by the bump)

`astro dev` (port 4322) did **not** boot in the clean worktree. The workerd module runner fails with `require is not defined` (`workers/runner-worker/index.js:107`).

- **It fails identically on Node 24.19.0 and 26.12.1**, with a cleared Vite cache, so it is not a Node 26 regression.
- The main checkout's last `.astro/dev.log` shows different dev-SSR optimize-deps errors, from the astro 7.2.0 era.
- This was **not** re-checked in the main checkout at HEAD.
- It fits the existing preference for `pnpm build && pnpm preview`, and should be a separate change if pursued.

## Code References

**Must edit**

- `.node-version:1`: `24.15.0` → `26.12.1`. The only normative pin.
- `vitest.config.ts:36-41`: the `dom` project. Add `execArgv: ["--no-experimental-webstorage"]`.

**Prose stating the version**

- `CLAUDE.md:3`: "Node **24.15.0**"
- `README.md:16`: "Node.js 24.15.0"
- `context/foundation/health-check.md:51`: "Node is pinned by `.node-version` (24.15.0)"
- `bench/campaign/definition.ts:13`: "Node 24's native type stripping". The prose names the major.
- `context/foundation/tech-stack.md:67-68`: claims mise pins node. Already false, so fix it or make it true.
- `context/deployment/deploy-plan.md:7,15`: historical checklist (also stale on pnpm 11.9.0). Optional.

**Optional**

- `package.json:45,60`: refresh `@tailwindcss/vite` / `tailwindcss` to ≥4.3.1 to drop `DEP0205`.
- `package.json` (no `engines` today): optionally add `engines.node`. It is advisory only unless `engineStrict` is set.

**Do not touch**

- `.github/actions/setup/action.yml:17-20`: no change needed. It reads `.node-version`.
- `.github/workflows/ci.yml:387`: "node24 JS action" is wrangler-action's own runtime.
- `wrangler.jsonc:10-11`: a workerd concern, unaffected.

**Tests that act as the Node-sensitivity canaries**

- `bench/campaign/main.test.ts:17-25`: bare-Node launch, `stderr === ""`.
- `src/test/seed-transcode-identity.test.ts:20`: `execFileSync("node", …)`, which uses the Node on `PATH`.

## Architecture Insights

- **Node is tooling-only here.** Production runs on workerd and the solver image is Python, so a Node bump changes only dev, test, build and the CLIs. It can't change production behaviour. The deploy job's Wrangler does run on the bumped Node, and the dry-run shows bundling is unaffected.
- **One pin, consumed in one place.** `.node-version` → `actions/setup-node`'s `node-version-file`. Nobody watches that file, though: Dependabot covers only `github-actions` ([`.github/dependabot.yml:10-23`](https://github.com/dobrek/ib-timetable-planner/blob/4978c99d9b3bf05d20baa23ac1a7b09907e8b351/.github/dependabot.yml#L10-L23)), which is how the pin drifted three security releases behind.
- **Local ≠ CI today.** CI honours `.node-version`; local mise ignores it and follows the user's global `lts`. A Node-version bug can therefore reach CI without ever showing locally, and the reverse. Teaching mise to read `.node-version`, or pinning node in `mise.toml`, would close this. That decision belongs in the plan.

## Historical Context (from prior changes)

- `ed02fd0` (2026-05-21) created `.node-version` at 24.15.0.
- `24504ea` (2026-05-24, `fix(ci): node version file`) switched setup-node from `node-version:` to `node-version-file:` and moved CLAUDE.md from 22.14.0 to 24.15.0. That is the only earlier Node "bump".
- `context/archive/2026-07-03-astro-migration-to-v7/plan.md`: the Astro v7 migration explicitly kept Node unchanged.
- `context/archive/2026-06-18-ci-piepline-cleanup/research.md` (~:256-285): moved third-party actions off the node20 action runtime. That concerned action runtimes, not the repo's Node.
- `context/archive/2026-07-16-post-poc-cp-sat-refactoring-plan/research.md:~460` proposed pinning node 24.15.0 in mise. It never landed: the mise setup in `59f2863` (2026-08-11) pinned only `uv`.
- `context/archive/2026-09-29-automate-production-calibration-campaign/` relies on native type stripping. Its impl review asked whether CI's Node matches, which led to `bench/campaign/main.test.ts` (`678ad1c`, 2026-10-02).
- `context/archive/2026-10-09-security-workflow-issues/plan.md:82`: Dependabot's npm/pnpm coverage was deferred by decision, so nothing auto-proposes Node or npm bumps.

## Related Research

- `context/archive/2026-06-18-ci-piepline-cleanup/research.md`: CI action runtimes (node20 → node24 actions).
- `context/archive/2026-07-16-post-poc-cp-sat-refactoring-plan/research.md`: the unrealised proposal to pin Node in mise.

## Open Questions

1. **26.12.1 now, or the first LTS-tagged 26.x on/after 2026-10-28?** The user chose 26.12.1 now. Moving to the LTS release a week later is a patch-level bump to `.node-version`. Vitest's "non-LTS not officially supported" caveat expires on the same date.
2. **Local parity.** Choose one, and fix `tech-stack.md:67-68` either way:
   - Make mise read `.node-version`, e.g. `[settings] idiomatic_version_file_enable_tools = ["node"]` in `mise.toml`. This keeps a single source of truth. Verify the setting against current mise docs before writing it.
   - Pin `node` in `mise.toml [tools]`. This creates a second literal to keep in lockstep.
   - Leave local to the developer's global `lts`, which reaches 26 on 10-28 anyway.
3. **Tailwind refresh in the same change?** Refreshing to ≥4.3.1 removes the `DEP0205` noise. Check the lockfile's `minimumReleaseAge` policy against 4.3.3's 2026-10-19 publish date.
4. **`engines.node` in `package.json`?** It would document intent, but stays advisory unless `engineStrict` is turned on. Turning it on would hard-fail any developer whose mise `lts` lags.
5. **Linux CI runner confirmation.** The trial ran on macOS arm64. The bump PR's own CI run on `ubuntu-latest` is the remaining proof, and it costs nothing extra.
6. **`astro dev` boot failure** (`require is not defined`, identical on 24 and 26 in a clean worktree). It's unrelated to this change, but worth its own investigation if the dev loop matters.

## Trial hygiene (what the trial touched outside the worktree)

- **Shared git hooks:** the worktree's lefthook `postinstall` re-pointed `.git/hooks/pre-commit` and `pre-push` at the worktree's lefthook binary. They were restored byte-for-byte from a snapshot and re-verified after the worktree was removed.
- **Local Supabase:** a dedicated machine user, `solver-node26-trial@ib-timetable-planner.dev`, was created for the native solver and deleted afterwards. The default `solver@…` user and its password were not touched. Integration and E2E suites tear down their own data.
- **Cleanup:** the solver process was stopped, the preview stopped, and the worktree removed and pruned. `git status` on main shows only this change folder.
