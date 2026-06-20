---
change_id: data-for-e2e-and-integration-tests
title: Data for e2e and integration tests
status: archived
created: 2026-06-15
updated: 2026-06-20
archived_at: 2026-06-20T00:00:00Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **Phase 1 CI boot time (item 1.5):** trimmed `supabase start` measured **~82s** (incl. cold image pull) in CI run 27549794933; `test:integration` step itself ~5s. Judged not painful → **Docker-image caching not pursued** (per plan decision rule). Revisit only if the wall-time becomes painful.
- **Phase 1 CI gotchas (fixed in 106c4c3):** (1) `supabase status -o env` quotes values; `$GITHUB_ENV` keeps quotes literal → supabase-js rejects the URL. Strip with `| sed 's/"//g'`. (2) `supabase start -x` wants the CLI's container labels (`mailpit`, `storage-api`, `logflare`, `postgres-meta`, `supavisor`), not the docs aliases (`inbucket`/`storage`/`analytics`/`functions`/`meta`), which are silently ignored.
