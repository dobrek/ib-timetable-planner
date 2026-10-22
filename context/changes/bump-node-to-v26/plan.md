# Bump Node to v26 Implementation Plan

## Overview

Move the repository's Node toolchain from 24.15.0 to **26.12.1**, locally and on CI. Doing that safely takes three more things:

- restore Web Storage in the jsdom test lane, which Vitest 4 loses on Node ≥25, and guard it with a canary;
- make local mise honour the same pin CI already reads;
- remove the `DEP0205` deprecation noise that Node 26 brings out of Tailwind.

Node is tooling-only here. Production runs on workerd and the solver image is Python, so production behaviour cannot change.

## Current State Analysis

The research (`context/changes/bump-node-to-v26/research.md`) ran the whole CI surface under 26.12.1 on an unmodified checkout, and all of it passed: install, verify gate, integration, E2E and a wrangler dry-run. So this plan only needs to apply the fixes and close the gaps. The relevant facts:

- **One normative pin.** `.node-version:1` holds `24.15.0`, with no trailing newline. `actions/setup-node` reads it through `node-version-file` (`.github/actions/setup/action.yml:17-20`), and that serves the `verify`, `integration`, `e2e` and `deploy` jobs. Nothing else pins Node: no `engines`, no mise tool entry, no Node in any image.
- **The pin has drifted.** It misses three Node 24 security releases (24.17.0, 24.18.1, 24.22.1). It also already falls outside `eslint-plugin-astro@3.1.0` / `astro-eslint-parser@3.0.0` `engines`, which require `^24.16.0 || >=26.3.0`.
- **Local doesn't honour the pin.** mise 2026.6.14 has `idiomatic_version_file_enable_tools = []`, so the global `node = "lts"` wins and the active Node is 24.19.0. `context/foundation/tech-stack.md:67-68` says "mise provides toolchain pins (node/python/uv)". That is false: `mise.toml [tools]` holds only `uv` and `shellcheck`.
- **The jsdom storage problem is real but hidden.** On Node 26, Vitest 4's jsdom environment drops `window.localStorage` (vitest-dev/vitest#10867, closed as not planned for 4.x). `sessionStorage` survives. No `*.test.tsx` touches `localStorage` today, so the suite is green while the first such test would fail. The fix was verified on both 24.19.0 and 26.12.1: `--no-experimental-webstorage` in the `dom` project's `execArgv`.
- **Tailwind triggers `DEP0205`.** On Node 26, every `astro` command prints `DEP0205: module.register() is deprecated`. The source is `@tailwindcss/node@4.3.0`. From 4.3.1 on, Tailwind prefers `module.registerHooks`. The lockfile resolves `tailwindcss` / `@tailwindcss/{vite,node,oxide}` at 4.3.0, and `package.json:45,60` declare `^4.3.0`. The latest is 4.3.3, published 2026-07-16. The research's "2026-10-19" is the registry's `modified` timestamp, not the publish date.

## Desired End State

- `.node-version` reads `26.12.1`.
- In the repo root, `mise current node` → `26.12.1` and `node --version` → `v26.12.1`, whatever the developer's global mise config says.
- The `dom` Vitest project runs with Web Storage restored. `src/test/dom-lane.test.tsx` asserts `localStorage` and `sessionStorage` work. That case goes red when the flag is removed, on Node 26.
- `pnpm test` prints no `ExperimentalWarning: localStorage is not available…`. No `astro` command prints `DEP0205`.
- Every doc that states the Node version or the mise pin is true again.
- The bump PR's CI is green on `ubuntu-latest`, which closes the research's Linux gap.

### Key Discoveries:

- **The only pin:** `.node-version:1`. **The only consumer:** `.github/actions/setup/action.yml:17-20`. **No CI file needs editing.**
- **`ci.yml:387`** says "node24 JS action". That is wrangler-action's own runtime, not the repo's Node. Leave it.
- **The `dom` project to edit** is at `vitest.config.ts:31-42`. Vitest 4.1.12 types declare `execArgv?: string[]`.
- **The canary's home is `src/test/dom-lane.test.tsx`.** It is already the lane-infra smoke test: "A failure here points at lane infra … not at any feature test". It already renders JSX, so the `.tsx`-only-for-JSX convention holds.
- **mise behaviour, verified empirically on 2026-10-22.** In a probe directory, a project `mise.toml` with `[settings] idiomatic_version_file_enable_tools = ["node"]` made `.node-version` = 26.12.1 win over the global `lts`, which resolves to 24.19.0. Without the setting, mise reported 24.19.0. Context7 `/jdx/mise` confirms that a project config wins over the global config.
- **Lines that state the version:**
  - `CLAUDE.md:3`
  - `README.md:16`
  - `context/foundation/health-check.md:51`
  - `bench/campaign/definition.ts:13`: "Node 24's native type stripping"
  - `context/foundation/tech-stack.md:67-68`: the false mise claim
