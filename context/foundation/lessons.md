# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Port the mechanism, not the legacy type shape

- **Context**: Any pure core/engine that consumes domain data — whether ported from external/legacy code or written greenfield — where app-native types (e.g. generated `Database` types) already exist.
- **Problem**: Porting the legacy type shape verbatim creates a parallel domain that must be mapped to/from the real types; identity and display get conflated and bugs hide at the mapping boundary (e.g. output carried display names but persistence needed course IDs, with no bridge).
- **Rule**: When porting external logic, model the core on the app's own domain types (a projection of the generated types), not the legacy type shape. Port the mechanism — keep identity as opaque tokens, keep display concerns at the edges, and let the type system encode invariants (e.g. nullable over sentinels).
- **Applies to**: research, plan, plan-review

## Use semantic theme tokens, never hardcoded color/value Tailwind classes

- **Context**: All UI components and pages (`src/components/**`, `src/pages/**`). The theme is token-driven via `@theme inline` in `src/styles/global.css` (--color-background, --color-foreground, --color-destructive, …), with light/dark values set in `:root` / `.dark`.
- **Problem**: Hardcoded color/value-specific utilities (`bg-white`, `text-gray-700`, `bg-red-100`, `border-slate-300`, `bg-[#...]`) bypass the token system, so a theme change can't be made by editing `global.css` alone and light/dark drift apart. Example: the pre-existing `src/components/ui/LibBadge.astro` hardcodes `bg-blue-900/50` / `text-purple-200`, which won't follow the theme.
- **Rule**: Style with semantic tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-accent`, `bg-secondary`, `border` → `border-border`, `ring-destructive`, `bg-destructive/10`, …) so the entire light/dark theme is driven by adjusting `:root`/`.dark` values in `global.css`. Never introduce palette-named (`gray-`, `slate-`, `red-`, …) or arbitrary (`bg-[#..]`) color utilities in component markup. Prefer DS components (shadcn) which are already token-based.
- **Applies to**: implement, impl-review, plan-review

## Two mutation styles, split by purpose: Astro Actions for form CRUD, API routes for realtime hot paths

- **Context**: Any feature that writes to Supabase. The project has two valid server-mutation mechanisms and they are chosen by purpose, not by which was written first. Decided during `course-catalog` (S-02), the first CRUD feature.
- **Problem**: Picking the wrong one creates either needless boilerplate (hand-rolling typed clients + validators + fetch wrappers + `json()` helpers per entity, as S-01 does) or needless friction (forcing an optimistic realtime drag-drop path through a form-shaped Action). Mixing them without a rule reads as accidental inconsistency.
- **Rule**: **Form-based catalog/entity CRUD → Astro Actions** (`src/actions/`, `defineAction` + Zod `input`), called from React islands via `import { actions } from 'astro:actions'`; client forms use **react-hook-form + `@hookform/resolvers/zod` + shadcn `<Form>`/`<Table>`/`<Dialog>`**, with the **Zod schema shared from `src/lib/schemas/`** between the action `input` (authoritative server gate) and the form resolver. Forms use **`mode: "onTouched"`** — a field validates against the shared schema when first blurred, then re-validates live as the user types (RHF's default `reValidateMode: "onChange"`); no validation noise before a field is touched, and server `isInputError` field mapping on submit backs it up. **Realtime / optimistic mutation hot paths** (drag-drop placements, grouping compute) **→ stay as `src/pages/api/*.ts`** routes (e.g. `placements.ts`, `grouping.ts`) — do NOT migrate them to Actions. Validation lib is **Zod 4**, imported as `import { z } from 'zod'` from a pinned direct dep (`zod@^4`) that is version-aligned with the copy Astro bundles (`astro/zod` is Zod 4) — `@hookform/resolvers` peer-depends on `zod`, so the direct dep is required regardless. After install, verify a single runtime Zod copy reaches the app with `pnpm why zod` (a stray Zod 3 may exist dev-only via tooling and is harmless). Adopting Actions does not require retrofitting the existing API routes.
- **Applies to**: plan, plan-review, implement, impl-review
