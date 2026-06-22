---
date: 2026-06-22T00:00:00Z
researcher: Dobromir Kropielnicki
git_commit: 7777dffebe28554fd23ea15f53d0a921f1cb5df1
branch: main
repository: ib-timetable-planner
topic: "Feasibility of adding a tsc/astro check type-check step to CI and verify; why builds/tests pass while type-check fails"
tags: [research, ci, typescript, astro-check, type-safety, supabase, astro-actions]
status: complete
last_updated: 2026-06-22
last_updated_by: Dobromir Kropielnicki
---

# Research: Adding a type-check gate to CI/verify, and why 16 type errors hide behind green builds

**Date**: 2026-06-22
**Researcher**: Dobromir Kropielnicki
**Git Commit**: 7777dffebe28554fd23ea15f53d0a921f1cb5df1
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

> Check the feasibility of adding a `tsc` type-check step to our CI and verify process. Currently all builds and tests are green, but running type check we get an error. Understand why, and make sure it won't happen again.

Scope locked with the user: recommend **`astro check`** (not bare `tsc`) as the gate, and produce a **root-cause grouping of every error plus a fix plan**.

## Summary

- Running a real type-check (`pnpm exec tsc --noEmit` **or** `pnpm exec astro check`) surfaces **16 errors across 11 files**. Both checkers agree on the count.
- **Why builds and tests stay green:** neither `astro build` (Vite/esbuild) nor Vitest (also esbuild) performs type-checking — esbuild *strips* types and transpiles per-file without cross-file inference. The repo has **no type-check step anywhere**: not in CI (`.github/workflows/ci.yml`), not in the `/verify` skill, not in `lefthook`, and there is no `check`/`typecheck` npm script. So these are genuine, long-standing type errors that nothing has ever gated on.
- The 16 errors collapse into **4 root causes**, and **3 of them are single-file fixes** to shared helpers/factories — fixing those clears 14 of 16 errors. The remaining 2 are a one-line null-narrowing consequence and a one-line test annotation.
- **Feasibility: high and cheap.** `@astrojs/check@^0.9.9` and `typescript@^6.0.3` are already installed. The fix is: clear the 16 errors, add a `"check": "astro check"` script, and wire it into the CI `verify` job (right after `astro sync`) and the `/verify` skill. `astro check` is the right tool over bare `tsc` because it also type-checks `.astro` files.
- **Why it happened (the meta-cause):** earlier work *did* run `astro check` manually as a per-plan gate, but it was never automated, and later plans silently substituted `pnpm build` / `pnpm lint` as a "type-check" proxy — which does not actually type-check. Type errors accumulated unnoticed through that drift.

## The 16 errors, grouped by root cause

| # | Root cause | Files / errors | Fix locus |
|---|------------|----------------|-----------|
| **A** | `unwrapRow` generic infers `T` as `Row \| null`, never narrows | create-course:16, create-merge:65, create-student:16, create-plan:8, rename-plan:8, placements:70, placements:99 (7 errors) | `src/shared/api/postgrest/unwrap-row.ts` (1 file) |
| **B** | `defineDomainAction` handler fails Astro's conditional `ActionHandler` type → `TOutput` collapses to `unknown` | define-domain-action:19, :22 + downstream placement-client:15,:26 + plans-client:8,:10 (6 errors) | `src/shared/lib/actions/define-domain-action.ts` (1 file) |
| **C** | `unwrapMaybeRow` generic infers `T` as `never` from supabase-js result union | staleness:32 ×2 (2 errors) | `src/shared/api/postgrest/unwrap-maybe-row.ts` (1 file) |
| **D** | Test literal carries `pending`, which lives on `LocalSlotOverride`, not `SlotOverride` | slot-bundle.test.ts:42 (1 error) | test annotation (1 line) |

A, C share a family (generic inference from Supabase/PostgREST result shapes); B is independent; D is isolated test drift.

## Detailed Findings

