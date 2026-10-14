# CI on the Publishable Key and a Pinned Supabase CLI (F-402) Implementation Plan

## Overview

CI's ephemeral Supabase stack moves to the key formats production uses: `SUPABASE_KEY` becomes
`sb_publishable_…` and `SUPABASE_SERVICE_ROLE_KEY` becomes `sb_secret_…`. The stack runs on the
lockfile's Supabase CLI rather than whatever `latest` is, and a CI step checks both the CLI version
and the exported env before anything consumes them. The developer machine is then realigned to CI's
images, and the drift that remains possible (a re-link) is documented. This unlocks S-409, whose CI
tests must see the request shapes production sends.

## Current State Analysis

- **The CLI floats by accident.** `supabase/setup-cli@45a513f` (v3.0.1) runs with no `version:`
  (`.github/actions/supabase-stack/action.yml:14-15`). Its lockfile detection parses
  `pnpm-lock.yaml` as a single YAML document. pnpm 12 writes two (`pnpm-lock.yaml:1,158`), so the
  parse yields an array, `importers` is undefined, and the action silently falls back to `latest`.
  This has never worked in this repo. The last main run pulled CLI 2.120.0's images:
  `postgres:17.11.0.004`, `postgrest:v16.4`, `gotrue:v2.197.0`.
- **CI is the only environment on legacy keys.**
  - The export step overrides `auth.anon_key=SUPABASE_KEY` and
    `auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY` (`action.yml:57,60`). Both are HS256 JWTs, and
    the CLI marks both fields deprecated.
  - Local runs already put `sb_secret_…` under the service-role name (`.env.test.local`), and so does
    the hosted runbook (`docs/runbooks/solver-credential.md:94-97`).
  - The research probe found the secret key and the legacy JWT indistinguishable across admin calls
    and every table it read.
- **No assertion exists.** `status --override-name` drops an unknown path without an error (exit 0,
  no variable).
  - The only gate is `src/test/load-test-env.ts:31-39`. It checks presence only, covers the
    integration lane only, and runs after the native solver has already booted on the key.
  - The e2e lane would write an empty `SUPABASE_KEY` into `.dev.vars` and fail much later.
- **The input `export-anon-key` is dead configuration.** Both callers set `"true"` (`ci.yml:113-114`,
  `:212-213`), and the `"false"` default has no caller.
- **Nothing inspects the key's format.** The solver sends the key on `apikey` only, with a user
  token as Bearer (`services/solver/src/cpsat_service/supabase.py:134-139,262-267`). Every
  service-role reader goes through supabase-js `createClient` in Node. So the switch changes values,
  not code.
- **The developer machine runs a link-time snapshot.** `supabase/.temp/{postgres,rest,gotrue}-version`
  hold `17.6.1.121` / `v14.5` / `v2.189.0`, written by `supabase link` on 2026-06-12. They override
  the CLI's defaults, which is why local PostgREST is v14.5. The directory is gitignored, so this is
  per-machine.

## Desired End State

- The composite action runs `pnpm exec supabase`. Its first step fails loudly unless the binary
  answering is the installed `supabase` package's version, which is the lockfile's under
  `--frozen-lockfile`.
- Every CI stack exports `SUPABASE_URL`, `SUPABASE_KEY` (`sb_publishable_…`),
  `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_…`) and `SUPABASE_DB_URL`, and no other `status` field
  (so no legacy JWT reaches the job env under any name). A step right after the export
  fails the job if any is empty or either key has the wrong prefix. It prints names, prefixes and
  lengths, never a value.
- The action has no inputs, and neither caller passes `with:`.
- No CI comment or error message describes the legacy key, the input, or the false "mints its own
  key" reasoning.
- The developer machine runs the same three images as CI (`postgres:17.6.1.167`, `postgrest:v16.2`,
  `gotrue:v2.196.0`).
- README explains where the stack's images come from and how a re-link reintroduces drift.
  CLAUDE.md says any lockfile change to `supabase` moves CI's images.

