---
change_id: astro-migration-to-v7
title: Astro migration to v7
status: archived
created: 2026-07-03
updated: 2026-07-03
archived_at: 2026-07-03T09:06:58Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Migration of the Astra framework to version 7 with companion libraries 
https://docs.astro.build/en/guides/upgrade-to/v7/

The `minimumReleaseAgeExclude` entries added to `pnpm-workspace.yaml` (astro@7.0.6, @astrojs/cloudflare@14.1.1, @astrojs/react@6.0.1, + 2 transitives) are a **transient** cooldown bypass: they let the fresh majors install under the dev's global `minimumReleaseAge` policy (the key itself is not in-repo, so these excludes are inert for CI). Safe to drop once the versions age past the release-age window.