### Root cause A — `unwrapRow` widens its generic to include `null` (7 errors)

`src/shared/api/postgrest/unwrap-row.ts`:

```ts
type RowResult<T> = { data: T; error: null } | { data: null; error: PostgrestError };

export function unwrapRow<T>(result: RowResult<T>, messages: RowMessages): T {
  if (result.error) throw toDomainError(result.error, messages);
  return result.data;
}
```

Supabase's `.single()` / `.update().select().single()` resolves to `PostgrestSingleResponse<Row>`, whose **static** shape is *not* a discriminated union — `data: Row | null` and `error: PostgrestError | null` are independently nullable. When this is unified against `RowResult<T>`, TS infers **`T = Row | null`** (the nullable type is absorbed into the generic). The runtime `if (result.error) throw` narrows the local `result`, but cannot flow back through the already-widened type parameter, so `unwrapRow` statically returns `Row | null`.

- `create-course.ts:16`, `create-merge.ts:65`, `create-student.ts:16` — unwrapped value feeds an `insertParent: () => Promise<{ id: string }>` contract → `Promise<null>` not assignable.
- `create-plan.ts:8`, `rename-plan.ts:8` — declared `Promise<PlanRecord>` but get `PlanRecord | null`.
- `placements.ts:70`, `placements.ts:99` — `toPlannerPlacement(row: PlacementRow)` receives `PlacementRow | null` (surfaces as TS2345 "argument" rather than TS2322 "return", same cause).

**Fix (type-only, no runtime change):**

```ts
export function unwrapRow<T>(
  result: { data: T | null; error: PostgrestError | null },
  messages: RowMessages,
): T {
  if (result.error) throw toDomainError(result.error, messages);
  return result.data as T;
}
```

With `data: T | null`, TS infers `T` from the non-null member (`T = Row`); the `as T` encodes the `.single()` success-⟹-non-null invariant the runtime already relies on. Mirrors the sibling `unwrap-maybe-row.ts` shape. The `RowResult` alias becomes dead (optional cleanup). Verified: clears all 7.

### Root cause B — `defineDomainAction` cannot satisfy Astro's conditional `ActionHandler`, collapsing `TOutput` to `unknown` (6 errors)

`src/shared/lib/actions/define-domain-action.ts`:

```ts
export function defineDomainAction<TInputSchema extends z.$ZodType, TOutput>(options: {
  input: TInputSchema;
  run: (supabase: SupabaseClient, input: z.output<TInputSchema>) => Promise<TOutput>;
}) {
  return defineAction({
    input: options.input,
    handler: (input, context) => {          // line 19
      requireSession(context);
      const supabase = requireSupabase(context);
      return runDomain(() => options.run(supabase, input));  // line 22
    },
  });
}
```

Astro's `ActionHandler<TInputSchema, TOutput>` is a **conditional type** keyed on `TInputSchema`, and `defineAction` infers `TOutput` *from the handler's return type*. TypeScript cannot prove an inline lambda is assignable to a conditional type whose condition is a still-free type variable, so:
1. The handler assignability check fails (`:19`).
2. Because the handler can't be checked, `defineAction` can't infer `TOutput` → falls back to `unknown`.
3. Inside the rejected handler `input` is `unknown`, not assignable to `z.output<TInputSchema>` (`:22`).

This is not a dual-Zod mismatch — Astro 6.4.8 and the project both resolve `zod/v4/core` (Zod 4.4.3). It's an Astro `defineAction` inference limitation that only bites when the schema is generic (which is exactly the factory case). Every action built through the factory (`src/actions/index.ts` spreads `planActions`, `placementActions`, …) becomes `ActionClient<unknown, …>`, which cascades:

- `plans-client.ts:8`, `:10` — `SafeResult<…, unknown>` not assignable to `SafeResult<…, { id: string }>` (via `callActionForId`/`callAction`, `src/shared/lib/forms/call-action.ts:15-16`).
- `placement-client.ts:15`, `:26` — `unknown` output returned where `PlannerPlacement` expected.

