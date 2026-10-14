---
change_id: ci-publishable-key-and-pinned-cli
title: CI on the publishable key and a pinned Supabase CLI (F-402)
status: implementing
created: 2026-10-14
updated: 2026-10-14
archived_at: null
---

## Notes

Roadmap item F-402 (`context/foundation/roadmap.md` § F-402). Every CI lane should reach its ephemeral Supabase stack with the key format production uses — `SUPABASE_KEY` is `sb_publishable_…`, asserted in CI rather than assumed — on a Supabase CLI pinned in step with `package.json`. Unlocks S-409.

Open unknowns for the plan phase (both non-blocking): whether the service-role variable also moves to `sb_secret_…` here (touches 36 integration suites, `scripts/provision-*.mjs`, `bench/`), and the pin mechanism (`setup-cli` `version:` kept in step by hand vs. the lockfile's CLI via `pnpm exec supabase`).

Prior research: `context/archive/2026-10-12-give-integration-lane-a-signed-in-client-per-role/research.md` (follow-up "Why CI exports the legacy anon key").
