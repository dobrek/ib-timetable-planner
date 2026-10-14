---
change_id: ci-publishable-key-and-pinned-cli
title: CI on the publishable key and a pinned Supabase CLI (F-402)
status: impl_reviewed
created: 2026-10-14
updated: 2026-10-14
archived_at: null
---

## Notes

Roadmap item F-402 (`context/foundation/roadmap.md` § F-402). Every CI lane should reach its ephemeral Supabase stack with the key format production uses — `SUPABASE_KEY` is `sb_publishable_…`, asserted in CI rather than assumed — on a Supabase CLI pinned in step with `package.json`. Unlocks S-409.

Open unknowns for the plan phase (both non-blocking): whether the service-role variable also moves to `sb_secret_…` here (touches 36 integration suites, `scripts/provision-*.mjs`, `bench/`), and the pin mechanism (`setup-cli` `version:` kept in step by hand vs. the lockfile's CLI via `pnpm exec supabase`).

Prior research: `context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/research.md` (follow-up "Why CI exports the legacy anon key").

## Assertion drill (2026-10-14)

Phase 2's "Assert Supabase env" step, proven to fail for the right reasons before CI depended on it. Both step bodies were extracted from the committed `.github/actions/supabase-stack/action.yml` with `yq` and run as `shell: bash` runs them (`bash --noprofile --norc -eo pipefail`). Cases were injected through env vars only, never by editing the extracted script.

**Setup.** The "Export Supabase env" body ran against the local stack (CLI 2.117.0), with `GITHUB_ENV` pointing at a scratch file. It exited 0 and wrote exactly four lines: `SUPABASE_DB_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL`. The filter kept every other `status` field out, the legacy `ANON_KEY` / `SERVICE_ROLE_KEY` JWTs included. That file was loaded as the assert step's environment. For (b) and (c), the legacy JWTs were read from an unfiltered `status -o env` into shell variables that were never printed.

| Case | Injection | Exit | Output |
| --- | --- | --- | --- |
| (a) | the four, as exported | 0 | four lines: each name with its length, `set` for the URLs, and the matched prefix for the keys (`sb_publishable_`, `sb_secret_`) |
| (b) | `SUPABASE_KEY` = legacy `ANON_KEY` | 1 | `SUPABASE_KEY: expected the sb_publishable_ prefix` |
| (c) | `SUPABASE_SERVICE_ROLE_KEY` = legacy `SERVICE_ROLE_KEY` | 1 | `SUPABASE_SERVICE_ROLE_KEY: expected the sb_secret_ prefix` |
| (d) | `SUPABASE_DB_URL` unset | 1 | `SUPABASE_DB_URL: expected a value, found none` |
| (e) | (b) and (d) together | 1 | both lines in one run, so the step collects every failure before exiting |

**No value appeared in any output.** Each case's combined stdout and stderr was checked by the driver before it was shown. The check covered all six values (the four exported and the two legacy JWTs), each key's random part after its prefix, the loopback host and the DB credentials. None matched.

## The runner prints exported values in step headers (CI, 2026-10-14)

On CI run 38563186955 (`fcbe9fd`), the "Assert Supabase env" step's own output in both lanes was exactly the four `NAME: prefix-or-set, N chars` lines, with no value characters. The log is still not value-free. GitHub's runner prints every `$GITHUB_ENV` variable in the `env:` header of each later step, this one included, outside any step's control. So the two key values appear there. The DB URL's credentials showed as `***`.

This was accepted as is and not masked:

- **It predates this change, and this change narrowed it.** On the phase-1 run (`7f98451`), the headers printed every `status` field:
  - the legacy JWTs, under `SUPABASE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`;
  - `JWT_SECRET`;
  - `PUBLISHABLE_KEY` and `SECRET_KEY`;
  - `REST_URL` and `GRAPHQL_URL`.

  After the four-name filter, they print only `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL`.
- **The values are public.** Both keys in CI were byte-identical to the local stack's (compared by match only, never printed). They are the CLI's fixed defaults, the same on every machine.
- **The plan's no-value rule is about the assertion's output, and that held.**

If a future stack ever carries a non-default key, the lever is `::add-mask::` on the value inside "Export Supabase env". The runner then prints `***` in every later header.