Verify by checking that all four CI test jobs are green on the final commit, that the assert-step
logs exist in both lanes, that the `docker ps` image tags match locally, and that the greps in each
phase's criteria come back empty.

### Key Discoveries:

- The override field names `auth.publishable_key` and `auth.secret_key` emit `sb_publishable_` and
  `sb_secret_` on CLI 2.117.0. Verified locally on 2026-10-14 by printing names and prefixes only.
- `pnpm exec supabase --version` prints a bare `2.117.0` on stdout; the update nag goes to stderr.
  `node_modules/supabase/package.json` has no `exports` field, and its `version` is the installed
  (lockfile) version.
- The npm `supabase` package's binary arrives through platform `optionalDependencies`
  (`@supabase/cli-linux-x64`, …), and it has no install script. So `allowBuilds` in
  `pnpm-workspace.yaml` is irrelevant.
- `deploy` already runs `pnpm exec supabase link` and `db push` in CI (`ci.yml:374-375`). That is
  proof the Linux binary resolves on the runner.
- Both stack callers run `./.github/actions/setup` (frozen install) before `supabase-stack`
  (`ci.yml:106,112` and `:210,211`).
- The publishable and secret keys are fixed CLI defaults (`apps/cli-go/pkg/config/apikeys.go:19-20`
  at v2.117.0). That makes `ci.yml:255-258`'s "the CI stack mints its own anon key" claim false.
- The integration lane's known ~1-in-5 transient-502 flake under `--maxWorkers=2` is the baseline
  for judging a red run.

## What We're NOT Doing

- **Renaming `SUPABASE_SERVICE_ROLE_KEY`.** Only the value moves; its 44 direct readers stay
  untouched.
- **Making CI mirror hosted's image versions**, or reading hosted's service versions at all.
- **Touching `supabase/.temp/storage-version` or `storage-migration`** on the developer machine. CI
  runs no storage container, so they don't affect parity.
- **Bumping the Supabase CLI.** 2.117.0 stays.
- **Migrating `[inbucket]` to `[local_smtp]`.** 2.117.0 already prints the deprecation warning
  (`supabase/config.toml:99`), so this debt exists today, not only after a bump. It stays out of scope.
- **Filing the upstream `supabase/setup-cli` issue** (multi-document pnpm lockfiles defeat
  detection). This change stops using the action. Filing is an optional courtesy, not a plan step.
- **Format checks in `load-test-env.ts` or `readPublishableKey()`.** The producer owns the
  assertion, and the consumer stays presence-only.
- **Reworking the "publishable (anon) key" wording** in the runbooks, `deploy-plan.md` or the
  `publishable-key.ts` docblock. Those are accurate synonyms, not stale claims.
- **README instructions for creating `.env.test.local`** (research Open Question 7).
- **Changing `deploy`.** It is already on the lockfile's CLI.

## Implementation Approach

Three commits on a feature branch, each pushed to a draft PR, with its CI run observed green before
the next commit lands. A red build therefore has exactly one candidate cause:

1. **The pin.** CI's images move from 2.120.0's defaults to 2.117.0's; nothing else changes. CI was
   green on 2.117.0's images while that was `latest`, from 2026-09-07 to 2026-09-25.
2. **The keys.** The images stay fixed; only the two key values change, and the assertion arrives
   with them.
3. **The local realignment and the docs.** These have no CI effect.

The checks sit at the producer, the composite action, because that is the one place that runs
before both lanes and before both solvers. That follows the "guard in the launcher" lesson
(`lessons.md:82-87`).

## Critical Implementation Details

**Timing & lifecycle (rollout).**
- Work on a branch: every merge to `main` deploys the Worker and rolls the container. Merge only
  when no production solve is running (README § Deployment).
- Before attributing a red integration job to the diff, re-run it once. That job fails about 1 run
  in 5 on transient 502s, independently of any change.

**State sequencing (`$GITHUB_ENV`).**
- Values appended to `$GITHUB_ENV` are visible only to *later* steps, so "Assert Supabase env" must
  be its own step after "Export Supabase env".
