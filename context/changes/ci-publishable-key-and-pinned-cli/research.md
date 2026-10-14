---
date: 2026-10-14T12:08:12+02:00
researcher: Claude (Opus 5.5)
git_commit: c01daa403fefd36e5905de6dd0fa580c4e948107
branch: main
repository: dobrek/ib-timetable-planner
topic: "F-402 — CI on the publishable key and a pinned Supabase CLI: edit surface, the two Unknowns, and what the pin actually pins"
tags: [research, ci, supabase-cli, api-keys, github-actions, F-402]
status: complete
last_updated: 2026-10-14
last_updated_by: Claude (Opus 5.5)
---

# Research: F-402 — CI on the publishable key and a pinned Supabase CLI

**Date**: 2026-10-14T12:08:12+02:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: c01daa403fefd36e5905de6dd0fa580c4e948107
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Roadmap F-402 (`context/foundation/roadmap.md:119-132`): every CI lane should reach its ephemeral
stack with `SUPABASE_KEY = sb_publishable_…`, asserted rather than assumed, on a Supabase CLI pinned
in step with `package.json`. This research takes the "why" as settled by the prior research
(`context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/research.md:488-604`).
It sets out to answer:

1. What does the switch touch: every reader, every comment, and where the assertion should live?
2. **Unknown 1:** should `SUPABASE_SERVICE_ROLE_KEY` move to `sb_secret_…` in this change?
3. **Unknown 2:** which pin mechanism: `setup-cli` `version:` by hand, or `pnpm exec supabase`?

## Summary

- **Both Unknowns resolve cheaply.**
  - **Secret key:** this is a one-line change, `auth.secret_key=SUPABASE_SERVICE_ROLE_KEY`. Only the
    value changes; the variable name stays.
    - Local runs already put `sb_secret_…` under that name, and the hosted runbook does too.
    - An empirical probe found the two keys behave identically.
    - The "36 suites" estimate applies only to a *rename*, which nothing requires.
  - **Pin:** the lockfile's CLI via `pnpm exec supabase` is the stronger option.
    - The npm package ships its binary as a platform `optionalDependency`, so there is no
      postinstall and no `allowBuilds` entry is needed.
    - `deploy` already runs `pnpm exec supabase` in CI.
- **CI's CLI is unpinned by accident, not by design.** `supabase/setup-cli` v3.0.1 is supposed to
  install the lockfile's version when `version:` is omitted.
  - pnpm 12 writes `pnpm-lock.yaml` as **two YAML documents**. The action's parser receives an
    array, finds no `importers`, and silently falls back to `latest`.
  - Detection has never worked in this repo: the two-document lockfile landed 2026-10-05 and
    setup-cli v3 arrived 2026-10-09.
- **The pin fixes CI's CLI and export syntax, but not image parity with developer machines.**
  - Three different stacks are in play: CI today, the lockfile CLI's defaults, and linked developer
    machines. The table is in §3.
  - Linked machines take their images from `supabase/.temp/*-version`, which `supabase link` wrote on
    2026-06-12 (PostgREST **v14.5**), not from the CLI.
  - The prior research attributed local GoTrue v2.189.0 to CLI 2.117.0. That was wrong.
- **The assertion belongs in the composite action, not `load-test-env.ts`.**
  - The gate there covers only the integration lane.
  - It runs after the native solver has already booted on the key in both lanes.
  - The stable `status --override-name` *silently drops* an unknown path (exit 0, no variable), so
    the assertion is load-bearing, not decorative.
- **No code inspects the key's format, and the solver never sends it as Bearer.** The edit surface
  is the composite action, its two callers, one error message, and comments.

## Detailed Findings

### 1. The publishable switch: what reads `SUPABASE_KEY` in CI

**Producer.** In `.github/actions/supabase-stack/action.yml`:

- `:5-8` declares the input `export-anon-key`.
- `:54` passes it as `EXPORT_ANON_KEY`.
- `:57` sets `EXTRA="--override-name auth.anon_key=SUPABASE_KEY"`.
- `:58-62` pipes `status -o env … | sed 's/"//g' >> "$GITHUB_ENV"`.

Both callers set it `"true"`: `ci.yml:112-114` (integration) and `ci.yml:211-213` (e2e).

**Consumers in CI**, in the order they touch the key:

1. **The native solver, in both lanes, before any test runs.**
   - It inherits the key from `$GITHUB_ENV`: integration at `ci.yml:154-172`, e2e at
     `ci.yml:236-253`.
   - At boot, `_verify_credential` signs in (`services/solver/src/cpsat_service/app.py:254-280`). A
     bad key kills the service before `/health` answers.
   - Headers:
     - The password grant sends `apikey` only, with no `Authorization`
       (`services/solver/src/cpsat_service/supabase.py:134-139`).
     - PostgREST calls send `apikey: <key>` + `Authorization: Bearer <user access token>`
       (`supabase.py:262-267`).
     - There is no unauthenticated PostgREST call.
     - JWT decoding applies only to access tokens (`supabase.py:92-109,312-329`).
2. **The e2e preview.** `ci.yml:263-266` writes the key into `.dev.vars`, which goes to `astro:env`
   (`astro.config.mjs:78`, a plain `envField.string`) and then to `createServerClient`
   (`src/shared/api/supabase.ts:25`).
3. **The integration harness, through `readPublishableKey()`** (`src/test/publishable-key.ts:17-18`;
   no format check). Its callers are:
   - `src/test/factories/create-signed-in-user.ts:63`
   - `src/test/role-matrix.integration.test.ts:60`, which also builds the session-less `anon`
     principal at `:84-85`
   - `src/test/solver-credential.integration.test.ts:40`
   - `src/test/factories/lifecycle.smoke.integration.test.ts:26`

**Format inspection: none.** No code matches `sb_publishable`, `eyJ` or `startsWith("sb_`. Test fakes
use neutral literals (`services/solver/tests/fakes.py:48`, `src/solver-container-env.test.ts:19`).
The only prefix check anywhere is inside supabase-js (`isNewApiKey`,
`node_modules/@supabase/supabase-js/dist/index.mjs:274`).

**Header-shape nuance (verified in supabase-js 2.116.0).** With no session, REST and Auth calls
send the key on **both** `apikey` and `Authorization: Bearer`, publishable or not:

- `fetchWithAuth` falls back to the key as bearer (`dist/index.mjs:298-303`).
- The auth client hard-codes `Authorization: Bearer ${supabaseKey}` (`:842-845`).

Only `functionsFetch` (`:673`, `omitApiKeyAsBearer`) drops the Bearer for `sb_` keys. So
`roadmap.md:124` ("a publishable key [travels] on the `apikey` header") is accurate for **Edge
Functions**, which is S-409's case, but not in general.

After the switch, the role matrix's anon cells send `Bearer sb_publishable_…` to Kong. Local dev
already takes this path. A rejection would fail loudly, not pass: `src/test/access-probe.ts:73-89`
treats only 42501, an empty read or no effect as "denied", and throws on 401, PGRST301 or 502.

**No test asserts on a key-only call's headers.** The only header assertions
(`services/solver/tests/test_service.py:286-287`) cover the authenticated claim PATCH.

### 2. Unknown 1: `SUPABASE_SERVICE_ROLE_KEY` → `sb_secret_…`

**The edit is one line**: `action.yml:60` `auth.service_role_key=` → `auth.secret_key=`, keeping the
output name `SUPABASE_SERVICE_ROLE_KEY`.

- **There is no shared helper; each reader calls `process.env` itself.** 44 files read it directly:
  - all **37** `*.integration.test.ts` suites, using `createClient<Database>(SUPABASE_URL, SERVICE_KEY)`
  - `scripts/provision-solver-user.mjs:67,86` and `scripts/provision-e2e-author.mjs:40,51`
  - 5 `bench/` files (not run in CI)

  `src/test/load-test-env.ts:32` checks presence only. Because only the value changes, none of these
  44 files needs editing.
- **Local runs are already on `sb_secret_…`.** `.env.test.local` (gitignored, parsed by
  `load-test-env.ts:7-19`) holds a value byte-equal to the stack's `SECRET_KEY`. The hosted runbook
  uses the secret key under this name (`docs/runbooks/solver-credential.md:94-97`;
  `scripts/provision-solver-user.mjs:74-75`). **CI is the only place on the legacy HS256 JWT.**