- **Node-sensitive canaries that must stay green:** `bench/campaign/main.test.ts:17-25` (bare-Node launch, `stderr === ""`) and `src/test/seed-transcode-identity.test.ts:20` (`execFileSync("node", …)`).

## What We're NOT Doing

- **Waiting for the first LTS-tagged 26.x (due 2026-10-28).** You chose 26.12.1 now. Moving to the LTS release later is a patch-level edit of `.node-version`.
- **Adding `engines.node` or `engineStrict`.** You decided against it. Once node is enabled, mise reads `package.json` too, so an `engines` range would be a second source of the version.
- **Pinning `node` in `mise.toml [tools]`.** It would be a second literal to keep in lockstep with `.node-version`.
- **Enabling mise idiomatic files for `python`.** uv owns `services/solver/.python-version`. `mise.toml`'s own comment says a second interpreter source must not exist.
- **Dependabot or Renovate watching `.node-version`.** npm/pnpm Dependabot coverage was deferred by decision (`context/archive/2026-10-09-security-workflow-issues/plan.md:82`).
- **Vitest 5 or any other dependency bump** beyond the four Tailwind packages. `@types/node` stays at 24.12.4 (transitive, and no 25/26-only API is used).
- **Editing CI workflows or composite actions.**
- **Investigating the `astro dev` boot failure** (`require is not defined`). It fails identically on 24 and 26, so it is pre-existing and belongs in its own change.
- **Rewriting `context/deployment/deploy-plan.md:7,15`.** It is a completed historical checklist, already stale on pnpm too.
- **Verifying tier 3 or a real deploy beyond the normal merge.** No container, Dockerfile or wrangler config changes.

## Implementation Approach

The work is two commits, in order:

- **Phase 1** lands the whole Node move as one coherent unit: pin, test-environment fix, canary, mise parity and docs. The `execArgv` flag is valid on both 24 and 26, so its order relative to the pin doesn't matter, and one commit keeps the change atomic.
- **Phase 2** is the Tailwind patch refresh. It gets its own commit because it brings a CSS-generator patch with it, and that should be revertible without undoing the Node bump.

## Critical Implementation Details

**Flag spelling.** Use `--no-experimental-webstorage`, not `--no-webstorage`:

- Node 24 rejects `--no-webstorage` and exits with code 9.
- Node 26 lists `--no-experimental-webstorage` as an alias, and neither version warns about it.

That keeps the config valid for anyone not running through mise. The config comment should cite vitest-dev/vitest#10867 and say the flag needs re-checking when the repo moves to Vitest 5.

**Phase 2 lockfile scope.** Update only the two direct Tailwind dependencies, by name. Don't run a plain `pnpm update`. `supabase` must stay at `2.117.0`: its resolved version selects CI's Supabase images (CLAUDE.md, "Database & auth"). The expected lockfile diff touches only `tailwindcss`, `@tailwindcss/vite`, `@tailwindcss/node` and `@tailwindcss/oxide` (with its platform binaries).

## Phase 1: Node 26 pin, jsdom storage fix and local parity

### Overview

Pin 26.12.1, make mise resolve it locally, restore and guard jsdom Web Storage, and correct every doc that states the version.

### Changes Required:

#### 1. The pin

**File**: `.node-version`

**Intent**: Move the single normative pin to 26.12.1. CI picks it up through `setup-node`'s `node-version-file`.

**Contract**: The file content becomes exactly `26.12.1`. Keep the current form, with no trailing newline.

#### 2. Local parity

**File**: `mise.toml`

**Intent**: Make mise read `.node-version` for `node`, so local resolves the same version CI does, without a second literal.

**Contract**: Add a `[settings]` table with `idiomatic_version_file_enable_tools = ["node"]`. Give it a comment in the file's existing style, covering three points:

- `.node-version` is the single source, and CI reads it via `setup-node`;
- `node` must never be added to `[tools]`, because that would be a second literal;
- `python` is deliberately not listed, because uv owns `.python-version`.

#### 3. jsdom Web Storage fix

**File**: `vitest.config.ts`

**Intent**: Restore `window.localStorage` in the `dom` project under Node ≥25, where Vitest 4's jsdom environment drops it.

**Contract**: The `dom` project's `test` gains `execArgv: ["--no-experimental-webstorage"]`. Next to it, a short comment states the mechanism, links the upstream issue, explains the spelling choice (Node 24 compatibility) and says to re-check on Vitest 5. The `unit` project is unchanged.

