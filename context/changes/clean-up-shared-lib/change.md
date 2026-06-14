---
change_id: clean-up-shared-lib
title: Clean up shared lib
status: implemented
created: 2026-06-14
updated: 2026-06-14
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 1 adaptations

- Postgrest imports go through the `@/shared/api` barrel, not deep `@/shared/api/postgrest` — Steiger's `fsd/no-public-api-sidestep` forbids deep imports into `shared/api` (only `shared/ui`/`shared/lib` are whitelisted). The plan's deep-import path was not viable.
- Added a Vitest stub for the `astro:env/server` virtual module (`test/stubs/astro-env-server.ts` + `vitest.config.ts` alias). The `api` barrel re-exports the env-reading `createClient`, so it can't be Vitest-safe by removal the way the `lib` barrel is; the stub lets unit-tested slice code import the barrel.

### Phase 2 adaptations + folder convention (decided with the author)

- `call-action` folded into the client-safe `forms/`, NOT `actions/` (the plan said `actions/`). `actions/` statically imports `createClient` (server-only via `astro:env/server`), so routing the client `*-client.ts` seams through it pulled a server-only module into client bundles (`[ServerOnlyModule]` build failure). `forms/` already consumes `call-action`'s `ActionCallResult` type, so it's the cohesive client home. Same count outcome.
- **Folder convention (applies to `shared/lib` + `shared/api/postgrest`)**: every folder is a thematic group; `index.ts` is a pure re-export barrel (no implementation); each export lives in its own concept-named file; tests sit next to their impl file. Adding a new util = a new file + one `index.ts` line (never edit an existing file). `catalog-hash/` was already the exemplar.
- Folder rename for descriptiveness: `cn/` → `class-names/` (the `cn` function name is kept; only the folder changed). Other folder names read descriptively and were left as-is.