- That holds inside a composite action too. The runner processes file commands after every step,
  embedded composite steps included (`actions/runner` `ActionRunner.cs:282` →
  `FileCommandManager.cs:209`), and merges the global env into each embedded step's context
  (`CompositeActionHandler.cs:259-263`). It has worked since runner v2.272.0 (PR #557, 2020). If
  the assert step reports all four missing, the export is broken, not the env flow.

**Debug & observability.**
- The assertion never prints a character of any value, even though the local keys are public CLI
  defaults.
- It collects every failure and exits once, so a single run names every problem.

## Phase 1: Pin the CLI to the lockfile

### Overview

Run the CLI that the frozen install put in `node_modules`, and fail fast if anything else answers.
CI's container images move to CLI 2.117.0's defaults; key wiring is untouched.

### Changes Required:

#### 1. Replace `setup-cli` with the lockfile's CLI

**File**: `.github/actions/supabase-stack/action.yml`

**Intent**: Remove the floating install and make the action run, and prove it runs, the CLI pinned
by `pnpm-lock.yaml`. A `supabase` bump then moves CI in the same commit.

**Contract**:

- Remove the `supabase/setup-cli` step (`:14-15`).
- Add a new first step, "Supabase CLI (the lockfile's)", with `shell: bash` (every `run:` step in a
  composite action must declare one, or the action fails to load):
  - If `node_modules/supabase/package.json` is absent, fail with a message saying
    `./.github/actions/setup` must run before this action.
  - The expected version is that file's `version`, read with `node -p`.
  - The actual version is the **stdout** of `pnpm exec supabase --version`.
  - On a mismatch, fail with a message naming both versions. On a match, print
    `Supabase CLI <version> (lockfile)`.
- Add a comment above the step recording two things:
  - why `setup-cli` was dropped: v3.0.1 parses only single-document lockfiles, pnpm 12 writes two,
    and the action silently fell back to `latest`;
  - the precondition that `./.github/actions/setup` runs first.
- Change the start (`:28`) and status (`:58`) invocations to `pnpm exec supabase …`.
- Reword the action `description` (`:2`) so it no longer says it installs the CLI or that the keys
  are "minted". It now runs the lockfile's CLI and needs the setup action first.
- Keep the remote-action pinning note (`:10`), reworded so it applies to any remote action added
  later. None remains after this change.

### Success Criteria:

#### Automated Verification:

- [ ] No `setup-cli` reference remains: `grep -rnE "uses:[[:space:]]*supabase/setup-cli" .github` returns nothing (the comment explaining the drop is expected to mention it)
- [ ] Every CLI call in the action goes through pnpm: `grep -nE "^[[:space:]]*(run:[[:space:]]*)?supabase " .github/actions/supabase-stack/action.yml` returns nothing (no bare invocation; comments are not matched)
- [ ] Version-step drill, on the body extracted from the committed file (see Testing Strategy), and every `run:` step declares a shell (`yq '.runs.steps[] | select(has("run") and (has("shell") | not)) | .name' .github/actions/supabase-stack/action.yml` returns nothing): prints `Supabase CLI 2.117.0 (lockfile)` and exits 0 from the repo root; with `SUPABASE_CLI_BINARY_OVERRIDE` pointing at a stub that prints `0.0.0`, exits 1 naming both versions; run from a directory with no `node_modules`, exits 1 naming `./.github/actions/setup`
- [ ] Formatting holds: `pnpm exec prettier --check .github`
- [ ] Local CI gate passes: `/verify`

#### Manual Verification:

- [ ] Draft PR from a feature branch: `verify`, `integration`, `e2e` and `solver` are green on the phase-1 commit, allowing one re-run for a transient integration 502
- [ ] Integration job log: the version step prints `2.117.0`; `supabase start` pulls `postgres:17.6.1.167`, `postgrest:v16.2` and `gotrue:v2.196.0` (not `17.11.0.004` / `v16.4` / `v2.197.0`). The `[inbucket] is deprecated` warning stays: 2.117.0 prints it too, so it says nothing about the pin

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Switch both keys and assert at the producer

### Overview

Export production's key formats unconditionally, prove all four variables before either solver
boots, remove the dead input, and correct every comment or message that describes the old wiring.

### Changes Required:

#### 1. Export production's formats, unconditionally

**File**: `.github/actions/supabase-stack/action.yml`

**Intent**: Every caller gets the same four variables, in the formats production uses, with no
toggle.

**Contract**:

- Remove the `inputs:` block (`:4-8`). In the export step, remove the `env: EXPORT_ANON_KEY` mapping
  and the `EXTRA` logic (`:53-57`).
- The overrides become `api.url=SUPABASE_URL`, `auth.publishable_key=SUPABASE_KEY`,
  `auth.secret_key=SUPABASE_SERVICE_ROLE_KEY` and `db.url=SUPABASE_DB_URL`. The output names are
  unchanged.
- Append only those four names. `status -o env` prints every field, so without a filter the legacy
  HS256 JWTs still reach `$GITHUB_ENV` as `ANON_KEY` / `SERVICE_ROLE_KEY`, along with `JWT_SECRET`
  and the S3 keys. Nothing reads them today, but a future step reaching for `SERVICE_ROLE_KEY` would
  quietly get the JWT. Filter with
  `grep -E '^(SUPABASE_URL|SUPABASE_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_URL)='` between the
  `sed` and the append, and say why in the comment. Under `pipefail`, a grep that matches nothing
  fails the step, which is the right outcome.
- Rewrite the explanatory comment (`:30-39`):
  - The keys are the CLI's fixed defaults, not minted per stack. They are exported in production's
    formats.
  - `status` drops an unknown `--override-name` path without an error, which is why the assert step
    follows.
  - Keep the quote-stripping and `SUPABASE_DB_URL` rationale.
- Leave the env-isolation paragraph (`:41-46`) unchanged.
- Reword the injection paragraph (`:48-50`) as the rule for any *future* input: an input reaches a
  script through `env:`, never as `${{ }}` inside `run:`. The action now has no inputs.

#### 2. Assert the exported env

**File**: `.github/actions/supabase-stack/action.yml`

**Intent**: Turn "production's key format" from an assumption into a gate that runs before both
lanes and both solvers. It also catches any silently dropped override.

**Contract**: Add a new step, "Assert Supabase env", directly after "Export Supabase env", with
`shell: bash`. It reads the four variables from the environment.

- **Fail conditions:**
  - any of `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_DB_URL` is
    empty;
  - `SUPABASE_KEY` lacks the `sb_publishable_` prefix;
  - `SUPABASE_SERVICE_ROLE_KEY` lacks the `sb_secret_` prefix.
- **Collect, then fail once:** gather every failure, print one line per failure (the variable name
  and what was expected), then exit 1.
- **On success:** print one line per variable, with its name, its length and, for the two keys, the
  prefix matched.
- No output line contains any character of a value.

#### 3. Callers and their comments

**File**: `.github/workflows/ci.yml`

**Intent**: Drop the removed input. Make both comments describe what the stack now does, and why
`.dev.vars` is written from `status`.

**Contract**:

- Delete the `with: export-anon-key: "true"` blocks at `:113-114` and `:212-213`.
- Reword `:107-111`:
  - Keep that the two signing-in suites need the publishable key.
  - Say the stack action always exports it in the `sb_publishable_` format and asserts it.
  - Keep that `load-test-env.ts` still fails the run if it is missing.
- Reword `:255-258`:
  - Keep the `.dev.vars`-not-`webServer.env` point.
  - Replace the "mints its own anon key" reasoning with the true reasons: `.envs/` is gitignored, so
    CI has no `local.vars`, and reading the stack's own `status` output stays correct if
    `config.toml` ever sets custom keys.
  - Leave the `SOLVER_URL` paragraph as is.

#### 4. The integration CI gate's message

**File**: `src/test/load-test-env.ts`

**Intent**: The message at `:34-37` names an input that no longer exists. Point it at what would
have failed first.

**Contract**:

- The error no longer mentions `export-anon-key`. It says the `supabase-stack` action's
  "Assert Supabase env" step should have failed first, and that it is worth checking that step ran.
- The presence-only check and the variable list are unchanged.

#### 5. Drill record

**File**: `context/changes/ci-publishable-key-and-pinned-cli/change.md`

**Intent**: Prove the assertion fails for the right reasons before CI depends on it, as F-401's deny
drill did.

**Contract**: Add a dated "Assertion drill" section recording cases (a)–(e) from the Testing Strategy,
with each case's exit code and whether the output named the expected variable. Include an explicit
note that no value appeared in any output.

### Success Criteria:

#### Automated Verification:

- [ ] No legacy wiring remains: `grep -rnE "export-anon-key|EXPORT_ANON_KEY|auth\.anon_key|auth\.service_role_key" .github src` returns nothing, and neither does `grep -rnE "mints its own|minted keys" .github` (the false "mints its own key" reasoning, including the action `description`)
- [ ] Assertion drill cases (a)–(e) behave as specified and are recorded in `change.md`
- [ ] Types check: `pnpm check`
- [ ] Lint passes: `pnpm lint`
- [ ] Unit lane passes: `pnpm test`
- [ ] Formatting holds: `pnpm exec prettier --check .github src/test/load-test-env.ts`
- [ ] Local CI gate passes: `/verify`

#### Manual Verification:

- [ ] All four test jobs are green on the phase-2 commit (one re-run allowed for a transient integration 502)
- [ ] The "Assert Supabase env" log in both `integration` and `e2e` shows four names with lengths and the two prefixes, and no value characters
- [ ] The integration job's `solver-transport`, `generation-proposal`, `solver-credential` and `role-matrix` suites pass (the solver claims on the publishable key; anon cells send `Bearer sb_publishable_…` to Kong); `generation.spec.ts` passes in `e2e`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Realign the developer machine and document

### Overview

Put the developer machine on CI's images. Then write down where the stack's images come from and how
a re-link brings the drift back, so the next reader doesn't rediscover it.

### Changes Required:

#### 1. Realign the local stack (not committed)

**Files**: `supabase/.temp/{postgres,rest,gotrue}-version` (gitignored)

**Intent**: Remove the link-time image overrides so the local stack runs the lockfile CLI's
defaults, the same images CI runs. Do it reversibly.

**Contract**:

1. `pnpm exec supabase stop`, which keeps the data volume.
2. Move the three files into `supabase/.temp/link-snapshot-2026-06-12/`. Leave `project-ref`,
   `linked-project.json`, `pooler-url` and the storage files in place, so `db push` keeps working.
3. `pnpm exec supabase start`.

Every move is forward (Postgres 17.6.1.121 → .167, PostgREST v14.5 → v16.2, GoTrue v2.189.0 →
v2.196.0), so the existing volume should boot. If Postgres refuses it:

- move the three files back, start, and stop the phase for a decision;
- do not run `supabase stop --no-backup` without asking, because it destroys local data and the
  provisioned machine and e2e users.

#### 2. README

**File**: `README.md`

**Intent**: Record the image-source rule and the realignment step where a developer looks when the
local stack misbehaves.

**Contract**:

- **Supabase › Local development (`:404-411`):** add a short paragraph.
  - The stack runs the image tags the lockfile's CLI defaults to, which are the same ones CI runs.
    So whatever moves `supabase` in `pnpm-lock.yaml` (a `package.json` bump or a `pnpm update`)
    moves the images.
  - `supabase link` writes `supabase/.temp/*-version`, a snapshot of hosted's versions at link time.
    On that machine only, those files then override the defaults.
  - To match CI, move `postgres-version`, `rest-version` and `gotrue-version` aside and restart.
  - Re-linking writes them again.
- **Hosted project (`:420-425`):** add one line under the link snippet pointing at that paragraph.
- **CI / CD items 2 and 3 (`:378-379`):** add a clause saying the stack runs on the lockfile's CLI
  and exports `sb_publishable_` / `sb_secret_` keys, asserted before the solver boots.

#### 3. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Warn the next person who bumps `supabase` that the bump also changes CI's container
images.

**Contract**: Extend the CI-stack bullet (`:53`) with one clause. The stack runs the lockfile's CLI
through `pnpm exec supabase`, so any change to `supabase`'s resolved version in `pnpm-lock.yaml`
changes CI's images in the same commit. That includes a `package.json` bump and also a plain
`pnpm update`, because the range is `^2.117.0` (`package.json:92`) and Dependabot doesn't cover npm.

#### 4. Roadmap baseline

**File**: `context/foundation/roadmap.md`

**Intent**: The Baseline's "Deploy / infra" line (`:82`) describes the state this change removes.

**Contract**: Replace "exports the legacy anon JWT as `SUPABASE_KEY` and runs an unpinned Supabase
CLI" with the new state: production's key formats, asserted, on the lockfile's CLI. Status fields
are owned by `/10x-implement` and `/10x-archive`; don't touch them here.

### Success Criteria:

#### Automated Verification:

- [ ] Local images match CI: `docker ps --format '{{.Image}}'` lists `…/postgres:17.6.1.167`, `…/postgrest:v16.2` and `…/gotrue:v2.196.0`
- [ ] Only the storage override remains: `ls supabase/.temp/*-version` lists `storage-version` alone
- [ ] Integration lane passes locally with the solver up (`mise run solver:dev`, per README): `pnpm test:integration`
- [ ] Formatting holds: `pnpm exec prettier --check README.md CLAUDE.md` (`context/` is prettier-ignored, so `roadmap.md` is not checkable here)

#### Manual Verification:

- [ ] `pnpm build && pnpm preview`: sign in, open a plan, drag one placement; the app works on PostgREST v16.2 and GoTrue v2.196.0
- [ ] One local Generate end to end with `mise run solver:dev` up: the solver's claim and per-stage progress writes work on PostgREST v16.2
- [ ] The README paragraph reads correctly to someone who has never run `supabase link`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- None new. The only TypeScript change is an error message, and `pnpm test` stays green.

### Integration Tests:

- The four CI test jobs are the integration test for this change. Each phase's commit gets its own
  observed run.
- **Drills run the committed bytes, not a copy.** Extract each body from the committed action with
  `yq '.runs.steps[] | select(.name == "<step name>") | .run' .github/actions/supabase-stack/action.yml > <scratch>/step.sh`
  and run it as `shell: bash` does: `bash --noprofile --norc -eo pipefail <scratch>/step.sh`.
  Inject a case by setting env vars, never by editing the extracted script. For the version step's
  mismatch case, that means pointing `SUPABASE_CLI_BINARY_OVERRIDE` (honoured by the npm shim,
  `node_modules/supabase/dist/supabase.js`) at a stub that prints `0.0.0`.
- **Assertion drill (Phase 2).** Replay the assert step's body locally, against
  variables built from the local stack's `status` output with the same overrides and the same
  four-name filter (which should leave exactly four lines). No value is ever echoed.
  - (a) all four exactly as CI exports them: exit 0, four lines, no value characters;
  - (b) `SUPABASE_KEY` set to the stack's legacy `ANON_KEY`: exit 1, naming `SUPABASE_KEY` and
    `sb_publishable_`;
  - (c) `SUPABASE_SERVICE_ROLE_KEY` set to the legacy `SERVICE_ROLE_KEY`: exit 1, naming it and
    `sb_secret_`;
  - (d) `SUPABASE_DB_URL` unset: exit 1, naming it;
  - (e) (b) and (d) together: one run names both, which proves the check collects every failure
    before exiting.
- **Version-step drill (Phase 1).** Run it from the repo root (pass), with the binary answering
  `0.0.0` through `SUPABASE_CLI_BINARY_OVERRIDE` (fail, both versions named), and from a directory
  without `node_modules` (fail, setup action named).

### Manual Testing Steps:

1. Push the phase-1 commit to a draft PR. Confirm the CLI version line and the three 2.117.0 image
   tags in the integration log, and that all four test jobs are green.
2. Push the phase-2 commit. Read "Assert Supabase env" in both lanes for names, prefixes and lengths
   only, and confirm the solver-touching suites and `generation.spec.ts` pass.
3. Realign locally, confirm the `docker ps` tags, then run the integration lane, a
   `pnpm build && pnpm preview` smoke, and one local Generate.

## Performance Considerations

Dropping `setup-cli` removes its Bun download and npm install, about 4.7 s per stack lane.
`pnpm exec` adds nothing measurable. The e2e critical path (~393 s) shifts only by that saving.

## Migration Notes

- **No schema or hosted change.** Merging deploys the Worker and rolls the container like any merge,
  so the no-solve-running rule applies.
- **Rollback:** revert the commits. CI returns to `setup-cli` on `latest` and the legacy keys.
  Locally, move the three files back from `supabase/.temp/link-snapshot-2026-06-12/` and restart.
  That restores the files, not the data. Once the new images have booted on the existing volume,
  GoTrue v2.196.0 has migrated the `auth` schema forward (`start` mounts the volume as-is, with no
  tag check). An older GoTrue on that schema probably works, but nothing guarantees it. If it
  doesn't, the data fallback is `pnpm exec supabase db reset`, then the two provision scripts
  (`scripts/provision-solver-user.mjs`, `scripts/provision-e2e-author.mjs`). That is a reset, so
  ask first, the same rule as `--no-backup`.

## References

- Research: `context/changes/ci-publishable-key-and-pinned-cli/research.md`
- Parent research: `context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/research.md:488-604`
- Roadmap item: `context/foundation/roadmap.md` § F-402
- Pin-and-assert precedent: `.github/workflows/ci.yml:67-89` (shellcheck)
- CLI already on the lockfile in CI: `.github/workflows/ci.yml:372-375` (deploy)
- Drill precedent: `context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/plan.md` Phase 3

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Pin the CLI to the lockfile

#### Automated

- [x] 1.1 No `setup-cli` reference remains — 7f98451
- [x] 1.2 Every CLI call in the action goes through pnpm — 7f98451
- [x] 1.3 Version-step drill passes, and fails on a mismatch and on a missing install — 7f98451
- [x] 1.4 Formatting holds: `pnpm exec prettier --check .github` — 7f98451
- [x] 1.5 Local CI gate passes: `/verify` — 7f98451

#### Manual

- [x] 1.6 All four test jobs green on the phase-1 commit — 7f98451
- [x] 1.7 Integration log shows CLI 2.117.0 and its three default image tags — 7f98451

### Phase 2: Switch both keys and assert at the producer

#### Automated

- [x] 2.1 No legacy wiring remains
- [x] 2.2 Assertion drill cases (a)–(e) behave as specified and are recorded in `change.md`
- [x] 2.3 Types check: `pnpm check`
- [x] 2.4 Lint passes: `pnpm lint`
- [x] 2.5 Unit lane passes: `pnpm test`
- [x] 2.6 Formatting holds
- [x] 2.7 Local CI gate passes: `/verify`

#### Manual

- [ ] 2.8 All four test jobs green on the phase-2 commit
- [ ] 2.9 "Assert Supabase env" logs show names, lengths and prefixes only, in both lanes
- [ ] 2.10 Solver-touching suites and `generation.spec.ts` pass on the publishable key

### Phase 3: Realign the developer machine and document

#### Automated

- [ ] 3.1 Local images match CI
- [ ] 3.2 Only the storage override remains in `supabase/.temp`
- [ ] 3.3 Integration lane passes locally with the solver up
- [ ] 3.4 Formatting holds

#### Manual

- [ ] 3.5 `pnpm build && pnpm preview` smoke on the realigned stack
- [ ] 3.6 One local Generate end to end on PostgREST v16.2
- [ ] 3.7 README paragraph reads correctly to a never-linked reader