- **Nothing depends on the value being a JWT.**
  - Every use goes through supabase-js `createClient`; there are no hand-built headers.
  - `src/test/access-claims.ts:11` decodes user session tokens only.
  - Grant checks use `SUPABASE_DB_URL` and `pg` (`src/test/postgres-client.ts:21`).
  - No admin client ever signs in. That matters, because a secret key bypasses RLS only on a request
    without a user token.
- **Docs (Context7 `/supabase/supabase`):**
  - Secret keys authorise as `service_role` (BYPASSRLS) and replace the legacy key for `auth.admin`.
  - They return **401 to a browser-like User-Agent**. Every consumer here runs in Node.
  - They must use `apikey`, not Bearer, for Edge Functions and `pg_net`. Neither is used with this
    key.
- **Empirical probe** (local stack, read-only, run from the scratchpad, no key printed). The two
  service keys are indistinguishable:

  | Key | `auth.admin.listUsers` | courses | generation_jobs | placements | plans | students |
  |---|---|---|---|---|---|---|
  | `sb_secret_` | ok (4) | 840 | 10 | 2000 | 10 | 610 |
  | legacy JWT | ok (4) | 840 | 10 | 2000 | 10 | 610 |
  | publishable (control) | 403 `not_admin` | 401 | 401 | 401 | 401 | 401 |

- **The CLI exports it correctly on the lockfile version.** `--override-name auth.secret_key=…`
  emits `sb_secret_…` on 2.117.0, verified 2026-10-14.
- **History:** there was no prior attempt. `git log -S'sb_secret'` finds docs only. Admin calls with
  `sb_secret_` already ran locally in `context/changes/user-managment-research/research.md:504,517`.

**Effect:** the CLAUDE.md claim "`sb_secret_…` appears only in Node tooling and tests" becomes true
everywhere without any edit to CLAUDE.md.

### 3. Unknown 2: the pin, and why CI floats today

**Root cause: setup-cli's lockfile detection is defeated by pnpm 12's two-document lockfile.**

- **Documented behaviour of the pinned action** (`supabase/setup-cli@45a513f` = v3.0.1,
  `action.yml:5-6` and its README): "If omitted, detect from the root lockfile and otherwise use
  latest."
- **What its source does:** `detectResolutionFromPnpmLock` (`src/main.ts:159-191`) calls
  `Bun.YAML.parse(text)` and reads `lockfile.importers?.["."]`. Any exception or miss returns
  `null`, which falls through to `DEFAULT_VERSION = "latest"` (`:11`, `:222-233`).
- **The repo's lockfile:** `pnpm-lock.yaml` opens with `---` and has two documents (`:1` and
  `:158`). The first is the env lockfile for pnpm itself (`packageManagerDependencies`). Running
  `Bun.YAML.parse` on it (Bun 1.3.12, locally) returns **an array of 2 docs**, so `.importers` is
  `undefined`.
- **Timeline:**
  - 2026-10-05: the two-document lockfile arrives with `97b25ec` (pnpm 12.9.1).
  - 2026-10-09: setup-cli v3.0.1 arrives with Dependabot `6bc8871`; before that it was v2.1.2
    (`6eb1569`).
  - So lockfile detection has **never** worked here.
- **Evidence from CI:** run 38293918808 (main, 2026-10-12), integration job.
  - `INPUT_VERSION:` is empty.
  - The pulled images are `postgres:17.11.0.004`, `postgrest:v16.4` and `gotrue:v2.197.0`, exactly
    CLI **2.120.0**'s `apps/cli-go/pkg/config/templates/Dockerfile`.
  - That CLI also warns `config section [inbucket] is deprecated. Please use [local_smtp] instead.`

**Three stacks, three image sets:**

| Where | CLI | Postgres | PostgREST | GoTrue | Image source |
|---|---|---|---|---|---|
| CI today | 2.120.0 (`latest`) | 17.11.0.004 | v16.4 | v2.197.0 | CLI defaults |
| CI after pinning to the lockfile | 2.117.0 | 17.6.1.167 | v16.2 | v2.196.0 | CLI defaults (from the v2.117.0 Dockerfile) |
| Linked developer machine | 2.117.0 | 17.6.1.121 | **v14.5** | v2.189.0 | `supabase/.temp/{postgres,rest,gotrue}-version`, written by `supabase link` on 2026-06-12 |

- The CLI honours `supabase/.temp/*-version` over its own defaults when present. That is why the
  local PostgREST is v14.5, which no recent CLI defaults to.
