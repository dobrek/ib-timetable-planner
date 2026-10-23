# Bump Node to v26 — Plan Brief

> Full plan: `context/changes/bump-node-to-v26/plan.md`
> Research: `context/changes/bump-node-to-v26/research.md`

## What & Why

This moves the repo's Node toolchain from 24.15.0 to **26.12.1**, locally and on CI. There are three reasons:

- The current pin misses three Node 24 security releases.
- It already falls outside two ESLint dependencies' declared `engines`.
- Node 24 entered Maintenance LTS on 2026-10-20.

Node is tooling-only here: production runs on workerd and the solver is Python. So this changes build and test, never production behaviour.

## Starting Point

`.node-version` is the single pin, and CI reads it through `actions/setup-node`. Locally it is ignored: mise follows the developer's global `lts`, which currently resolves to 24.19.0.

The research ran the whole CI surface on 26.12.1 and all of it passed. It found one hidden incompatibility: Vitest 4's jsdom lane drops `window.localStorage` on Node ≥25.

## Desired End State

- On CI and locally, the repo runs Node 26.12.1, resolved from the one `.node-version` literal.
- The jsdom lane has working Web Storage, and a canary goes red if that ever breaks.
- No `astro` command prints the `DEP0205` deprecation warning.
- Every doc that names the Node version, or how it's pinned, is true again.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Target version | 26.12.1 now, not the LTS-tagged 26.x due 10-28 | The move to LTS later is a patch-level edit of `.node-version`. | Research |
| jsdom storage fix | `execArgv: ["--no-experimental-webstorage"]` on the `dom` project | Verified on both 24 and 26, whereas Node 24 rejects `--no-webstorage` with exit 9. | Research |
| Local parity | `mise.toml [settings] idiomatic_version_file_enable_tools = ["node"]` | Keeps one literal; empirically beats the global `lts`. | Plan |
| Tailwind `DEP0205` | Refresh to 4.3.3 as its own phase and commit | The noise is Node 26-induced, and a separate commit keeps the CSS patch revertible. | Plan |
| `engines.node` | Not added | mise would also read `package.json`, so it would be a second source; advisory without `engineStrict` anyway. | Plan |
| Storage guard | Permanent canary in `src/test/dom-lane.test.tsx` | Otherwise a removed flag or a Vitest 5 change fails silently until some future feature test. | Plan |
| CI files | Untouched | `setup-node` already reads `.node-version`; `ci.yml:387`'s "node24" is the action runtime. | Research |

## Scope

**In scope:**

- Change `.node-version` to 26.12.1.
- Add the `mise.toml` setting.
- Add `vitest.config.ts` `execArgv` and the dom-lane storage canary.
- Fix the docs that state the version: CLAUDE.md, README, health-check, tech-stack, the bench comment.
- Refresh `tailwindcss` and `@tailwindcss/vite` to `^4.3.3`.

**Out of scope:**

- `engines` / `engineStrict`.
- Dependabot or Renovate for Node.
- Vitest 5 and `@types/node` bumps.
- CI workflow edits.
- The pre-existing `astro dev` boot failure.
- The historical `deploy-plan.md` checklist.
- mise reading `.python-version`.

## Architecture / Approach

One pin (`.node-version`) now has two readers: `actions/setup-node` on CI and mise locally. That makes local resolve exactly what CI runs.

The only code-adjacent fix is in the test environment: a Node flag scoped to the jsdom Vitest project, plus a canary in that lane's existing infra smoke test.

The Tailwind refresh is a targeted lockfile update. Its diff must stay inside the Tailwind packages, because `supabase@2.117.0` selects CI's Supabase images.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Node 26 pin, jsdom storage fix, local parity | Pin, mise setting, `execArgv` and canary (with a deliberate-break check), doc fixes | Linux runner not yet exercised (the trial ran on macOS arm64); closed by the PR's CI |
| 2. Tailwind patch refresh | `DEP0205` gone from every astro command | Patch-level CSS output change; mitigated by a visual check and the E2E lane |

**Prerequisites:** Node 26.12.1 installed via mise (`mise install` after Phase 1's setting lands). A local Supabase stack is needed only for the manual preview smoke.

**Estimated effort:** about one short session, two commits.

## Open Risks & Assumptions

- **Linux:** the empirical trial ran on macOS arm64. The bump PR's `ubuntu-latest` CI run is the remaining proof, and costs nothing extra.
- **Vitest 5:** the `execArgv` flag works around a Vitest 4 limitation, so re-check whether it's still needed when the repo moves to Vitest 5. The canary will flag a change in behaviour.
- **Drift:** nothing watches `.node-version` automatically, so future 26.x security releases still need a manual bump. That was a deliberate earlier deferral.
- **Merging deploys** (the standard rule): don't merge while a production solve is running.

## Success Criteria (Summary)

- `mise current node` and CI both resolve 26.12.1, and `/verify` plus the PR's four CI jobs are green.
- The dom-lane canary passes with the flag and fails without it on Node 26. `pnpm test` shows no localStorage warning.
- No `DEP0205` in astro output, and the board looks unchanged.
