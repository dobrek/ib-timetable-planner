# Clone Plan Without Board — Plan Brief

> Full plan: `context/changes/clone-plan-without-board/plan.md`
> Research: `context/changes/clone-plan-without-board/research.md`

## What & Why

Cloning a plan today is always a full deep copy — catalog **and** board. This change adds a **catalog-only** option: copy the reusable inputs (teachers, students, courses with their colors/rules/bi-weekly config, availability, choices) while resetting the board (placements, groupings, bundles) to empty. It lets an author reuse a scenario's catalog as a fresh starting point without hand-re-entering it.

## Starting Point

`clone_plan` is a single plpgsql RPC (latest live: `20260711133933_…`) that deep-copies a plan under a new `plan_id`, copying catalog in blocks 2–6 and board in blocks 6b–11. It's surfaced by one Clone dialog in the `plans-list` slice. A plan owns its catalog (composite `(plan_id, id)` FKs), and FK direction is strictly one-way — board depends on catalog, never the reverse.

## Desired End State

The Clone dialog gains an "Include board" toggle (default on). On → today's behavior exactly (warm board). Off → a catalog-only clone that opens on an empty-but-interactive board showing the standard "Compute groupings" empty state — the same cold-start as a freshly created blank plan, one click per cohort from ready.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Approach | Param on the existing RPC | One code path avoids doubling the clone-amendment maintenance tax vs. a forked RPC. | Research |
| Catalog boundary | Availability, colors, finishes-early rules, `week_mode` all travel | Only the placement grid, groupings, and bundles are board; everything else is plan-owned catalog. | Research |
| UX surface | Toggle in the existing Clone dialog | Smallest change, matches the one-code-path approach — no second menu entry or dialog variant. | Plan |
| Clone name | Keep `"{name} (copy)"` for both modes | No dynamic-suffix form logic; simplest. | Plan |
| Empty-board landing | Rely on the existing `ComputeGroupingsEmptyState` | Research confirms this is the correct cold-start, not a broken state — zero new UI. | Plan |
| Test coverage | Extend the RPC integration test | Covers the load-bearing guard and stands as a check against a future board table copied outside it. | Plan |
| Migration safety | Drop the 2-arg function before creating the 3-arg one | `create or replace` with a new param makes an ambiguous overload, not a replacement. | Research |

## Scope

**In scope:** `include_board boolean default true` param + guard in `clone_plan`; types regen; `includeBoard` Zod field; RPC wrapper arg + `refreshCatalogHash` short-circuit; dialog `Switch` + reworded description; one integration test case.

**Out of scope:** a second RPC or menu item; name-prefill changes; first-load hints/toasts or navigation changes; new tables/columns; dialog unit test; perspective-view changes.

## Architecture / Approach

Thread one boolean from the dialog toggle → Zod input → RPC wrapper → `clone_plan`. The RPC wraps only board blocks 6b–11 in `if p_include_board then … end if;`; the one-way FK topology makes that cut structurally safe (no dangling FKs, no NOT-NULL violation). Default `true` keeps the whole change additive — existing callers and the default toggle state reproduce current behavior. Catalog-only is actually *safer* than the full clone: with no grouping rows there's no `catalog_hash` to keep fresh, so the palette's compute-empty-state enumerates cleanly against the clone's own course UUIDs.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database (+ types + test) | Migration adding the guard, regenerated types, catalog-only integration test | Overload ambiguity if the 2-arg function isn't dropped first; copying a stale RPC body |
| 2. App layer | `includeBoard` schema field, RPC-wrapper arg + hash short-circuit, dialog toggle + copy | Toggle not threaded to the RPC; misleading dialog description |

**Prerequisites:** Local Supabase stack running for `pnpm test:integration` (`pnpm exec supabase start`); `supabase gen types` available for the regen.
**Estimated effort:** ~1 focused session across 2 phases (research estimated "a few hours").

## Open Risks & Assumptions

- Assumes the migration full-body-copies the *latest live* `clone_plan` (`20260711133933`) and preserves `security invoker` + `set search_path = ''` — copying an older body would regress carried columns (lessons.md rule).
- Assumes the empty-board cold-start is acceptable UX with no added hint (validated by research; confirmed as the chosen approach).
- The `refreshCatalogHash` short-circuit is a minor optimization; leaving it as a no-op would also be correct.

## Success Criteria (Summary)

- Author can clone with "Include board" off and land on a catalog-complete plan with an empty, interactive board.
- Full-clone behavior (toggle on) is byte-for-byte unchanged — existing integration tests still green.
- The catalog-only clone is independent of its source and copies the catalog in full with all six board tables empty (integration test).