- `.temp` is gitignored (`supabase/.gitignore:3`), so this is per-machine. A fresh, unlinked clone
  would match pinned CI.
- **Pinning makes CI reproducible and moves it to the same CLI binary developers run.** It does
  **not** equalise images with a linked machine.
- Pinning to 2.117.0 also moves CI's images *backwards* from 2.120.0's. CI was green on 2.117.0's
  images while that was `latest`, from 2026-09-07 to 09-25.
- Hosted's current service versions were not checked. That would need the Management API or the
  `/auth/v1/health` endpoint against production.

**The override syntax is stable, but silent on typos.**

- On `develop`, the stable `supabase status -o env --override-name <fieldKey>=<name>` keeps the
  dotted form. It resolves overrides by map lookup, `overrides.get(field.fieldKey) ?? defaultName`
  (`apps/cli/src/command-internal/status-values.ts:105-106`), so an **unknown path is dropped
  silently**.
  - Reproduced on 2.117.0: `--override-name auth.bogus_key=X` exits 0 and emits no `X`.
  - The same file marks `anon_key` and `service_role_key` as **deprecated** fields, still emitted
    (`:12-14`).
- The strict `EXPORTED_VARIABLE=NAME` syntax that rejects unknowns, cited in the prior research and
  by one sub-agent, belongs to the new **experimental `supabase experimental stack status --env`**
  backend (`apps/cli/docs/stack-commands.md:127-136`). That backend also rejects `-o env` outright.
  It is not the command this repo runs.
- The npm `next` dist-tag is `3.0.0-next.9`. If the stack backend becomes the default in v3, an
  unpinned CI would break on `-o env`. That is one more reason to pin.

**Pin mechanism options:**