#### 4. Storage canary

**File**: `src/test/dom-lane.test.tsx`

**Intent**: Make the lane-infra smoke test fail when jsdom Web Storage is missing. Then dropping the flag, or a Vitest behaviour change, goes red at once instead of surfacing later as a mysterious failure in a feature test.

**Contract**:

- Add a second case to the existing `describe("dom test lane")`. It asserts that both `window.localStorage` and `window.sessionStorage` are present and round-trip a value.
- It leaves no keys behind: clean up within the test or in an `afterEach`.
- Keep the file-header comment true: it describes what the lane proves, so it should now mention storage.

#### 5. Docs that state the version

**Files**:
- `CLAUDE.md:3`
- `README.md:16`
- `context/foundation/health-check.md:51`
- `context/foundation/tech-stack.md:67-68`
- `bench/campaign/definition.ts:13`

**Intent**: Make every statement of the Node version, or of how it's pinned, true again.

**Contract**:

- `CLAUDE.md:3` and `README.md:16`: `24.15.0` → `26.12.1`. The README Prerequisites line may also say that mise reads `.node-version`.
- `health-check.md:51`: the pinned version → `26.12.1`.
- `tech-stack.md:67-68`: make the claim accurate. mise pins `uv` and `shellcheck` and reads `.node-version` for node. Python is pinned by `.python-version`, which uv reads.
- `bench/campaign/definition.ts:13`: "Node 24's native type stripping" → "Node's native type stripping". Drop the major so the comment doesn't go stale at the next bump.

### Success Criteria:

#### Automated Verification:

- [x] In the repo root, `mise current node` prints `26.12.1`, `node --version` prints `v26.12.1` and `pnpm --version` prints `12.9.1`. If mise reports it missing, run `mise install` first.
- [x] `pnpm install --frozen-lockfile` succeeds with no engine warnings, and `git diff --exit-code pnpm-lock.yaml` is clean.
- [x] `pnpm test src/test/dom-lane.test.tsx` passes on Node 26.12.1.
- [x] Deliberate break: with the `execArgv` line temporarily removed, the storage canary fails on Node 26.12.1. Restore the line afterwards.
- [x] The canary also passes on Node 24, which proves the flag spelling is valid there: `mise exec node@24.19.0 -- pnpm test src/test/dom-lane.test.tsx`.
- [x] The full `pnpm test` passes, and its output contains no `ExperimentalWarning: localStorage is not available`. This includes `bench/campaign/main.test.ts` and `seed-transcode-identity.test.ts`.
- [x] `/verify` is green on Node 26.12.1 (install, astro sync, check, lint, steiger, audit, test, build).
- [x] No stale version literal remains: `git grep -n '24\.15' -- ':!context/archive' ':!context/deployment' ':!context/changes' ':!pnpm-lock.yaml'` returns nothing.

#### Manual Verification:

- [ ] `pnpm build && pnpm preview` on Node 26: sign in and open a plan board. It renders and accepts a drag-drop. Restart the preview after the build; see the memory note on preview daemonizing.

**Implementation Note**: After all automated verification passes, pause for your confirmation of the manual smoke before Phase 2.

---

## Phase 2: Tailwind patch refresh (drop `DEP0205`)

### Overview

Refresh the Tailwind packages from 4.3.0 to 4.3.3. Node 26 deprecates `module.register()`, and `@tailwindcss/node` ≥4.3.1 prefers `module.registerHooks`, so this removes the `DEP0205` warning from every `astro` command.

### Changes Required:

#### 1. Tailwind dependency refresh

**Files**: `package.json`, `pnpm-lock.yaml`

**Intent**: Resolve `tailwindcss`, `@tailwindcss/vite` and their transitive `@tailwindcss/node` / `@tailwindcss/oxide` at 4.3.3, so the deprecated `module.register()` path is no longer loaded.

**Contract**:

- The direct specifiers for `@tailwindcss/vite` and `tailwindcss` become `^4.3.3`. That raises the floor to a version without the deprecated call.
- The lockfile changes only those Tailwind packages. `supabase@2.117.0` and every other resolution stay unchanged.
- `prettier-plugin-tailwindcss` and `tailwind-merge` are not touched.

### Success Criteria:

#### Automated Verification:

- [x] The lockfile diff is confined to Tailwind packages. `git diff pnpm-lock.yaml` shows only `tailwindcss` / `@tailwindcss/*` entries, and `grep -E "^  '?supabase@" pnpm-lock.yaml` still shows `2.117.0`.
- [x] `pnpm install --frozen-lockfile` succeeds on the refreshed lockfile.
- [x] `pnpm astro sync 2>&1 | grep -c DEP0205` prints `0` on Node 26.12.1.
- [x] `pnpm build 2>&1 | grep -c DEP0205` prints `0`, and the build plus the `postbuild` key assert are green.
- [x] `/verify` is green on Node 26.12.1.