The `SafeResult`/`queryString`/`orThrow` wrapper itself is correct — it merely receives `unknown` from the broken factory.

**Fix (one file, no runtime change):** make `defineAction`'s generics explicit so `TOutput` no longer depends on handler inference, and cast the handler past the conditional check:

```ts
import { defineAction, type ActionAPIContext } from "astro:actions";

export function defineDomainAction<TInputSchema extends z.$ZodType, TOutput>(options: {
  input: TInputSchema;
  run: (supabase: SupabaseClient, input: z.output<TInputSchema>) => Promise<TOutput>;
}) {
  const handler = (input: z.output<TInputSchema>, context: ActionAPIContext): Promise<TOutput> => {
    requireSession(context);
    const supabase = requireSupabase(context);
    return runDomain(() => options.run(supabase, input));
  };
  return defineAction<TOutput, undefined, TInputSchema>({
    input: options.input,
    handler: handler as never,
  });
}
```

`placement-client.ts` and `plans-client.ts` need **no edits** — they pass through once `TOutput` is preserved. Verified: applying this alone dropped tsc from 16 → 10 (all 6 cluster errors gone, no regressions).

### Root cause C — `unwrapMaybeRow` infers `never` from the supabase-js result union (2 errors)

`src/_pages/plan-detail/api/staleness.ts:20-32` selects `catalog_hash` from `course_groupings` via `.maybeSingle()` through `unwrapMaybeRow`. The column and table **exist correctly** in both migrations and the generated types (`src/shared/api/database.types.ts:70-100`, `catalog_hash: string | null`); the `SupabaseClient` is correctly parameterized with `Database` (`src/shared/api/index.ts:19`). The bare query chain type-checks fine.

The `never` comes from `unwrapMaybeRow`'s generic inference under TS6 (`src/shared/api/postgrest/unwrap-maybe-row.ts:9`):

```ts
export function unwrapMaybeRow<T>(result: { data: T | null; error: PostgrestError | null }, failure: string): T | null
```

postgrest-js 2.108.2 types `.maybeSingle()` as a **union** (`{ success:true; data: T|null } | { success:false; data: null }`). Inferring a bare `T` from that union's `data` field collapses the candidates to **`never`**, so `stored: never` and `stored.catalog_hash` fails. Proven by reduction — even a stripped `unwrap2<T>(result: { data: T | null }): T | null` yields `never` for the same call. (Note: the generated `database.types.ts` omits the `__InternalSupabase`/`PostgrestVersion` block referenced at line 578; adding it does **not** fix this and is unrelated.)

**Fix (type-only):** capture the whole result and derive the return from its `data` instead of inferring a bare `T`:

```ts
export function unwrapMaybeRow<R extends { data: unknown; error: PostgrestError | null }>(
  result: R,
  failure: string,
): R["data"] {
  if (result.error) throw toDomainError(result.error, { failure });
  return result.data;
}
```

Verified against the staleness chain. (A discriminated-union mirror does *not* work — only the `R extends { data }` / `R["data"]` form fixes inference.)

### Root cause D — test literal uses a field from the wrong type (1 error)

`src/_pages/plan-detail/model/slot-bundle.test.ts:42`:

```ts
expect(hasOverride([{ day: 3, period: 4, pending: true }], 3, 4)).toBe(true);
```

`hasOverride(overrides: SlotOverride[], …)` where `SlotOverride = { day; period }`; `pending` lives only on `LocalSlotOverride = SlotOverride & { pending?: boolean }` (`slot-bundle.ts:8-16`). The inline literal triggers TS's excess-property check directly against `SlotOverride`. Git history (commit #29) shows the type, helper, and test landed together — original test drift, not a later type change. Sibling tests avoid it by typing their arrays as `LocalSlotOverride[]`.

**Fix:** `[{ day: 3, period: 4, pending: true } as LocalSlotOverride]` (the type is already imported at line 10).

