# CI Type-Check Gate (astro check) Implementation Plan

## Overview

Running a real type-check (`pnpm exec astro check`) surfaces **16 errors across 11 files**, yet `pnpm build`, `pnpm test`, and `pnpm lint` are all green — because nothing in the repo ever type-checks (esbuild strips types; there is no `check` script, no CI step, no hook). This plan **clears the 16 errors with type-only fixes** (no runtime behavior change), then **installs an `astro check` gate** in CI, lefthook pre-push, and the `/verify` skill so the class of error cannot recur, and **captures a lesson** to arrest the drift that let them accumulate (later plans substituting `pnpm build`/`pnpm lint` as a fake type-check proxy).

## Current State Analysis

- `pnpm exec astro check` → **16 errors, 0 warnings, 6 hints** across 354 files (reproduced at HEAD `7777dff`, matching the research exactly).
- **No type-check exists anywhere**: not in `.github/workflows/ci.yml` (verify job runs `astro sync → lint → steiger → audit → test → build`), not in `.claude/skills/verify/SKILL.md`, not in `lefthook.yml` (pre-commit only: eslint `--fix`, steiger, prettier), and there is no `check`/`typecheck` npm script in `package.json`.
- Tooling is **already installed**: `@astrojs/check@^0.9.9` (dependency) and `typescript@^6.0.3` (devDependency). No new deps required.
- The 16 errors collapse into **4 root causes**, three of which are single-file fixes to shared helpers/factories (clearing 14 of 16), the fourth a one-line test annotation. All fixes are **type-only** and were verified in research to drop the count without regressions.
- The `defineDomainAction` factory (root cause B) is governed by the `lessons.md` "Astro Actions are the single transport" rule (thin orchestration: `requireSession → requireSupabase → runDomain(() => domainFn(...))`) — the fix must preserve that handler body verbatim.

## Desired End State

- `pnpm check` (`astro check`) reports **0 errors**.
- CI `verify` job runs `pnpm check` immediately after `pnpm astro sync`, before lint/steiger/audit/test/build (fail-fast).
- lefthook **pre-push** runs `pnpm check`, giving a local signal before CI.
- `/verify` skill mirrors CI's exact order, including the new check step.
- `context/foundation/lessons.md` carries an entry establishing that build/test/lint green ≠ type-safe and that `astro check` is the mandatory gate.

**Verification:** `pnpm check` exits 0; `pnpm lint`, `pnpm steiger`, `pnpm test`, `pnpm build` all still pass; CI `verify` job goes green on the branch.

### Key Discoveries:

- Root cause A — `unwrapRow` infers `T = Row | null` because supabase-js `.single()` returns an independently-nullable (non-discriminated) `data`/`error` shape; typing the param `data: T | null` and asserting `as T` makes TS infer `T` from the non-null member. `src/shared/api/postgrest/unwrap-row.ts`. Clears 7 errors.
- Root cause B — `defineDomainAction` cannot satisfy Astro's conditional `ActionHandler` when `TInputSchema` is still a free type variable, so `TOutput` collapses to `unknown` and cascades into the action clients. Making `defineAction`'s generics explicit and casting the handler past the conditional check restores `TOutput`. `src/shared/lib/actions/define-domain-action.ts`. Clears 6 errors (downstream `placement-client.ts`/`plans-client.ts` need **no edits**).
- Root cause C — `unwrapMaybeRow` infers `never` from postgrest-js's `.maybeSingle()` result union; constraining on the whole result (`R extends { data … }`, return `R["data"]`) fixes inference. `src/shared/api/postgrest/unwrap-maybe-row.ts`. Clears 2 errors.
- Root cause D — test literal `{ day, period, pending }` triggers excess-property check against `SlotOverride` (where `pending` lives only on `LocalSlotOverride`). `src/_pages/plan-detail/model/slot-bundle.test.ts:42`. Clears 1 error.
- `astro check` internally runs `astro sync` and `tsconfig.json` includes `.astro/types.d.ts`, but the gate must still run **after** `pnpm astro sync` in CI (it consumes the synced types).
- Test files type-check cleanly under `astro check` — the full 354-file run produces only the 16 known errors (the sole test-file error is root cause D). **No tsconfig `exclude` tweak is needed.**

