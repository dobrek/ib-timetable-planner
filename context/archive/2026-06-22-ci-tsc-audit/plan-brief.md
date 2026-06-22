# CI Type-Check Gate (astro check) — Plan Brief

> Full plan: `context/changes/ci-tsc-audit/plan.md`
> Research: `context/changes/ci-tsc-audit/research.md`

## What & Why

All builds, tests, and lint are green, but a real type-check (`astro check`) surfaces **16 errors across 11 files** — because nothing in the repo ever type-checks (esbuild strips types; there's no `check` script, CI step, or hook). We clear the 16 errors with type-only fixes, then install an `astro check` gate so this class of error cannot recur, plus a lesson to stop plans from citing `build`/`lint` as a fake type-check.

## Starting Point

CI's `verify` job runs `astro sync → lint → steiger → audit → test → build`; `/verify` and lefthook (pre-commit only) likewise never type-check. `@astrojs/check` and `typescript@^6` are already installed — no new deps. The 16 errors collapse into 4 root causes, three of them single-file fixes to shared helpers (`unwrapRow`, `unwrapMaybeRow`, `defineDomainAction`) clearing 14 of 16; the fourth is a one-line test annotation.

## Desired End State

`pnpm check` reports 0 errors and runs in CI (after `astro sync`, fail-fast), on lefthook pre-push, and inside `/verify` — which now mirrors CI's exact order. A `lessons.md` entry makes "green build ≠ type-safe" durable. No runtime behavior changes.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Checker tool | `astro check`, not bare `tsc` | Also type-checks `.astro` files; already installed | Research |
| Fix vs gate ordering | Fix all 16 errors first, then add gate | Wiring the gate first turns the first CI run red | Research |
| Dead `RowResult` alias | Remove in the same change | Its only purpose vanishes with the `unwrapRow` fix; leaves no dead code | Plan |
| lefthook pre-push | Add `pnpm check` on pre-push | Local type signal before CI (pre-push, not pre-commit, for speed) | Plan |
| `/verify` skill order | Realign to mirror CI exactly | Fixes existing order drift; skill's purpose is to mirror CI | Plan |
| Test files under check | No tsconfig `exclude` needed | Full 354-file run yields only the 16 known errors | Plan |

## Scope

**In scope:** 4 type-only fixes (A `unwrapRow`, B `defineDomainAction`, C `unwrapMaybeRow`, D test annotation) + remove dead `RowResult`; `check` script; CI/lefthook/`/verify` wiring; one lesson.

**Out of scope:** Any runtime/behavior change; edits to `placement-client.ts`/`plans-client.ts` (recover for free); tsconfig changes; bare `tsc`; `deploy`-job changes; `database.types.ts` regeneration; schema/UI changes.

## Architecture / Approach

Type-leverage concentrates in three shared abstractions at the Supabase/PostgREST and Astro-Actions boundaries — fixing their generic inference (A: type `data` as `T | null` + `as T`; B: explicit `defineAction` generics + handler cast; C: constrain on whole result `R["data"]`) clears the cascade. The B fix must preserve the thin-orchestration handler body governed by the Astro-Actions lesson. Then the gate is wired fail-fast in CI right after `astro sync` (which `astro check` depends on), plus pre-push and `/verify`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fix errors | `astro check` → 0 errors (type-only) | A regression in action typing; mitigated — fixes verified in research, no runtime change |
| 2. Install gate | `pnpm check` in CI + pre-push + `/verify` | Must land after Phase 1, or first CI run goes red |
| 3. Capture lesson | `lessons.md` entry vs proxy-substitution drift | None |

**Prerequisites:** None — tooling already installed; Phase 2 depends on Phase 1 verifying clean.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Assumes research's root-cause analysis holds — confirmed: error count reproduced exactly at HEAD, and each fix was verified in research to drop the count without regressions.
- `astro check` adds seconds-to-low-tens-of-seconds to CI and each push; fail-fast placement and pre-push (not pre-commit) keep this acceptable.

## Success Criteria (Summary)

- `pnpm exec astro check` reports 0 errors; lint/steiger/test/build still green.
- CI `verify` runs `pnpm check` after `astro sync` and goes green; a deliberate type error is caught locally and in CI.
- `/verify` mirrors CI order; `lessons.md` records the guardrail.