## Why builds and tests pass while type-check fails

- **`astro build` → Vite → esbuild**: esbuild transpiles each file independently and *strips* types; it performs **no type-checking** and no cross-file inference. A program riddled with type errors still emits valid JS.
- **Vitest**: also esbuild-based transform — same story; tests run the transpiled JS, type errors are invisible.
- **ESLint (`typescript-eslint`)**: type-*aware* lint rules exist, but the flat config does not enable the rules that would flag these specific assignability/inference errors; lint passing is not a type-check.
- **`astro sync`**: only *generates* `.astro/types.d.ts`; it does not check the program.

So nothing in the green path ever ran the TypeScript checker. The only tools that do — `tsc --noEmit` and `astro check` — are not invoked anywhere in the repo.

## Feasibility & recommended wiring (astro check)

Tooling is already present: `@astrojs/check@^0.9.9` (dependencies, package.json:24) and `typescript@^6.0.3` (devDependencies:73). `astro check` is the official checker and type-checks `.astro` + `.ts`/`.tsx`, so it strictly dominates bare `tsc` for this codebase. It internally runs `astro sync`, and `tsconfig.json` includes `.astro/types.d.ts`, so the synced types are picked up.

**(a) package.json** — add near line 9:
```json
"check": "astro check"
```

**(b) CI `verify` job** (`.github/workflows/ci.yml:16-28`) — insert immediately after `pnpm astro sync` (line 23), before the slower steps (fail-fast):
```yaml
- run: pnpm astro sync
- run: pnpm check          # astro check — type gate
- run: pnpm lint
- run: pnpm steiger
- run: pnpm audit --audit-level=high
- run: pnpm test
- run: pnpm build
```
Do **not** add it to `deploy` (line 79+) — `deploy` needs `verify`, so it's redundant. `astro check` must run *after* `astro sync` (the hard dependency: it needs `.astro/types.d.ts`).

**(c) `/verify` skill** (`.claude/skills/verify/SKILL.md:8-14`) — add `pnpm check` after `pnpm astro sync`; update the "six steps" wording. Also worth aligning the skill's order with CI (CI: sync → lint → steiger → audit → test → build; skill currently lists lint → audit → steiger).

**Caveats to validate when wiring:**
- `tsconfig.json` does **not** exclude test files, so `astro check` will also check `*.test.ts` / `*.integration.test.ts`. If Vitest globals or test-only types cause noise, scope via a `tsconfig` `exclude` or a dedicated check tsconfig rather than loosening `strict`.
- Sequence the work as **fix the 16 errors first, then add the gate** — otherwise the first CI run with the new step goes red.
- Perf: `astro check` spins up the TS/Astro language server for a full project check — expect seconds to low-tens-of-seconds, comparable to lint, well under build/test. Fail-fast placement minimizes wasted runner minutes.

## "Make sure it won't happen again"

The gate (CI + `/verify` + `pnpm check`) is the mechanism that prevents recurrence. Two reinforcements worth considering:
- **lefthook pre-commit/pre-push**: `lefthook.yml` currently runs eslint `--fix`, steiger, prettier on staged files. A `pnpm check` on pre-push (not pre-commit — too slow for every commit) would catch type errors before they reach CI. Optional.
- **Lesson capture**: this episode is itself a recurring-pattern candidate for `context/foundation/lessons.md` — "build/test green ≠ type-safe; esbuild never type-checks, so a dedicated `astro check` gate is mandatory, and `pnpm build`/`pnpm lint` must never be cited as a type-check proxy in plans." The drift in §Historical Context is exactly the failure mode a lesson would arrest.

## Code References