## What We're NOT Doing

- **No runtime/behavior changes.** Every fix is type-only (signatures, an `as T` assertion, a test annotation).
- **No edits to `placement-client.ts` or `plans-client.ts`** — they pass through correctly once `TOutput` is preserved by the B fix.
- **No tsconfig changes** (no new `exclude`, no loosening `strict`) — verified unnecessary.
- **No `bare tsc` script** — `astro check` strictly dominates (it also checks `.astro` files).
- **No change to the CI `deploy` job** — it `needs: [verify, …]`, so the gate there would be redundant.
- **No `database.types.ts` regeneration** — the missing `__InternalSupabase` block is unrelated and does not fix root cause C.
- **No data model, migration, schema, or UI changes.**

## Implementation Approach

Two strictly-ordered functional phases plus a documentation phase. **Phase 1 (fix the errors) must fully land and verify `astro check` → 0 before Phase 2 (add the gate)** — wiring the gate first would turn the first CI run red. Phase 3 (lesson) is independent and can land with either. Each helper fix is localized to one file; the research provides verified contracts for all four. The gate wiring touches `package.json`, `ci.yml`, `lefthook.yml`, and the `/verify` skill.

## Phase 1: Fix the 16 type errors

### Overview

Clear all 16 errors via four localized, type-only fixes to the three shared abstractions and one test file. Remove the now-dead `RowResult` alias as part of the A fix.

### Changes Required:

#### 1. Root cause A — `unwrapRow` widens generic to include `null` (7 errors)

**File**: `src/shared/api/postgrest/unwrap-row.ts`

**Intent**: Stop the generic `T` from absorbing `null`. Type the param's `data` as `T | null` so TS infers `T` from the non-null member, and assert `return result.data as T` to encode the `.single()` success-⟹-non-null invariant the runtime already relies on. Remove the now-unused `RowResult` alias (per the cleanup decision).

**Contract**: `unwrapRow<T>(result: { data: T | null; error: PostgrestError | null }, messages: RowMessages): T`. Body unchanged except `return result.data as T`. Mirrors the sibling `unwrap-maybe-row.ts` shape. Clears the call sites in `create-course.ts:16`, `create-merge.ts:65`, `create-student.ts:16`, `create-plan.ts:8`, `rename-plan.ts:8`, `placements.ts:70`, `placements.ts:99`.

#### 2. Root cause B — `defineDomainAction` collapses `TOutput` to `unknown` (6 errors)

**File**: `src/shared/lib/actions/define-domain-action.ts`

**Intent**: Make `defineAction`'s generics explicit so `TOutput` no longer depends on handler inference, and cast the handler past Astro's conditional `ActionHandler` check. Preserve the thin-orchestration handler body (`requireSession → requireSupabase → runDomain(() => options.run(supabase, input))`) exactly — it is governed by the Astro-Actions lesson.

**Contract**: Extract a typed `handler: (input: z.output<TInputSchema>, context: ActionAPIContext) => Promise<TOutput>`, then `return defineAction<TOutput, undefined, TInputSchema>({ input: options.input, handler: handler as never })`. Import `type ActionAPIContext` from `astro:actions`. No edits needed to `placement-client.ts` (:15,:26) or `plans-client.ts` (:8,:10) — they recover once `TOutput` is preserved.

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

#### 3. Root cause C — `unwrapMaybeRow` infers `never` from the result union (2 errors)

**File**: `src/shared/api/postgrest/unwrap-maybe-row.ts`

**Intent**: Constrain the generic on the *whole* result and project the return from its `data` field, instead of inferring a bare `T` from a postgrest-js `.maybeSingle()` union (which collapses to `never`).

**Contract**: `unwrapMaybeRow<R extends { data: unknown; error: PostgrestError | null }>(result: R, failure: string): R["data"]`. Body unchanged (`if (result.error) throw …; return result.data`). Clears `staleness.ts:32` (×2). Note: a discriminated-union mirror does *not* work — only the `R extends { data }` / `R["data"]` form fixes inference.

