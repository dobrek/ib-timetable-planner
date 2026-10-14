# CI on the Publishable Key and a Pinned Supabase CLI (F-402) — Plan Brief

> Full plan: `context/changes/ci-publishable-key-and-pinned-cli/plan.md`
> Research: `context/changes/ci-publishable-key-and-pinned-cli/research.md`

## What & Why

CI is the only environment still on Supabase's legacy HS256 keys, and its CLI floats to `latest` by
accident. This change moves every CI stack to the key formats production uses (`sb_publishable_…`
and `sb_secret_…`), checks those formats rather than assuming them, and runs the lockfile's CLI. The
CI tests for S-409's secret-holding component can then see the request shapes production sends.

## Starting Point

- **The CLI floats.** `supabase/setup-cli` v3.0.1 is supposed to read the lockfile, but pnpm 12
  writes a two-document `pnpm-lock.yaml`, which defeats its parser. So it silently installs
  `latest` (2.120.0 today, against 2.117.0 everywhere else).
- **The keys are legacy, and nothing checks them.** The composite action exports the deprecated
  `anon_key` and `service_role_key` fields. `status --override-name` drops a typo without an error,
  and the only gate (`load-test-env.ts`) checks presence, covers integration only, and runs after
  the solver boots.
- **Your machine runs neither set of images.** Its images come from a June-2026 `supabase link`
  snapshot in `supabase/.temp`.

## Desired End State

- The composite action runs `pnpm exec supabase`, and its first step proves the binary is the
  lockfile's version.
- An "Assert Supabase env" step fails either CI lane before anything consumes the env if:
  - any of the four exported variables is empty, or
  - either key has the wrong prefix.
- It prints only names, prefixes and lengths.
- The dead `export-anon-key` input is gone.
- Your local stack runs exactly CI's images. README and CLAUDE.md say where images come from and
  what a re-link or a `supabase` bump changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Service-role value | Switch to `sb_secret_…`, keep the name `SUPABASE_SERVICE_ROLE_KEY` | One override line; local and hosted already use it; the probe found it behaving the same as the legacy JWT; none of the 44 readers changes. | Research → Plan |
| Pin mechanism | `pnpm exec supabase`, drop `setup-cli` | Zero drift by construction, one fewer remote action, and `deploy` already does it. | Research → Plan |
| Assertion scope | Key prefixes, all four vars present, and CLI version = installed package | Covers both silent fallbacks (`latest`, dropped override) at the producer, before both solvers. | Plan |
| Image parity | Document it, and realign your machine now | Your machine and CI end up on identical images; the README explains how a re-link brings drift back. | Plan |
| `export-anon-key` input | Drop it; always export | Both callers set it; removing it deletes an unused branch and an input-injection surface. | Plan |
| Rollout | Three commits, each CI-observed on a draft PR | A red build has exactly one candidate cause (images, keys, or neither). | Research (Open Q3) |
| Where the assertion lives | The composite action, not `load-test-env.ts` | It is the only point that runs before both lanes and both solvers. | Research |

## Scope

**In scope:**

- `.github/actions/supabase-stack/action.yml`: the pin, the key overrides, two assert steps,
  comments
- `ci.yml`: both callers and two comments
- the message in `src/test/load-test-env.ts`
- realigning the local `.temp` snapshot
- README, CLAUDE.md, and the roadmap baseline line

**Out of scope:**

- renaming the service-role variable
- mirroring hosted's images
- bumping the CLI
- migrating `[inbucket]` to `[local_smtp]` (2.117.0 already warns)
- the upstream `setup-cli` issue
- synonym wording in the runbooks
- `.env.test.local` docs
- `deploy`

## Architecture / Approach

The composite action becomes the single producer and gate for each lane's Supabase env:

1. Check the CLI version.
2. Regenerate the seed.
3. `pnpm exec supabase start`.
4. Export the four vars in production's formats.
5. Assert them.

Consumers (the native solver, the e2e `.dev.vars`, the integration harness) are unchanged, because
none of them inspects the key's format. The rollout runs pin → keys → docs, so each CI run isolates
one variable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pin the CLI to the lockfile | `pnpm exec supabase`, a version check, CI on 2.117.0's images | Images move backwards from 2.120.0's; 2.117.0 was green on them in September |
| 2. Switch both keys and assert | `sb_publishable_` / `sb_secret_`, the "Assert Supabase env" step, the input removed, comments corrected | A consumer that rejects the new formats; every one is format-agnostic today, and the four test jobs prove it |
| 3. Realign locally and document | Local images = CI's; README, CLAUDE.md, roadmap baseline | PostgREST v14.5 → v16.2 on your machine; reversible (files moved, not deleted) |

**Prerequisites:** a feature branch and a draft PR (each phase is observed on CI); the local
Supabase stack up for the drills; no production solve running at merge time.

**Estimated effort:** about one session, three commits, three CI runs of about 7 minutes each.

## Open Risks & Assumptions

- **The integration lane flakes about 1 run in 5** on transient 502s. Each red run gets one re-run
  before it is blamed on the diff.
- **Your existing Postgres volume** should boot on the forward image (.121 → .167). If it doesn't,
  the plan restores the snapshot and stops for a decision; it never runs `--no-backup` unasked.
- **Any future `supabase link`** brings the hosted snapshot, and the drift, back on that machine.
  This is documented, not prevented.

## Success Criteria (Summary)

- All four CI test jobs are green on each commit, and the logs show CLI 2.117.0, its image tags, and
  the asserted key prefixes (never values).
- No trace of the legacy key wiring or the `export-anon-key` input remains in `.github/` or `src/`.
- Your local `docker ps` shows the same three images as CI, and the app and one Generate work on
  them.