- **A. `pnpm exec supabase` (lockfile's CLI) and drop `setup-cli`.**
  - The npm `supabase@2.117.0` has no install script. Its binary arrives through
    `optionalDependencies` `@supabase/cli-linux-x64` and similar (`pnpm-lock.yaml:10241-10254`).
    So `pnpm-workspace.yaml`'s `allowBuilds` (which lacks `supabase`) does not matter.
  - The CI precedent already exists: `deploy` runs `pnpm exec supabase link` / `db push`
    (`ci.yml:374-375`).
  - Both callers already run `./.github/actions/setup` (frozen install) before `supabase-stack`
    (`ci.yml:106,112` and `:210,211`).
  - It removes one SHA-pinned remote action, plus its Bun download and npm install (~4.7 s per lane).
  - Drift is zero by construction: a `package.json` bump moves CI in the same commit.
  - Three bare `supabase` invocations would change: `action.yml:28` and `:58`, and the action's
    description at `:2`.
- **B. `setup-cli` with `version: "2.117.0"` kept in step by hand.**
  - This mirrors `wranglerVersion` (`ci.yml:424`) and the setup-uv `version` (`ci.yml:136,231,336`).
  - Dependabot covers `github-actions` only (`.github/dependabot.yml:12-14`), so a `supabase` bump
    is a hand edit either way. Under B it is a *second* hand edit that can be forgotten. Closing that
    gap needs an assert step comparing `supabase --version` to the lockfile, the pattern the
    shellcheck pin uses at `ci.yml:83-89`.
- **C. Rely on setup-cli auto-detection.** Not viable until upstream parses multi-document pnpm
  lockfiles. Worth an upstream issue regardless.

### 4. Where the assertion lives

- **`src/test/load-test-env.ts:31-39`** is the existing CI fail gate. It is presence-only and
  detects CI via `process.env.CI === "true"`.
  - **Against it:**
    - It covers the integration lane only. The e2e lane never loads it.
    - It runs after the native solver has already booted on the key, in both lanes.
    - As a `setupFiles` entry, it throws once per test file.
  - It keeps its presence check. Its message at `:37` names `export-anon-key` and needs rewording.
- **A step in the composite action, after "Export Supabase env"** runs before both lanes and before
  both solvers.
  - Values appended to `$GITHUB_ENV` are visible only to *later* steps, so the check must be its own
    step or must parse the `status` output inside the same step.
  - It should print the prefix or length, never the value. The local keys are public CLI defaults,
    but the habit matters.
  - Natural checks:
    - when `export-publishable-key` is set: `SUPABASE_KEY` starts with `sb_publishable_`
    - if Unknown 1 is taken: `SUPABASE_SERVICE_ROLE_KEY` starts with `sb_secret_`
    - under option B, the installed CLI version equals the lockfile's

### 5. Comments and docs to reword

**Must change:**

- `action.yml`: `:5`, `:6`, `:34-35`, `:54`, `:57`.
- `ci.yml`: `:107-111`, `:114`, `:213`, `:255-258`.
- `src/test/load-test-env.ts:37`.
- `context/foundation/roadmap.md:82` (current-state text), once landed.

**Stale reasoning, not just a rename (`ci.yml:255-258`):** "the CI stack mints its own anon key that
won't match the fixed local publishable key" is wrong on its own terms.

- The publishable and secret keys are fixed CLI defaults
  (`apps/cli-go/pkg/config/apikeys.go:19-20` at v2.117.0: `defaultPublishableKey`,
  `defaultSecretKey`). So CI's publishable key is byte-identical to every developer's.
- The true reasons to write `.dev.vars` from `status` are:
  - `.envs/` is gitignored, so CI has no `local.vars`.
  - Reading the stack's own output stays correct if `config.toml` ever sets custom keys.

**Synonym usage ("publishable (anon) key"), optional:**

- `src/test/publishable-key.ts:5`
- `docs/runbooks/solver-credential.md:18`
- `docs/runbooks/author-provisioning.md:123`
- `context/deployment/deploy-plan.md:69,140`

**Clean already:** `README.md`, `CLAUDE.md`, `e2e/`, `scripts/`, `services/solver/`.

## Code References

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/`

- [`.github/actions/supabase-stack/action.yml:14-15`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/.github/actions/supabase-stack/action.yml#L14-L15): `setup-cli` with no `version:`
- [`.github/actions/supabase-stack/action.yml:51-62`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/.github/actions/supabase-stack/action.yml#L51-L62): the export step; `:57` anon, `:60` service-role
- [`.github/workflows/ci.yml:107-114`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/.github/workflows/ci.yml#L107-L114): integration caller and its comment
- [`.github/workflows/ci.yml:154-172`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/.github/workflows/ci.yml#L154-L172): integration solver boot (the key's first consumer)
- [`.github/workflows/ci.yml:255-266`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/.github/workflows/ci.yml#L255-L266): e2e `.dev.vars` write, with the stale "mints its own anon key" reasoning
- [`.github/workflows/ci.yml:372-375`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/.github/workflows/ci.yml#L372-L375): `pnpm exec supabase` already in CI (deploy)
- [`.github/workflows/ci.yml:67-89`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/.github/workflows/ci.yml#L67-L89): the shellcheck pin and assert pattern
- [`src/test/load-test-env.ts:31-39`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/src/test/load-test-env.ts#L31-L39): CI presence gate
- [`src/test/publishable-key.ts:17-18`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/src/test/publishable-key.ts#L17-L18): `readPublishableKey()`, format-agnostic
- [`services/solver/src/cpsat_service/supabase.py:134-139`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/services/solver/src/cpsat_service/supabase.py#L134-L139): password grant, `apikey` only
- [`services/solver/src/cpsat_service/supabase.py:262-267`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/services/solver/src/cpsat_service/supabase.py#L262-L267): PostgREST headers; the Bearer is the user token
- [`src/test/access-probe.ts:73-89`](https://github.com/dobrek/ib-timetable-planner/blob/c01daa403fefd36e5905de6dd0fa580c4e948107/src/test/access-probe.ts#L73-L89): "denied" is narrow, so a gateway rejection throws
- `pnpm-lock.yaml:1,158`: two YAML documents. `:368-370`: `supabase` 2.117.0. `:10241-10254`: platform `optionalDependencies`
- `node_modules/@supabase/supabase-js/dist/index.mjs:274,298-303,673,842-845`: `isNewApiKey`, key-as-bearer fallback, the Functions opt-out, auth client headers
- Upstream `supabase/setup-cli@45a513f` `src/main.ts:11,159-191,222-233`: lockfile detection and its silent `latest` fallback
- Upstream `supabase/cli@v2.117.0` `apps/cli-go/pkg/config/templates/Dockerfile` (image defaults) and `apps/cli-go/pkg/config/apikeys.go:19-20` (fixed default keys)
- Upstream `supabase/cli@develop` `apps/cli/src/command-internal/status-values.ts:12-14,105-106`: deprecated fields; override map lookup

## Architecture Insights

- **"Pinned" has two axes here: the CLI binary and the container images.** The repo's pinning culture
  (SHA-pinned actions, `wranglerVersion`, uv, shellcheck with a digest plus an assert step) addresses
  the first. The second is controlled by the CLI's Dockerfile defaults *unless* `supabase/.temp/*-version`
  overrides them. That makes linked developer machines a moving, per-machine snapshot of hosted.
- **The existing pins share a recognisable pattern: a literal, a lockstep partner, and an assertion
  that reads the literal back** (`ci.yml:59-89`). Option B would follow it. Option A removes the need
  for it, because the lockfile is the single literal.
- **Two silent fallbacks were found, both of them invisible exactly when they matter:** setup-cli's
  `latest` fallback, and `status --override-name` dropping unknown paths. Both argue for assertions
  at the producer (the composite action), consistent with the "guard in the launcher" lesson
  (`lessons.md:82-87`).
- **The env-isolation rules hold unchanged.** Every value still comes from the job's own ephemeral
  stack, and nothing touches `${{ secrets.* }}` or a workflow-level `env:` (`action.yml:41-50`).

## Historical Context (from prior changes)

- `context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/research.md:488-604`
  covers the origin of the legacy-key wiring (`8b1fd3b`, `3ef2cc5`, `7d0fc65`, `6eb1569`), that no
  technical reason was ever recorded, and the recommendation that became F-402. **Corrections from
  this research:**
  - Local GoTrue v2.189.0 comes from the link-time `.temp` snapshot, not from CLI 2.117.0.
  - The "new override syntax rejects unknowns" claim describes the experimental `stack` backend, not
    `supabase status`.
- Same doc, `:203-210`: the rate-limit finding rested on the local container's configuration and
  flagged CI's unpinned CLI as the residual risk. Pinning closes that risk for CI. Image parity with
  linked machines remains a separate question.
- `context/changes/user-managment-research/research.md:504,517`: `sb_secret_` admin calls
  (`inviteUserByEmail`, `updateUserById`) already worked locally.
- `97b25ec` (2026-10-05, pnpm 12.9.1) introduced the two-document lockfile. Its message says pnpm 12
  "keeps pnpm 11's … lockfile format", which is true for pnpm, but it broke a third-party parser that
  arrived four days later.

## Related Research

- `context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/research.md`: the
  parent of this item.
- `context/changes/user-managment-research/research.md`: secret-key admin calls, relevant to S-409.

## Open Questions

1. **Image parity target.** After the pin, CI matches an *unlinked* clone, not a linked developer
   machine (PostgREST v16.2 vs v14.5). Options:
   - accept and document it;
   - tell developers to delete `supabase/.temp/*-version`, or to re-link to refresh hosted's
     versions;
   - make CI deliberately mirror hosted.

   This is a plan-phase scope call. The roadmap's outcome ("stop drifting between CI and developer
   machines") is only partly met by the CLI pin alone.
2. **Hosted service versions today.** These are unknown. Answering needs a production read (the
   Management API, or `GET /auth/v1/health`), which was deliberately not made here.
3. **Phasing inside one PR.** The pin also changes CI's images (2.120 → 2.117). Landing the pin, the
   publishable switch and the secret switch as separate commits, with CI observed between them,
   keeps a red build attributable. The integration lane's known ~1-in-5 flake rate under
   `--maxWorkers=2` is the baseline to judge against.
4. **`$GITHUB_ENV` visibility inside a composite action.** A later step in the same composite should
   see values an earlier step appended. Confirm this on the first CI run of the assertion step.
5. **Future CLI bump debt** (not F-402 scope, but it lands on whoever bumps):
   - `config.toml`'s `[inbucket]` section is deprecated in favour of `[local_smtp]` (warned on 2.120).
   - `anon_key` and `service_role_key` are deprecated `status` fields, so once Unknown 1 is taken,
     this repo no longer exports either.
6. **Upstream.** File an issue on `supabase/setup-cli`: multi-document pnpm lockfiles defeat version
   detection and fall back to `latest` silently.
7. **Minor doc gap.** README has no instructions for creating `.env.test.local`, which is where local
   integration runs get `SUPABASE_SERVICE_ROLE_KEY`.
