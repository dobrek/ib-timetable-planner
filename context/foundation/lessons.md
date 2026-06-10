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