#### 4. Root cause D — test literal uses a field from the wrong type (1 error)

**File**: `src/_pages/plan-detail/model/slot-bundle.test.ts`

**Intent**: Annotate the inline override literal as `LocalSlotOverride` (where `pending` lives) so it doesn't trip the excess-property check against `SlotOverride`.

**Contract**: Line 42 — `[{ day: 3, period: 4, pending: true } as LocalSlotOverride]`. `LocalSlotOverride` is already imported (line 10). No production code change.

### Success Criteria:

#### Automated Verification:

- Type-check passes with zero errors: `pnpm exec astro check`
- Unit tests pass: `pnpm test`
- Lint passes: `pnpm lint`
- FSD structure passes: `pnpm steiger`
- Production build succeeds: `pnpm build`

#### Manual Verification:

- No dead `RowResult` references remain in the codebase after the A fix.
- Action-driven flows (create/rename plan, placements, catalog create) behave unchanged in the running app — the fixes are type-only, but spot-check one mutation path through the UI.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes live in the `## Progress` section.

---

## Phase 2: Install the type-check gate

### Overview

Add the `check` script and wire `astro check` into CI (fail-fast, after sync), lefthook pre-push, and the `/verify` skill — realigning the skill to mirror CI's exact order. Only safe to land after Phase 1 verifies clean.

### Changes Required:

#### 1. `package.json` script

**File**: `package.json`

**Intent**: Expose the gate as a first-class script.

**Contract**: Add `"check": "astro check"` to `scripts` (near the other build/sync scripts).

#### 2. CI `verify` job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the type gate immediately after `astro sync` and before the slower steps so type failures fail fast.

**Contract**: In the `verify` job (currently lines 23-28), insert `- run: pnpm check` between `- run: pnpm astro sync` and `- run: pnpm lint`. Final order: `astro sync → check → lint → steiger → audit → test → build`. Do **not** touch the `deploy` job (it `needs: verify`).

#### 3. lefthook pre-push hook

**File**: `lefthook.yml`

**Intent**: Give a local type-error signal before CI, without slowing every commit. Pre-push (not pre-commit) per the decision.

**Contract**: Add a top-level `pre-push:` section with a single job running `pnpm check`. Whole-project check (no `glob`/`{staged_files}` — `astro check` is a full-program check). Keep the existing `pre-commit` block unchanged.

#### 4. `/verify` skill realignment

**File**: `.claude/skills/verify/SKILL.md`

**Intent**: Make the skill a faithful mirror of CI, fixing the existing order drift and adding the check step.

**Contract**: Update the numbered sequence to match CI exactly: `install → astro sync → check → lint → steiger → audit → test → build`. Update the prose ("six steps" → the new count) and the `description` frontmatter if it enumerates steps. Keep the lint:fix guidance.

### Success Criteria:

#### Automated Verification:

- `pnpm check` is runnable and exits 0: `pnpm check`
- Full local gate passes in CI order: `pnpm astro sync && pnpm check && pnpm lint && pnpm steiger && pnpm test && pnpm build`
- YAML is valid (CI parses the workflow on push).

#### Manual Verification:

- A deliberately-introduced type error is caught by `pnpm check` (and, if convenient, by a test push triggering the pre-push hook), then reverted.
- CI `verify` job shows the `pnpm check` step running after `astro sync` and going green on the branch.
- `/verify` skill, when run, executes the new order and reports the check step.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Phase 3: Capture the lesson

### Overview

Append a `lessons.md` entry so future plans/reviews never again cite `pnpm build`/`pnpm lint` as a type-check, and so the gate's rationale is durable.

### Changes Required:

#### 1. Lessons register

**File**: `context/foundation/lessons.md`

**Intent**: Record the recurring rule: build/test/lint green ≠ type-safe (esbuild strips types and never type-checks); `astro check` is the mandatory gate and must never be proxied by build/lint in plans.

