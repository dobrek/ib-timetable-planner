# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Port the mechanism, not the legacy type shape

- **Context**: Any pure core/engine that consumes domain data — whether ported from external/legacy code or written greenfield — where app-native types (e.g. generated `Database` types) already exist.
- **Problem**: Porting the legacy type shape verbatim creates a parallel domain that must be mapped to/from the real types; identity and display get conflated and bugs hide at the mapping boundary (e.g. output carried display names but persistence needed course IDs, with no bridge).
- **Rule**: When porting external logic, model the core on the app's own domain types (a projection of the generated types), not the legacy type shape. Port the mechanism — keep identity as opaque tokens, keep display concerns at the edges, and let the type system encode invariants (e.g. nullable over sentinels).
- **Applies to**: research, plan, plan-review

## Use semantic theme tokens, never hardcoded color/value Tailwind classes

- **Context**: All UI components and pages (`src/_pages/**`, `src/shared/ui/**`, `src/pages/**`). The theme is token-driven via `@theme inline` in `src/app/styles/global.css` (--color-background, --color-foreground, --color-destructive, …), with light/dark values set in `:root` / `.dark`.
- **Problem**: Hardcoded color/value-specific utilities (`bg-white`, `text-gray-700`, `bg-red-100`, `border-slate-300`, `bg-[#...]`) bypass the token system, so a theme change can't be made by editing `global.css` alone and light/dark drift apart. Example: the pre-refactor sign-in form components hardcoded `bg-white/10`, `bg-purple-600`, and `text-red-300`, which won't follow the theme.
- **Rule**: Style with semantic tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-accent`, `bg-secondary`, `border` → `border-border`, `ring-destructive`, `bg-destructive/10`, …) so the entire light/dark theme is driven by adjusting `:root`/`.dark` values in `global.css`. Never introduce palette-named (`gray-`, `slate-`, `red-`, …) or arbitrary (`bg-[#..]`) color utilities in component markup. Prefer DS components (shadcn) which are already token-based.
- **Applies to**: implement, impl-review, plan-review

## Astro Actions are the single transport for app-data mutations and compute

- **Context**: Any feature that writes to Supabase or runs server-side compute that persists results (catalog CRUD, drag-drop placements, grouping enumeration). Decided during `architecture-refactor` Phase 5 after the FSD migration unified transport.
- **Problem**: Splitting mutations across hand-rolled `fetch("/api/…")` routes and Astro Actions duplicates validation, auth guards, error translation, and client wrappers — and reads as accidental inconsistency once Actions proved viable for optimistic hot paths too.
- **Rule**: **All app-data mutations and compute → Astro Actions** (`src/actions/` composition barrel, `defineAction` + Zod `input` in `_pages/*/api/`), called from React islands via `import { actions } from 'astro:actions'`. Handlers follow the thin orchestration pattern: `requireSession` → `requireSupabase` → `runDomain(() => domainFn(supabase, input))`. Domain functions live in `_pages/*/api/` (framework-free, throw `DomainError`; action layer translates to `ActionError`). **API routes (`src/pages/api/*.ts`) are reserved only for raw Request/Response needs** — webhooks, external/non-Astro consumers, streaming, file downloads, and **auth session endpoints** (`signin`/`signout` keep progressive enhancement and stay as API routes). Form-based CRUD additionally uses **react-hook-form + `@hookform/resolvers/zod` + shadcn `<Form>`/`<Table>`/`<Dialog>`**, with the **Zod schema shared** between the action `input` (authoritative server gate) and the form resolver. Forms use **`mode: "onTouched"`** — a field validates when first blurred, then re-validates live (`reValidateMode: "onChange"`); server `isInputError` field mapping on submit backs it up. Validation lib is **Zod 4**, imported as `import { z } from 'zod'` from a pinned direct dep (`zod@^4`) version-aligned with Astro's bundled copy.
- **Applies to**: plan, plan-review, implement, impl-review

## Detokenize shadcn primitives on add — the CLI ships literal colors

- **Context**: Newly-scaffolded shadcn UI primitives under `src/components/ui/*` (e.g. `button`, `badge` destructive variants; `dialog`/`alert-dialog` overlays). Added during `course-catalog` (S-02).
- **Problem**: Stock shadcn CLI output contains literal colors — `text-white` on `destructive` variants and `bg-black/50` modal scrims — that bypass the token system and violate the semantic-tokens rule. The theme can't be driven from `global.css` alone and light/dark can drift, even though the *authored* component code was token-clean.
- **Rule**: When adding shadcn primitives, audit the generated output for literal/palette colors and detokenize before committing: `text-white` → `text-destructive-foreground`, `bg-black/50` scrims → a `bg-overlay` token. If the token is missing, add it to `global.css` (`:root` + `.dark` + the `@theme inline` `--color-*` map) first. Never leave literal colors even in vendored primitives. See the semantic-theme-tokens rule above.
- **Applies to**: implement, impl-review

## Catalog CRUD integration tests belong in the test harness

- **Context**: Plan Testing Strategy sections for catalog slices (`courses`, `teachers`) that list CRUD integration tests.
- **Problem**: Plan Testing Strategy lists teacher CRUD integration tests (create→read→update→delete, SET NULL cascade). No dedicated integration test file exists; Phase 2.3 marked complete via manual verification only.
- **Rule**: When a plan's Testing Strategy lists integration tests for catalog CRUD, implement them in the integration test harness before marking integration success criteria complete. Manual sign-off alone is insufficient unless the plan explicitly defers integration tests to a follow-up change.
- **Applies to**: implement, impl-review

## Guard `localStorage` with try/catch, not just a `typeof window` check

- **Context**: Per-device cosmetic preference helpers that read/write `localStorage` from React islands or Astro layouts (e.g. `src/_pages/plan-detail/lib/drag-hint-mode.ts` for the drag-hint encoding; the existing `theme` / `sidebar-collapsed` inline-script reads).
- **Problem**: A `typeof window !== "undefined"` guard only proves we're on the client — it does NOT stop `getItem`/`setItem` from throwing. Safari private mode, storage disabled by policy, or an exceeded quota all raise and crash the read (or the write path). The `theme`/`sidebar-collapsed` precedents guard only `typeof window`, so copying them verbatim inherits the gap.
- **Rule**: Wrap every `localStorage` `getItem`/`setItem` in `try/catch` on top of the `typeof window` guard; on failure degrade silently to the in-code default (reads) or a no-op (writes). When a React island must react to the value, pair it with `useSyncExternalStore` (server-snapshot = default) so hydration stays deterministic.
- **Applies to**: implement, impl-review, plan-review

## Granting a role is not excluding the others — revoke Supabase's auto-grant for real least privilege

- **Context**: Supabase/Postgres GRANT migrations that pin table reachability per role (e.g. `grant ... to authenticated`). Supabase auto-grants BOTH `anon` and `authenticated` full DML on every new `public` table at creation time.
- **Problem**: A migration that grants `authenticated` and comments "anon is intentionally excluded (least privilege)" does NOT exclude `anon` — the pre-existing auto-grant to `anon` is still in place because it was never revoked. The table stays anon-reachable at the GRANT layer; only RLS (a policy that happens to omit `anon`) blocks it, so the defense-in-depth claim is false and a later RLS loosening silently exposes the table. Verified live in `testing-auth-actions-boundary-rls`: after the "anon excluded" grant migration, `has_table_privilege('anon','public.plans','INSERT')` was still `true`.
- **Rule**: To exclude a role at the GRANT layer you must `revoke ... from <role>` AND `alter default privileges ... revoke ... from <role>` (current + future tables) — *not granting* it is insufficient once Supabase has auto-granted it. Keep the two locks distinct: GRANT controls whether a table is reachable at all; RLS controls which rows are visible. Never let a migration comment claim grant-layer exclusion that is actually enforced only by RLS. Confirm the real posture with `has_table_privilege(...)`, not by reading the migration text.
- **Applies to**: plan, plan-review, implement, impl-review

## Green build/test/lint ≠ type-safe — `astro check` is the mandatory type gate

- **Context**: CI/verify gating and any plan that lists a "type-check" success criterion. The toolchain is esbuild-based (Vite/Astro build + Vitest transform) with a flat ESLint config; `astro check` (`@astrojs/check` + `typescript`) is the only checker wired anywhere, exposed as `pnpm check` and run in CI's `verify` job (after `astro sync`), on lefthook `pre-push`, and inside `/verify`.
- **Problem**: esbuild *strips* types and transpiles per-file with no cross-file inference, so `pnpm build` and `pnpm test` emit/run valid JS over a program riddled with type errors; the flat ESLint config doesn't enable the type-aware rules that would flag assignability/inference failures, and `astro sync` only generates `.astro/types.d.ts` without checking. None of these type-check. For a long stretch nothing in the repo ran the TS checker at all, and later plans substituted `pnpm build`/`pnpm lint` as a fake "type-check" proxy — so 16 genuine type errors across 11 files accumulated silently behind a fully green CI. Verified in `ci-tsc-audit`: `pnpm exec astro check` reported 16 errors while build/test/lint were clean.
- **Rule**: Treat build/test/lint passing as **no evidence** of type safety. The only valid type-check gate is `pnpm check` (`astro check`) — it type-checks `.astro` + `.ts`/`.tsx`, strictly dominating bare `tsc`, and must run *after* `astro sync` (it consumes the synced types). Never cite `pnpm build` or `pnpm lint` as a type-check in a plan's success criteria; cite `pnpm exec astro check` (or `pnpm check`). Keep the gate wired in CI, pre-push, and `/verify` so the class can't recur.
- **Applies to**: plan, plan-review, implement, impl-review

## Prefer declarative pipelines over imperative accumulator loops

- **Context**: Pure selection/search/ranking/transform logic in `_pages/*/model/` and shared pure helpers — any function that walks a collection to pick, rank, or reshape elements (e.g. `duplicate-target.ts`, the drop-hint/collision derivations).
- **Problem**: An imperative loop with mutable `let` accumulators and `??=`/reassignment buries the intent under bookkeeping — the reader reconstructs "what is this selecting?" from mutation order, the spec is hard to verify against, and off-by-one / early-exit bugs hide easily. Concrete: `findDuplicateTarget`'s first cut used one `for` loop with two `let` accumulators (`strictlyFree`/`nonBlocking`) + `??=`, tangling the two-tier preference and the scan-order math in the loop body.
- **Rule**: Express selection/ranking as declarative composition of small, named, pure pieces — `filter`/`find`/`map` + `??` fallback — so the body reads like its spec (e.g. `empty.find(strictlyFree) ?? empty.find(nonBlocking)`). Extract predicates (especially type guards like `isNonBlocking`) and index/order construction (`rotatedColumnMajor`) into named helpers; keep everything `const` (no mutable accumulators, no reassignment); prefer clarity over micro-optimizing small collections (a few short passes over ≤~100 items is fine); preserve newspaper order (exported function first, helpers below).
- **Applies to**: implement, impl-review, plan-review

## A convention that cites a code mechanism is coupled to it — verify the symbol, and update the doc when the refactor deletes it

- **Context**: Convention/amendment prose and its in-code copies that cite *concrete mechanisms* — hook names, component names, frequency/perf claims — as the **rationale** for a rule (e.g. `ui-conventions.md` §"State management" + the `PlannerGrid.tsx` docblock, which cited `useCellWiring`, `PairedPlannerGrid`, and "changes every drag tick"). Also any research/frame/plan/change note that *consumes* that rationale downstream.
- **Problem**: A later refactor that deletes or renames the cited mechanism does not include the convention text in its diff, so the rule silently goes stale — it now reads arbitrary and, worse, propagates **false premises** into new artifacts that cite it in good faith. Concrete: `unify-views` deleted `useCellWiring`/`PairedPlannerGrid` and reduced `dropHints` to a set-once-per-drag value, but the `plan-detail-refactor` amendment kept all three claims; `board-view-state-store/change.md` then inherited three false premises (a 5-hop chain, a memoized wiring hook, per-tick re-renders) verbatim from the stale text before the frame caught them.
- **Rule**: When writing OR consuming a convention amendment that cites concrete code mechanisms, verify each cited symbol still exists (**grep, not memory**) before relying on it. When a refactor deletes or renames a mechanism a convention cites, updating that convention **and its in-code copies** is part of that refactor's definition of done — a doc that names a mechanism is coupled to it. Prefer rationale stated as an invariant (broadcast fan-out) over one pinned to a mutable measurement (a per-tick frequency), and cite `file:line` so the next reader can re-verify cheaply.
- **Applies to**: research, frame, plan, plan-review, impl-review
