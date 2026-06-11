# Multi-Variant Management (Plans as Cloneable Domain Root) — Plan Brief

> Full plan: `context/changes/multi-variant-management/plan.md`
> Research: `context/changes/multi-variant-management/research.md`

## What & Why

User conversations revealed that the real what-if axis is not placements within a plan but changes at the student/teacher level — effectively the whole catalog. So per-plan variants are removed entirely: a **plan becomes a complete, cloneable scenario** (catalog + board). "New draft" and "new catalog state" arrive together in practice, so cloning a whole plan — catalog, placements, groupings — becomes the primary way to start a new scenario.

## Starting Point

`plan_variants` exists as a table but is nearly dead code: no variant CRUD or UI anywhere, one seeded plan + variant, and `variantId` threaded through just 7 files in `plan-detail`. The catalog (teachers, courses, students, choices) is one global, un-versioned pool; the only scoping dimension is `cohort_id` via a 2-row `cohorts` table. There is no plan CRUD and no clone code. No production data exists.

## Desired End State

`/plans` is the application hub: a list of named scenarios with create-blank, clone (the primary path), rename, and delete. Opening a plan gives a plan-scoped workspace — board at `/plans/[id]`, catalog at `/plans/[id]/{courses,teachers,students}` — where every edit is isolated to that scenario. Cloning produces a warm, immediately usable copy. The hosted database carries the new schema.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Domain root | No `versions` table — `plans` absorbs the catalog | One noun, one level; "new draft" and "new data" coincide in real usage | Research |
| Cohorts | Drop table → native enum `'dp1' \| 'dp2'` | Fixed programme structure; enum union flows through generated types | Research |
| Cross-plan integrity | Composite FKs `(plan_id, id)` | Cross-plan references impossible at DB level; clone RPC fails loudly on missed remaps | Research |
| Clone depth | Full deep copy (catalog + placements + groupings), hash refreshed | Cloned plans open warm; catalog copies are tiny | Research |
| Route scoping | Nested routes `/plans/[id]/…`, no ambient cookie | Scope explicit in URL — shareable, multi-tab safe, zero hidden state | Research |
| "Final" mark | Dropped entirely | `is_final` was dead code; plans are peers | Research |
| Export ripple (FR-015/S-10) | Export **any** plan | Consistent with no-flags model; "adopted" marker is an additive column if ever needed | Plan |
| Hub metrics | **Deferred** — no valid/complete/used-slots badges | User: nice future extension, not needed now | Plan |
| Migration mechanics | One new destructive migration on top | Hosted history stays linear; `db push` works without repair surgery | Plan |
| Clone UX | Dialog with prefilled name → navigate into clone | Users name scenarios in their own vocabulary at the moment of intent | Plan |
| Delete UX | Confirm dialog with entity counts | Informed consent proportional to the cascade blast radius | Plan |
| Hub scope | Full set: create blank, clone, rename, delete | No orphan states — cold start, iteration, and cleanup all work | Plan |
| Hosted rollout | In scope, final phase | CI auto-deploys on merge; schema and code must not drift | Plan |

## Scope

**In scope:** PRD/roadmap amendment (FR-010/FR-014/FR-015/US-02, S-07/S-10) · destructive migration (drop `plan_variants` + `cohorts`, cohort enum, plan-owned catalog, composite FKs) · `clone_plan` RPC + integration tests · seed rewrite (two plans) · regenerated DB types · app re-keying (variant removal, enum, `planId` threading) · nested routes + nav/sub-nav · `/plans` hub with 4 actions · hosted `db push` + prod smoke.

**Out of scope:** hub comparison metrics (deferred) · any final/adopted marker · CSV export implementation (re-scoped S-10, built later) · cohort CRUD · RLS changes · ambient active-plan state · renaming algorithm-side `GroupingVariant` concepts.

## Architecture / Approach

`plans` becomes the single FK root; every catalog root gains `plan_id`, link tables denormalize it for composite FKs, and `cohort` becomes an enum value column. Scoping reaches the app through the URL: nested routes hand `planId` to loaders, and action Zod inputs carry it explicitly — no middleware or cookie machinery. The constraint core (`plan-detail/model/`) is untouched; the <200ms drag-drop budget is unaffected. Cloning is an atomic SQL RPC mirroring `replace_cohort_groupings`, with `catalog_hash` refreshed JS-side to keep a single hash implementation.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Foundation amendments | PRD + roadmap match what we're building | Missed "variant"/"final" language leaves docs inconsistent |
| 2. Schema + clone RPC + seed | New schema, `clone_plan`, two-plan seed, regenerated types | Build intentionally red until Phase 3 — must ship as one PR with it |
| 3. App adaptation | Variant removal, cohort enum, plan threading, nested routes — app fully working | Widest blast radius (~40 files); catalog isolation bugs |
| 4. Plans hub | Create/clone/rename/delete island with dialogs | Clone hash refresh — clones must open warm, not stale |
| 5. Hosted rollout | `db push` + production smoke | Old-code/new-schema window — push then merge promptly |

**Prerequisites:** local Supabase stack (Docker), linked hosted project, no in-flight branches touching the schema.
**Estimated effort:** ~4–5 implementation sessions; Phases 2+3 are one PR and the bulk of the work.

## Open Risks & Assumptions

- If one-board-per-catalog proves wrong later, re-introducing a board level is an additive migration (nullable `board_id`, backfill) — manageable, not free.
- Brief production breakage between hosted `db push` and CI deploy of new code — accepted (no users/data).
- Assumes `data/dp1|dp2/` fixture set is sufficient to seed two meaningful plans (second plan is a re-run of the same pipeline with fresh UUIDs).

## Success Criteria (Summary)

- An author can clone a plan from `/plans`, edit the clone's students/teachers/placements, and the source plan is provably untouched.
- A cloned plan opens warm — the groupings palette is usable immediately, no stale banner.
- Foundation docs, local schema, hosted schema, and shipped code all describe the same model; full CI gate green.