**Contract**: Append a new `## ...` section following the file's existing shape (Context / Problem / Rule / Applies to). Context: CI/verify gating and any plan citing a "type-check" success criterion. Problem: esbuild-based build/test and the flat ESLint config do not type-check, so type errors accumulate silently; prior plans substituted `pnpm build`/`pnpm lint` as a fake proxy. Rule: a dedicated `astro check` gate is required; never cite build/lint as a type-check. Applies to: plan, plan-review, implement, impl-review.

### Success Criteria:

#### Automated Verification:

- File is valid markdown and present: `test -f context/foundation/lessons.md`

#### Manual Verification:

- The new lesson reads consistently with the existing entries' Context/Problem/Rule/Applies-to structure.

---

## Testing Strategy

### Unit Tests:

- Existing `pnpm test` suite must stay green — the type-only fixes change no runtime behavior, so no test logic changes (only the `slot-bundle.test.ts:42` annotation).

### Integration Tests:

- No new integration tests. The action clients and unwrap helpers are exercised by existing integration suites (`pnpm test:integration`); run them once to confirm the B/A/C fixes don't alter runtime results.

### Manual Testing Steps:

1. Run `pnpm exec astro check` → expect `0 errors`.
2. Spot-check one mutation in the running app (e.g. rename a plan, drop a placement) — behavior unchanged.
3. Introduce a throwaway type error (e.g. assign a `string` to a `number`), run `pnpm check` → expect failure; revert.

## Performance Considerations

`astro check` spins up the TS/Astro language server for a full-project check — seconds to low-tens-of-seconds, comparable to lint and well under build/test. Fail-fast placement (right after `astro sync`) minimizes wasted runner minutes. Pre-push (not pre-commit) keeps the per-commit loop fast.

## Migration Notes

None — no schema or data changes. The only ordering constraint is procedural: Phase 1 must verify `astro check` clean before Phase 2 wires the gate, or the first CI run with the new step fails.

## References

- Research: `context/changes/ci-tsc-audit/research.md`
- Astro Actions transport lesson: `context/foundation/lessons.md:19-24` (constrains the B fix)
- Root-cause loci: `src/shared/api/postgrest/unwrap-row.ts`, `src/shared/api/postgrest/unwrap-maybe-row.ts`, `src/shared/lib/actions/define-domain-action.ts`, `src/_pages/plan-detail/model/slot-bundle.test.ts:42`
- Wiring loci: `package.json:5-22`, `.github/workflows/ci.yml:16-28`, `lefthook.yml`, `.claude/skills/verify/SKILL.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fix the 16 type errors

#### Automated

- [x] 1.1 Type-check passes with zero errors: `pnpm exec astro check` — 1beed2f
- [x] 1.2 Unit tests pass: `pnpm test` — 1beed2f
- [x] 1.3 Lint passes: `pnpm lint` — 1beed2f
- [x] 1.4 FSD structure passes: `pnpm steiger` — 1beed2f
- [x] 1.5 Production build succeeds: `pnpm build` — 1beed2f

#### Manual

- [x] 1.6 No dead `RowResult` references remain after the A fix — 1beed2f
- [x] 1.7 One action-driven mutation path spot-checked unchanged in the running app — 1beed2f

### Phase 2: Install the type-check gate

#### Automated

- [x] 2.1 `pnpm check` is runnable and exits 0
- [x] 2.2 Full local gate passes in CI order (sync → check → lint → steiger → test → build)
- [x] 2.3 Workflow YAML is valid (CI parses on push)

#### Manual

- [x] 2.4 A deliberate type error is caught by `pnpm check`, then reverted
- [x] 2.5 CI `verify` job shows `pnpm check` running after `astro sync` and green on the branch
- [x] 2.6 `/verify` skill executes the new order and reports the check step

### Phase 3: Capture the lesson

#### Automated

- [ ] 3.1 `lessons.md` present: `test -f context/foundation/lessons.md`

#### Manual

- [ ] 3.2 New lesson is consistent with existing Context/Problem/Rule/Applies-to entries
