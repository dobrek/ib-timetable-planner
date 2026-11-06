---
change_id: created-by-and-job-ownership
title: Created by and job ownership
status: implementing
created: 2026-11-06
updated: 2026-11-06
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **2026-11-06, Phase 2 review: the board header's creator is a tooltip, not a line.** The plan said the
  board header *shows* "Created by <credit>". The reviewer found the heading row too crowded, so the
  creator folds into a `UserRound` icon button after the plan name. Hover or keyboard focus shows a
  shadcn Tooltip with "Created by", then the name with the email beneath (FR-413). The button's
  `aria-label` is "Created by <name> (<email>)", so Phase 4's e2e can still match the author's email
  without hovering. Touch opens nothing; the hub's "Created by" column names every creator.
  - New primitive: `src/shared/ui/tooltip.tsx` (new-york-v4, `radix-ui`; already token-only). Its
    `Tooltip` brings its own provider, because each Astro island is its own React root.
  - `UserCredit` gained an `inverse` variant for the tooltip's inverted surface, and `entities/user`
    a `creditText` helper ("Name (email)" / email / "Unknown"), which Phase 3's stopper copy reuses.
  - The hub column is unchanged: still the stacked credit, always visible.