#### Manual Verification:

- [ ] `pnpm build && pnpm preview`: the plan board, plans list and sign-in page look unchanged from before the refresh, in both light and dark themes (Tailwind patch-level CSS check).
- [ ] The bump PR's CI is green on `ubuntu-latest` for all of `verify`, `integration`, `e2e` and `solver`. This closes the research's Linux-runner gap. A single `integration` red needs a re-run before it's attributed to this diff (known ~1-in-5 parallel flake on `main`).

**Implementation Note**: After automated verification passes, pause for the visual check and the PR's CI result.

---

## Testing Strategy

### Unit Tests:

- **The jsdom lane storage canary** (`src/test/dom-lane.test.tsx`). Its deliberate-break run proves that it detects the Node ≥25 regression.
- **Existing Node-sensitivity canaries:**
  - `bench/campaign/main.test.ts`: native type stripping under bare Node, with clean stderr.
  - `src/test/seed-transcode-identity.test.ts`: runs `node` from `PATH`.

### Integration Tests:

- No new suites. The research already ran `pnpm test:integration --maxWorkers=2` and `pnpm test:e2e` green on 26.12.1, and the PR's own CI re-runs both on Linux.

### Manual Testing Steps:

1. Run `mise current node` in the repo root. Expect `26.12.1` even though the global config says `lts`.
2. Run `pnpm build && pnpm preview`, sign in, and open a plan board. Drag a grouping onto a slot.
3. After Phase 2, compare the board and the sign-in page in light and dark mode against Phase 1's preview.

## Performance Considerations

None. Node is build and test tooling only, and the <200 ms placement-validation budget runs in the browser. The workerd runtime is untouched.

## Migration Notes

**Each developer needs Node 26.12.1 installed once.** On their next `cd` into the repo, mise resolves 26.12.1 from `.node-version`. If it isn't installed, `mise install` adds it. Nothing else migrates.

**Merging deploys**, as every merge to `main` does. The README rule still applies: don't merge while a production solve is running. The solver image inputs don't change, but the deploy job still rebuilds and pushes the image on every merge.

**Rollback:** revert the commit(s). `.node-version` is the only switch CI reads.

## References

- Research: `context/changes/bump-node-to-v26/research.md`
- Upstream: vitest-dev/vitest#10867 (jsdom storage dropped on Node 25+)
- mise idiomatic version files: Context7 `/jdx/mise` (`docs/lang/node.md`, `docs/dev-tools/versions.md`)
- Prior Node pin change: `24504ea` (`fix(ci): node version file`)
- Unrealised mise-node proposal: `context/archive/2026-07-16-post-poc-cp-sat-refactoring-plan/research.md` (~:460)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Node 26 pin, jsdom storage fix and local parity

#### Automated

- [x] 1.1 mise resolves node 26.12.1 in the repo root; node v26.12.1, pnpm 12.9.1 — e60ba0b
- [x] 1.2 Frozen install clean on Node 26, lockfile unchanged — e60ba0b
- [x] 1.3 dom-lane storage canary passes on Node 26.12.1 — e60ba0b
- [x] 1.4 Deliberate break: canary fails on Node 26 without the execArgv flag — e60ba0b
- [x] 1.5 Canary passes on Node 24.19.0 (flag spelling valid on 24) — e60ba0b
- [x] 1.6 Full pnpm test green with no localStorage ExperimentalWarning — e60ba0b
- [x] 1.7 /verify green on Node 26.12.1 — e60ba0b
- [x] 1.8 No stale 24.15 literal outside archive/deployment/changes/lockfile — e60ba0b

#### Manual

- [ ] 1.9 Build + preview smoke on Node 26: sign in, board renders, drag-drop works

### Phase 2: Tailwind patch refresh (drop DEP0205)

#### Automated

- [x] 2.1 Lockfile diff confined to Tailwind packages; supabase still 2.117.0 — d9090da
- [x] 2.2 Frozen install succeeds on refreshed lockfile — d9090da
- [x] 2.3 astro sync prints no DEP0205 on Node 26 — d9090da
- [x] 2.4 Build prints no DEP0205; build + postbuild assert green — d9090da
- [x] 2.5 /verify green on Node 26.12.1 — d9090da

#### Manual

- [ ] 2.6 Visual check: board, plans list, sign-in unchanged in light and dark
- [ ] 2.7 Bump PR CI green on ubuntu-latest for verify, integration, e2e, solver
