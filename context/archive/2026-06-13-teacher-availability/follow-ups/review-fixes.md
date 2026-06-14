# Review follow-ups — teacher-availability

Queued from the implementation review (`reviews/impl-review.md`, 2026-06-14).

## F3 — Regroup `shared/lib`, then move grid + slot-labels out of `shared/config`

**Origin:** impl-review finding F3 (Pattern Consistency / Plan Adherence, OBSERVATION).

**Goal.** `dayLabel`/`periodLabel` (`shared/config/slot-labels.ts`) are display helpers and
`parseGridPreset` (`shared/config/grid.ts`) is parsing logic — neither is a constant/enum, so
they belong in `shared/lib/`, not `shared/config/`. Plan item 1.6 originally targeted
`shared/lib/slot-labels/`.

**Blocker (why it wasn't done in the review).** `shared/lib` is at exactly 15 modules — the
ceiling enforced by steiger's `fsd/shared-lib-grouping` rule. The repo runs
`steiger --fail-on-warnings` as a CI gate, so adding `grid/` + `slot-labels/` (→ 17) fails the
build. The current `config` placement is a deliberate workaround for this cap. A trial move was
made during review and reverted to keep the tree green.

**Approach.**
1. First reduce the `shared/lib` top-level module count: group related loose modules into
   subfolders (each subfolder counts as one module), freeing ≥2 slots. Candidate groupings to
   evaluate — e.g. the postgrest/loaders/result data-access helpers, or the forms/call-action
   transport helpers.
2. Then move `grid.ts` → `shared/lib/grid/` and `slot-labels.ts` → `shared/lib/slot-labels/`
   (folder+index, mirroring `shared/lib/course-label`). Keep `grid-presets.ts` in `config`
   (genuine constants/enums); `grid/index.ts` then imports `DEFAULT_GRID_PRESET` from
   `@/shared/config` (lib → config is the natural direction).
3. Remove both from the `shared/config` barrel; repoint the importers:
   - grid symbols: `teachers/api/teacher-availability.ts`, `plan-detail/api/{load,placements,slot-bundles}.ts`, `pages/plans/[id]/teachers.astro`
   - slot-label symbols: `teachers/ui/TeacherAvailabilityDialog.tsx`, `plan-detail/ui/{PlannerGrid,CollisionDetailsDialog}.tsx`

**Acceptance.** `pnpm steiger` (no `shared-lib-grouping` warning), `pnpm lint`, `pnpm test`,
`pnpm build` all green; `shared/config` holds only constants/enums/schemas.