- `src/shared/api/postgrest/unwrap-row.ts` — root cause A (generic widens to `Row | null`)
- `src/shared/api/postgrest/unwrap-maybe-row.ts:9` — root cause C (generic collapses to `never`)
- `src/shared/lib/actions/define-domain-action.ts:13,19,22` — root cause B (conditional `ActionHandler`, `TOutput` → `unknown`)
- `src/shared/lib/forms/call-action.ts:15-16` — `SafeResult`/`callAction` wrapper (correct; receives `unknown` from B)
- `src/_pages/plan-detail/api/staleness.ts:20-32` — C call site
- `src/_pages/plan-detail/api/placements.ts:70,99` — A call sites (via `toPlannerPlacement`)
- `src/_pages/plan-detail/api/placement-client.ts:15,26` — B downstream
- `src/_pages/plans-list/api/plans-client.ts:8,10` — B downstream
- `src/_pages/plans-list/api/{create-plan,rename-plan}.ts:8` — A call sites
- `src/_pages/courses/api/{create-course:16,create-merge:65}.ts`, `src/_pages/students/api/create-student.ts:16` — A call sites
- `src/_pages/plan-detail/model/slot-bundle.test.ts:42` + `slot-bundle.ts:8-16` — root cause D
- `src/shared/api/database.types.ts:70-100` — `course_groupings.catalog_hash` (exists; rules out a missing-column theory)
- `.github/workflows/ci.yml:16-28` (verify job), `:79-110` (deploy job)
- `.github/actions/setup/action.yml` — composite setup (no change needed)
- `.claude/skills/verify/SKILL.md:8-14` — local verify sequence
- `package.json:5-22` (scripts, no `check`), `:24` (`@astrojs/check`), `:73` (`typescript`)
- `tsconfig.json` — extends `astro/tsconfigs/strict`, includes `.astro/types.d.ts` + `**/*`, excludes only `dist`

## Architecture Insights

- **The shared helper / factory layer is where type-safety leverage concentrates.** 14 of 16 errors trace to 3 shared abstractions (`unwrapRow`, `unwrapMaybeRow`, `defineDomainAction`). Generic inference at the Supabase/PostgREST and Astro-Actions boundaries is the recurring hazard — exactly the "let the type system encode invariants / keep identity as opaque tokens at the edges" theme already in `lessons.md`.
- **TS6 + postgrest-js result unions** infer poorly when a helper takes a bare `T` and reads `result.data`. The robust pattern is to constrain on the *whole result* (`R extends { data: … }`) and project (`R["data"]`), or to type `data` as `T | null` and assert the documented post-condition.
- **Astro `defineAction` does not compose with a generic schema** when you also want `TOutput` inferred from the handler — pass the generics explicitly.

## Historical Context (from prior changes)

- `astro check` *was* used as a manual per-plan type gate during early catalog work: `context/archive/2026-06-07-course-catalog/plan.md:133,183,235,281` and Progress L346-394 run `pnpm exec astro sync && pnpm exec astro check`; `reviews/impl-review.md:21` and `change.md:8` cite "astro check (0 errors)".
- **The convention then drifted**: later plans substituted build/lint as the "type-check" proxy — `2026-06-13-slot-as-a-group/plan.md:247` ("Type check / build clean: `pnpm build`"), `2026-06-15-dnd-single-course-from-palette/plan.md:159` ("Type checking passes: `pnpm build`"), `2026-06-10-teachers-catalog/plan.md:101` (`astro sync && pnpm lint`). Since neither build nor lint type-checks, errors accrued silently.
- No document anywhere deliberately excludes a type-check from CI — the gap is drift, not a decision.

## Open Questions

1. Do test files type-check cleanly under `astro check`, or do Vitest globals require a tsconfig tweak? (Validate during wiring — §Caveats.)
2. Should the gate also land on lefthook **pre-push** for an earlier signal, or is CI + `/verify` sufficient?
3. After fixing `unwrapRow`/`unwrapMaybeRow`, is the now-dead `RowResult` alias worth removing in the same change (cleanup) or deferring?

## Related Research

- None prior on this topic. This is the first research artifact under `context/changes/ci-tsc-audit/`.
</content>
</invoke>
