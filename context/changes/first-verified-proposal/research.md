---
date: 2026-08-12T10:04:33+02:00
researcher: Dobromir Kropielnicki
git_commit: 8e470832000756dc65f0fe8b8210ac06c334210b
branch: main
repository: 10xdev3
topic: "Feasibility of implementing S-301 (first-verified-proposal)"
tags:
  [
    research,
    codebase,
    feasibility,
    solver,
    cp-sat,
    generation-jobs,
    clean-mode,
    oracle,
    clone-plan,
    drift,
  ]
status: complete
last_updated: 2026-08-12
last_updated_by: Dobromir Kropielnicki
---

# Research: Feasibility of implementing S-301 (first-verified-proposal)

**Date**: 2026-08-12T10:04:33+02:00
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `8e470832000756dc65f0fe8b8210ac06c334210b`
**Branch**: `main`
**Repository**: 10xdev3

## Research Question

Is roadmap slice **S-301 "first-verified-proposal"** (the north star) feasible as written?

Its outcome (`context/foundation/roadmap.md:113`): the author starts a CP-SAT solve on an existing
plan with the shipped clean-mode default policy; the app **settles unsaved board state**, **clones
the plan as the proposal target**, **assembles the snapshot from the clone server-side**, records a
durable job (one active job per source plan), and dispatches it to the solver; on completion the
complete board passes the **server-side** oracle (the relocated runner seam) and lands on the
proposal plan through the atomic RPC, ready to open.

Scope agreed before research: **S-301 plus the seams leaking into it from S-302/S-303** (the
unauthenticated dispatch, the `snapshot_hash` binding F-302 handed off, the 12.5-minute solve vs any
synchronous expectation, wedged-row recovery), with all four risk areas dug into — server-side
oracle in workerd, clean-mode engine work, job/data integrity, and settle+clone+assembly — and
**full empirical verification**: the local Supabase stack and the native solver were booted and the
whole flow was actually exercised, not just read.

## Summary

**S-301 is feasible — and the whole flow was driven end to end on this machine, successfully, before
writing this.** A probe suite performed the entire proposed slice against the real stack (clone →
server-side assembly → hash → durable job → dispatch → an 11¼-minute real CP-SAT solve → server-side
oracle → id translation → atomic apply onto the clone) and every assertion passed, returning a
**complete 250-placement board that the oracle accepted**. So the seams do compose; the question is
not whether the architecture works but what the slice actually costs. Two things must be settled
before `/10x-plan`, and the slice is materially larger than its Outcome sentence suggests.

**The one real blocker is a design contradiction, not a limitation.** The roadmap says the snapshot
is assembled **from the clone**; the `generation_jobs` migration header says `snapshot_hash` is
computed **over the SOURCE plan at T0** so that "`clone_plan`'s UUID re-minting never enters it"
(`supabase/migrations/20260810200122_generation_jobs.sql:49-55`). Both cannot hold, because
`clone_plan` re-mints every course UUID — **measured: 0 of 84 course ids survive a clone**. Under the
roadmap's reading, FR-307's drift check would report drift on every run and S-306's auto-apply could
never fire. The good news is the fix is cheap and empirically validated: assemble and hash from the
**source**, then translate `courseId` at apply time. The frozen contract's `GeneratedPlacement`
carries exactly one id (`courseId`), and the natural key `(cohort, name, level, group_index)` is
**unique 84/84 and matches 84/84 across the clone** — so the translation is one unambiguous
dimension, not a general identity-mapping problem.

**Three of the four risk areas came back cheaper than feared.**

- **The server-side oracle is a non-issue** — a ~30-line call site, not a relocation project.
  `verifyGeneration` is pure and **already runs server-side in workerd today**, on full real plans,
  via `/plans/compare` (`src/_pages/plan-comparison/api/load-comparison.ts:125`, reached from
  `src/pages/plans/compare.astro:8`). Cost is ~2 ms against the paid tier's 30 s CPU budget, and the
  real CP-SAT golden board passes it.
- **Clean mode is cheap and satisfiable** — ~15–25 lines, and proven **OPTIMAL in 0.59–0.66 s with a
  complete board and `softHits = 0`** on all four production-derived dumps. Because it can be
  config-gated outside `build_model`, the 10/10 objective-parity gate is untouched **by
  construction**, and the frozen wire contract needs no change.
- **"Settle unsaved board state" is already done** — there is no unsaved board state. Every board
  mutation persists per gesture (`src/_pages/plan-detail/model/placement/board-writes.ts`), and the
  only unsettled notion is the optimistic in-flight window already exposed as `busy` and already
  gating Generate with the label *"Waiting for pending edits to settle"*
  (`src/_pages/plan-detail/ui/chrome/GenerateButton.tsx:42`). This shrinks the slice.

**The genuinely large piece is invisible in the Outcome sentence: there is no delivery trigger, and
there is nothing in the repo to build one from.** A full solve is ~12.5 minutes (F-302's own
measurement, reconfirmed here), which cannot be awaited in-request. There is no polling, no cron
trigger in `wrangler.jsonc`, no `pg_cron`, no `pg_net`, and no webhook anywhere. S-301 can
legitimately ship an **Action-triggered** result-read — that satisfies FR-313's *location*
requirement ("the oracle runs server-side in the job delivery pipeline") — but not FR-313's
*rationale* ("so headless delivery is verified without a browser open"), which is S-303's polling
and S-306's headless delivery. The plan should say this out loud rather than let FR-313 read as
satisfied end to end.

**Second decision needed before planning:** clean mode can be **INFEASIBLE on a snapshot that is
otherwise completable** (a pin on a soft cell contributes an irreducible constant to tier 5), and
today's error path would report a falsehood — `"infeasible: the snapshot admits no complete board
under the hard rules"` — while `explain_infeasibility` would blame courses instead of the soft cell.
Refuse, or fall back to non-clean? FR-302 calling clean the *shipped default* argues for a fallback.

## Empirical verification performed

Everything below was run on this machine at this commit, against the local Supabase stack
(API `127.0.0.1:54321`, Postgres 17.6.1.121) and the native solver service on `:8000`.

| What | Result |
| ---- | ------ |
| Solver machine user rotated, service booted (`uvicorn cpsat_service.app:app`) | `GET /health` → **200 `{"status":"ok"}`** in 8.9 ms |
| F-302 proof of life: `src/test/solver-transport.integration.test.ts` | **4 passed / 1.67 s** — real password grant → Custom Access Token Hook → `solver_job_writer`, real RLS, real column grants; `queued → running → succeeded` |
| Solver's own suite (`uv run pytest`) | **84 passed / 11.14 s** |
| Course ids surviving `clone_plan(..., include_board => true)` | **0 of 84** — every course UUID re-minted |
| Natural key `(cohort, name, level, group_index)` uniqueness, source plan | **84 courses / 84 distinct keys** |
| Natural-key matched pairs source ↔ clone | **84 / 84** |
| Students: shared ids / distinct `(cohort, full_name)` | **0 shared** / 61 of 61 distinct |
| Teachers: shared ids / distinct `full_name` | **0 shared** / **1 of 18** — teachers are *not* natural-keyable on name (a `code` column exists) |
| Clean mode: Mode A + hard `softHits == 0`, four real dumps | **OPTIMAL, 0.59–0.66 s, softHits = 0, 232/232 hours placed** |
| Unconstrained Mode A optimum on `golden-dump.json` | **softHits = 2** — the clean constraint does bite |
| Clean mode with a pin on a soft cell | **INFEASIBLE**, while the same snapshot solves `complete` without clean mode |
| Oracle cost on the real catalog (232 CP-SAT placements) | **1.66–1.85 ms**; precondition pass 0.13–0.24 ms; whole delivery pass (parse + hash + verify) **~2.3 ms** |
| Real CP-SAT golden board through `verifyGeneration` | **`ok=true`**, 3 soft warnings, 0 reasons |
| Live `generation_jobs` posture | partial unique index present; `anon` holds **zero** of eight privileges; `solver_job_writer` = SELECT on the table + UPDATE on exactly 11 columns |
| **Full S-301 flow probe** (clone → source-side assembly → hash → enqueue → dispatch → solve → oracle → id translation → apply onto clone) | **PASSED end to end** in 676 s — see [Full-flow probe](#full-flow-probe) |

Two temporary artifacts were used and removed: a probe suite (`src/test/zz-probe-s301-flow.integration.test.ts`)
and scratchpad measurement harnesses. **No repository file was modified by this research** other than
`change.md` (status `new` → `preparing`) and this document.

## Detailed Findings

### A. What F-302 handed over — all of it verified working

- **Dispatch transport is built and tested, and has zero production call sites.**
  `createSolverTransport` (`src/entities/timetable/api/solver-transport.ts:52`) is a pure factory
  over `fetch` that canonicalizes the body, treats **202 as the only success**, and carries bounded
  timeouts (`HEALTH_TIMEOUT_MS = 3_000`, `DISPATCH_TIMEOUT_MS = 15_000`, `:49-50`) specifically to
  survive the containers#162 mid-job sleep. `getSolverTransport()`
  (`src/entities/timetable/api/solver-config.ts:23`) returns `null` when `SOLVER_URL` is unset.
  Verified: the only non-test references to either are their own definitions. **Wiring them up is
  S-301's first job.**
- **`entities/timetable`'s barrel must stay client-safe, and the build enforces it.**
  `api/solver-config.ts` is deliberately not barrel-exported because the barrel is pulled into the
  greedy Web Worker bundle and `astro:env/server` throws `[ServerOnlyModule]` at *load* time.
  **S-301 imports `@/entities/timetable/api/solver-config` at its own path.** A secondary hazard is
  already navigated: the barrel re-exports a React component, which is why
  `src/_pages/plan-comparison/api/index.ts:8-14` refuses to re-export `load-comparison`.
- **All ten F-302 implementation-review findings are genuinely fixed in the code**, spot-verified
  independently: claim-exception no longer writes, `finish` uses `Prefer: return=representation` and
  raises on a zero-row write, bounded retry (3 attempts, 1 s/4 s) on transient 5xx and transport
  errors only, `SOLVER_MAX_CONCURRENT_JOBS` (default 1) enforced atomically with a 503 past the cap,
  registry released on spawn failure, `AbortSignal.timeout` on both app-side fetches.
- **What F-302 explicitly did not build, and S-301 owns**: the result-read path, the server-side
  oracle call site, and the snapshot binding. `solver-transport.ts:14-18` says so in the code.

### B. The blocker: source-vs-clone id space and the `snapshot_hash` baseline

Three in-repo statements are mutually inconsistent:

1. `supabase/migrations/20260810200122_generation_jobs.sql:66-68` — `snapshot` is "The exact
   GeneratorSnapshot solved against."
2. `…:49-55` — `snapshot_hash` is the digest of that snapshot, "computed over the SOURCE plan at
   T0 … so `clone_plan`'s UUID re-minting never enters it."
3. `context/foundation/roadmap.md:113` — the app "clones the plan as the proposal target,
   **assembles the snapshot from the clone** server-side."

`clone_plan` re-mints every id through six `gen_random_uuid()`-defaulted temp maps
(`supabase/migrations/20260711174905_clone_plan_include_board.sql:39-59`, courses re-inserted at
`:103-106`), and the snapshot carries course UUIDs as `courses[].id` and `pins[].courseId`. Measured:
**0 of 84 course ids shared** between a plan and its clone. So a clone-assembled snapshot can never
hash equal to a source-assembled one, and:

- FR-307's drift check (re-assemble the source at T1, re-hash, compare) would report drift
  **always** → S-306's auto-apply is dead on arrival; and
- auto-applying clone-id placements to the source would be an FK error.

**Recommended resolution — option (A), and it is what the schema author already chose.** Assemble
and hash from the **source**; dispatch the source's snapshot; translate `courseId` to the clone's id
space at apply time. This is the only option consistent with the migration header, and the roadmap
sentence is the thing that is off.

Why it is cheap, empirically:

- The frozen contract's `GeneratedPlacement` is
  `{cohort, courseId, day, period, week}` with `additionalProperties: false` — **`courseId` is the
  only id in the result**. Teacher and student ids never come back, so the 1-of-18 distinct teacher
  name finding is irrelevant to the mapping (it would only matter if teachers ever needed
  cross-plan natural keying — worth remembering, since `full_name` is unusable and `code` is the
  real key).
- The natural key `(cohort, name, level, group_index)` is **unique across all 84 source courses** and
  **matches 84/84 across the clone**, because `clone_plan` copies those columns verbatim. The
  translation is a single unambiguous `Map`.

Options (B) "hash the clone and add a second source-side digest column" and (C) "clone at delivery
instead of at enqueue" are both coherent; (B) costs a migration the schema header's design
deliberately avoided, and (C) contradicts the roadmap's S-301 wording and pushes work into S-306.
**Whichever is chosen must be recorded in `change.md` before planning**, because the schema
semantics, the snapshot binding, and S-306 all hang off it.

### C. Clean mode (`softHits ≡ 0`) — cheap, satisfiable, with one semantic trap

- **It is genuinely unimplemented.** `softHits` is entry 5 of a hardcoded tier tuple
  (`services/solver/src/cpsat_engine/objective.py:59-70`, computed at `:176-186`), and `schema.py:76`
  states the intent verbatim: soft severity is *"a tier-5 objective term, never a constraint."*
  `SolveConfig` (`solve.py:31-41`) exposes only budgets, seed, workers, hops and `log_dir` — no tier
  order, no hard/soft field. (Roadmap line refs for these are a few lines stale post-F-302.)
- **The mechanism is a hard constraint, not a reorder.** The POC produced its clean boards exactly
  this way — `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md:165-168`. Reordering
  would neither guarantee 0 (the golden's tier 5 sat at `FEASIBLE best=3 bound=0` after 30 s) nor
  survive the parity gate, which compares tier values **positionally**.
- **The parity gate is untouched by construction.** `parity()` (`solve.py:109-128`) and
  `evaluate_board()` take no `SolveConfig` and add no clean constraint, so a `clean_mode: bool =
False` field read only inside `solve_complete` is invisible to the 10/10 gate. This is the single
  biggest reason the change is small. Corollary: **do not** implement it as variable pruning in
  `build_model`, which the gate's own model goes through.
- **No contract change.** `SolveRequest` is `{formatVersion, snapshot, warmStart?}` with
  `additionalProperties: false`, and F-302 already decided the solver does not read
  `generation_jobs.policy`. So the clean default is necessarily a **solver-side default** — which is
  precisely what FR-302 asks for ("the shipped default"). Zero schema edit, zero golden
  regeneration, no bilateral commit. S-307 still inherits the policy-carrier decision.
- **Satisfiability: proven, and it does bite.** OPTIMAL in 0.59–0.66 s with a complete board and
  `softHits = 0` on all four real dumps, against an unconstrained Mode A optimum of `softHits = 2` on
  the golden.
- **Trap (must be decided in S-301):** a **pin on a soft cell** makes `softHits == 0` unsatisfiable
  regardless of the generated rows, because pinned rows enter the tier as a constant
  (`objective.py:107-110`). Measured: same snapshot, `complete` without clean mode, **INFEASIBLE**
  with it. `_assert_pins_precondition` (`model.py:379-389`) inspects only hard rules, so no
  `PreconditionError` fires; `runner.py:170` then writes the false string *"infeasible: the snapshot
  admits no complete board under the hard rules"*, and `explain_infeasibility` (`explain.py:34-38`)
  reasons only over completeness literals, so it would name **courses** as the conflict. Re-solving
  without the constraint costs 0.6 s, so a two-shot diagnosis is affordable; the product question
  (refuse vs fall back to non-clean and flag the board) is the part that is not free.
- **Honest caveat — the satisfiability evidence is n=1.** Every clean data point comes from a catalog
  with exactly **one** soft teacher and 10 soft cells (one whole day), and zero pins on soft cells.
  `softHits == 0` as specified is unconditional: a school that marks many teachers soft-unavailable
  could make it infeasible, and today's code would refuse a complete board. The fallback path fixes
  both this and the trap above.

### D. Server-side oracle (FR-313) — not a feasibility risk

- **The seam is already engine-agnostic and pure.** `runVerifiedGeneration`
  (`src/entities/timetable/model/generation/run.ts:16-31`) is precondition → injected engine →
  verdict, 31 lines, and `verifyGeneration` (`verify.ts:51-55`) is a synchronous pure function.
  Neither has a browser-only or Node-only dependency; the one `@/shared/lib/catalog-hash` import is
  **type-only**, so WebCrypto never enters the graph. Both are already barrel-exported
  (`src/entities/timetable/index.ts:22,26`).
- **It already runs server-side in workerd, today, on full real plans** —
  `src/_pages/plan-comparison/api/load-comparison.ts:125`, reached from `src/pages/plans/compare.astro:8`
  (Astro frontmatter). FR-313's relocation is a **new call site**, not a new runtime capability.
- **Cost is negligible**: 1.66–1.85 ms for 232 placements on the real catalog; ~2.3 ms for the whole
  delivery pass. Against the paid tier's 30 s CPU ceiling (128 MB memory; 10 MB script budget at a
  current 394 KiB) that is ~0.008%. Prior recorded evidence agrees ("verify costs ~1 ms").
- **The adapter is prescribed**: inject a trivial `GeneratePlan` that returns the already-fetched
  result — F-302's research recorded this shape, and `bench/import-generated.experiment.ts` is that
  function already written (verify against the solved snapshot → drift check → region-replace
  persist), minus the Action wrapper and the Node/service-role bits.
- **One wart to decide deliberately**: the injected-engine form still runs the pins-only precondition
  first (`run.ts:25`), so a delivered board on a dirty-pins snapshot surfaces as
  `reason: "precondition"` rather than as a verdict on the board.
- **FSD ownership**: the oracle stays in `entities/`; the call site must be a `_pages/<slice>/api/`
  domain function wired through `defineDomainAction` (`src/shared/lib/actions/define-domain-action.ts`:
  `requireSession` → `requireSupabase` → `runDomain`) and registered in `src/actions/index.ts`.

### E. Settle + clone + assembly — mostly reuse, and smaller than written

- **There is no unsaved board state.** Every mutation persists per gesture:
  `persistAdd`/`persistAddGroup`/`persistMoveMembers`/`persistRemoveMembers`/`persistSetField` in
  `src/_pages/plan-detail/model/placement/board-writes.ts`, each an optimistic update plus one RPC
  with rollback. The archived writer-split and cleanup changes introduced no draft buffer. The only
  unsettled notion is the optimistic in-flight window:
  `const busy = reconciling || placements.some((p) => p.pending) || parkedBundles.some((c) => c.pending)`
  (`src/_pages/plan-detail/model/use-placements.ts:186`), already consumed by the Generate guard
  (`use-generate-plan.ts:103`) and already surfaced as *"Waiting for pending edits to settle"*
  (`GenerateButton.tsx:42`). **"Settle" is a guard, not a flush** — no dirty-tracking, no
  save-vs-discard UX.
- **Server-side assembly is reuse.** `assembleGeneratorSnapshot`
  (`src/entities/timetable/model/generation/assemble-snapshot.ts:33`) is pure and caller-agnostic;
  `loadPlanAnalysis` (`src/_pages/plan-comparison/api/load-plan-analysis.ts:87`) is the ~15-query
  full-plan server loader built to be shared with `bench/`; `bench/experiment-harness.ts:41,75`
  composes it with `loadPins` into exactly the snapshot S-301 needs. **Measured live: 84 ms.** The
  production work is promoting `loadPins` + `toSnapshot` out of `bench/` — and because a
  cross-`_pages` import would break steiger (there are currently zero such imports),
  `src/entities/timetable/api/` is the natural target, following the `solver-config.ts` precedent.
- **`clone_plan` needs no amendment.** The authoritative definition is
  `supabase/migrations/20260711174905_clone_plan_include_board.sql:15-22` —
  `clone_plan(p_source_plan_id uuid, p_name text, p_include_board boolean default true)`. With
  `p_include_board => true` it carries placements (incl. `week`, `is_optional`), bundles, shelf,
  groupings, colors, `finishes_early`. Measured live: **40 ms**. Two notes: `plans.name` has no
  unique constraint, so a generated "Proposal …" name is safe; and S-301 must go through the
  `clonePlan` **domain function** (`src/_pages/plans-list/api/clone-plan.ts:20`) or replicate its
  per-cohort `catalog_hash` refresh, or the proposal plan opens with a stale-groupings palette.
- **`apply_generated_placements` already targets an arbitrary plan.**
  `supabase/migrations/20260711202237_apply_generated_placements.sql:22-29`,
  `(p_plan_id uuid, p_cells jsonb, p_placements jsonb)`, one plpgsql function = one transaction, and
  already proven against a different plan id by `bench/experiment-harness.ts:113-139`.
- **The drift guard is experiment-only.** `assertCatalogMatches`
  (`bench/import-generated.experiment.ts:109-120`) is the pre-persist guard the PRD refers to, and it
  is bench code. Production `computeCatalogFingerprint` / `driftTier` exist but only *label metric
  trust* on the comparison page — they gate no write. Promoting a guard is S-301/S-306 work.
- **Phantom courses are handled only in bench.** `autoParkPhantomCourses` (`bench/auto-park.ts:26`)
  is applied before the POC's export because zero-student/zero-hours courses corrupt completeness,
  and it exists nowhere in `src/`. Server-side assembly from a real plan will meet this on the first
  production solve.

### F. Job and data integrity

- **"One active job per source plan" is already enforced in the schema** — a *partial unique index*,
  `generation_jobs_active_per_plan on generation_jobs (plan_id) where status in ('queued','running')`
  (`20260810200122_generation_jobs.sql:103-104`), confirmed live, with the migration explaining why
  ("two Workers can race the same enqueue"). S-301 owes only app-side `23505` translation into "a
  generation is already running for this plan". The six-value status CHECK already covers `stopped`
  (S-305) and `interrupted` (S-304), so those slices need no migration.
- **The credential posture is real, not just claimed.** Live catalog check:
  `anon` holds **zero of eight** privileges on `generation_jobs` (including MAINTAIN), so the
  migration's "anon is excluded, literally" claim survives the repo's own recorded
  granting-is-not-excluding lesson. `solver_job_writer` is `nologin`, no `BYPASSRLS`, member of
  nothing, and holds SELECT on the table plus UPDATE on exactly the 11 progress columns.
- **The RLS narrowing the migration assigns to S-301 is not expressible as written.**
  `20260810200931_solver_job_writer_role.sql:75-78` says `using (true)` "is EVERY job row, not the
  one the container was dispatched to solve … S-301 introduces that binding and is where this
  predicate can narrow." But the solver authenticates as **one shared machine user**, and the role
  claim is stamped per-user from `app_metadata` by the Custom Access Token Hook — there is no
  per-dispatch credential and the app deliberately holds no JWT signing secret. The achievable
  narrowing is to align SELECT with the existing UPDATE window
  (`using (status in ('queued','running'))`), which removes every terminal job's `snapshot`,
  `policy` and `result` from the role's reach and — combined with the partial unique index —
  collapses the readable set to at most one row per plan. **S-301 should implement that and rewrite
  the comment**, rather than leave a promise the mechanism cannot keep.
- **The snapshot binding is small and mechanical.** Read `snapshot_hash` in the same round trip by
  widening the claim CAS projection to `select=id,snapshot_hash` (the role already holds table-wide
  SELECT, so no grant change), then compare against a digest of `canonical_snapshot_json` of the
  body's snapshot. The canonicalizers exist on both sides —
  `services/solver/src/cpsat_engine/wire.py:51-53` ("the exact bytes
  `generation_jobs.snapshot_hash` digests") and `computeSnapshotHash`
  (`src/entities/timetable/model/generation/wire.ts:105-108`, Web Crypto, edge-safe) — but the Python
  side has **no digest yet** (no `hashlib` anywhere in `services/solver/`). Add a cross-language
  parity assertion to the existing byte-gate suites rather than assuming the two agree. Note the
  mismatch response can only be `failed` with a diagnostic: by the time the hash is readable the row
  is already `running`, and RLS forbids returning to `queued`.
- **Residual wedge state.** F-302's bounded retry converts most terminal-write failures into
  `failed`, but if both the terminal write and its follow-up fail, the row stays `running` forever —
  `claim` filters `status=eq.queued`, so nothing can reclaim it. This is correctly S-304's, and the
  roadmap already carries the widened-CAS scope note.
- **Narrow poll projections are mandated, not optional.** `snapshot` is ~100–124 KB and TOASTed;
  `result`/`checkpoint` ~35 KB. PostgREST's argument-less `.select()` returns every column. The
  migration header calls this "correctness-adjacent".

### G. The leaking seams (the scope question this research was widened to answer)

| Seam | State | Who should own it |
| ---- | ----- | ----------------- |
| Dispatch is unauthenticated and body-trusting | Documented in `services/solver/README.md`; hardened only with a `Content-Type: application/json` check (415 otherwise). Bounded today by *where the port is*: loopback in dev, a container binding in prod. | Mitigation is S-302's (preserve the binding); the **snapshot binding** is S-301's. |
| `snapshot_hash` never read | Confirmed: zero occurrences in `services/solver/src/`. | S-301 (see F). |
| ~12.5-minute solve vs a synchronous expectation | Reconfirmed here: the probe's full-catalog job claimed and ran with 8 workers well past any request budget. No `waitUntil` anywhere in `src/`. | S-301 must choose a trigger; the honest polling UI is S-303. |
| No delivery trigger exists | No cron in `wrangler.jsonc`, no `pg_cron`/`pg_net`, no webhook, no async-job pattern in `src/`. | S-301 ships an Action-triggered read; truly headless delivery is S-306 and is **undesigned anywhere**. |
| Wedged `running` rows | Retry mitigates, does not eliminate. | S-304 (already scoped). |
| Local DB policy-name drift | Live policy is `Solver reads its jobs`; the migration creates `Solver reads any job`. This DB was hand-patched rather than reset. | Housekeeping: `pnpm exec supabase db reset` before starting, and write S-301's policy migration with `drop policy if exists` for **both** names. |

## Full-flow probe

A temporary suite drove the entire proposed S-301 flow against the real stack: `clone_plan(include_board => true)`
→ server-side assembly from the **source** plan (`loadPlanAnalysis` + pins) → `computeSnapshotHash`
→ compare against a clone-assembled hash → insert `generation_jobs` → `dispatchSolveJob` → poll to
terminal → `verifyGeneration` server-side → natural-key `courseId` translation →
`apply_generated_placements` onto the clone.

**It passed, with every assertion green.** Measured, on the real 84-course / ~250-hour seed catalog
(`Seed Plan A`):

| Step | Measurement |
| ---- | ----------- |
| `clone_plan(..., include_board => true)` | **40 ms** |
| Server-side snapshot assembly (`loadPlanAnalysis` + pins) | **84 ms** |
| `computeSnapshotHash` + clone-hash comparison | source hash **≠** clone hash (the §B contradiction, demonstrated) |
| Enqueue into `generation_jobs` + `dispatchSolveJob` | accepted **202**; claimed by the compare-and-set, 8 workers |
| Full ten-tier solve | claimed 10:02:47.678 → succeeded 10:14:02.834 = **11 min 15 s** |
| Board returned | **250 placements — a complete board** (250 required hours, 0 unplaced) |
| `verifyGeneration` server-side, against the source-assembled snapshot | **`ok = true`** |
| Natural-key `courseId` translation | every id mapped (the probe throws on any unmapped course) |
| `apply_generated_placements` onto the clone | applied; clone holds **250** placements, matching the result |

Four things this settles that no amount of reading could:

1. **The whole S-301 flow composes.** The seams do meet, in the order the slice proposes, against real
   data — including the source-assembled/clone-applied resolution recommended in §B, which is
   therefore not a hypothesis but a demonstrated path.
2. **The oracle accepts a real production-shaped CP-SAT board** produced by the real service and
   judged server-side against the snapshot it was solved from.
3. **The raw seed catalog is solvable without the bench-only `autoParkPhantomCourses` transform** —
   `Seed Plan A` has no phantom courses, so §E's risk is real but did not fire here. It remains
   unproven for a production catalog, which is why it stays an open question rather than a settled one.
4. **The solve time is confirmed independently of F-302's measurement**: ~11¼ minutes for the full
   ladder at the engine's default 120 s per stage. This is the number that makes the delivery trigger
   (§G) unavoidable, and it is why S-303 owns progress and S-308 owns budgets.

The probe artifacts were removed after the run and its rows cleaned up; nothing in the repo or the
database retains them.

## Code References

- `src/entities/timetable/model/generation/run.ts:16-31` — the runner seam S-301 relocates
- `src/entities/timetable/model/generation/verify.ts:51-55` — the oracle; pure, ~1.7 ms on the real catalog
- `src/_pages/plan-comparison/api/load-comparison.ts:125` — proof the oracle already runs in workerd
- `src/entities/timetable/api/solver-transport.ts:49-52` — dispatch + timeouts; **no production caller yet**
- `src/entities/timetable/api/solver-config.ts:23` — `getSolverTransport()`; import at its own path, never via the barrel
- `src/entities/timetable/model/generation/wire.ts:105-108` — `computeSnapshotHash` (Web Crypto)
- `src/entities/timetable/model/generation/assemble-snapshot.ts:33` — the one snapshot assembly
- `src/_pages/plan-comparison/api/load-plan-analysis.ts:87` — the full-plan server loader to reuse
- `bench/experiment-harness.ts:41,75,113` — `loadPins` / `toSnapshot` / `persistRegion`, the pieces to promote
- `bench/import-generated.experiment.ts:62,109-120` — the delivery pipeline already written, as an experiment
- `bench/auto-park.ts:26` — phantom-course transform that exists only in bench
- `src/_pages/plan-detail/model/use-placements.ts:186` — the `busy` flag that *is* "settle"
- `src/_pages/plan-detail/model/placement/board-writes.ts` — per-gesture persistence (why there is no unsaved state)
- `supabase/migrations/20260810200122_generation_jobs.sql:49-55,103-104` — hash semantics; the one-active-job index
- `supabase/migrations/20260810200931_solver_job_writer_role.sql:58-71,75-88` — column-scoped grants; the narrowing note
- `supabase/migrations/20260711174905_clone_plan_include_board.sql:15-22,39-59` — authoritative `clone_plan`; the id maps
- `supabase/migrations/20260711202237_apply_generated_placements.sql:22-29` — the only write path for generated boards
- `services/solver/src/cpsat_engine/objective.py:59-70,107-110,176-186` — tier tuple; pin constants; `softHits`
- `services/solver/src/cpsat_engine/solve.py:31-41,109-128,196-200,358` — `SolveConfig`; `parity()`; where clean mode goes; the hardening inequality
- `services/solver/src/cpsat_service/supabase.py:95-114` — the claim compare-and-set
- `services/solver/src/cpsat_service/runner.py:144,170` — the only `solve_complete` call; the infeasibility message
- `src/test/solver-transport.integration.test.ts:153-168` — "mirrors what S-301's Action will do"

## Architecture Insights

- **The seams were built for this, and they held.** The engine-agnostic port, the injected-engine
  runner, the pure oracle, the atomic RPC, the shared plan loader, `clone_plan`'s `p_include_board`,
  and F-301's forward-designed table all compose without modification. The parts of S-301 that are
  large are the parts nobody built yet — the trigger and the delivery pipeline — not the parts being
  reused.
- **F-301 forward-designed more than a schema.** Six status values, the checkpoint columns, the
  `proposal_plan_id`/`delivered_plan_id` links, and the partial unique index mean S-303, S-304 and
  S-305 need no migration. The schema is ahead of the slices.
- **Config-gating is what keeps the CP-SAT gate honest.** Because `parity()` and `evaluate_board()`
  take no config, any engine change reachable only through a defaulted-off flag is invisible to the
  10/10 gate. That is a reusable discipline for S-307, not just a clean-mode convenience.
- **The repo's own recorded lessons predicted two findings here.** "A convention that cites a code
  mechanism is coupled to it" explains both the roadmap's stale `objective.py`/`solve.py` line refs
  and the "settles unsaved board state" phrasing that no longer matches the code. "Granting a role is
  not excluding the others" is the check that confirmed `anon`'s posture live rather than from
  migration prose. Both were worth re-running rather than trusting.
- **Prose-vs-mechanism risk is concentrated in the RLS comment.** Shipping S-301 while leaving
  `using (true)` and a comment claiming S-301 fixed it would manufacture exactly the drift the
  lessons file warns about.

## Historical Context (from prior changes)

- `context/archive/2026-08-11-solver-service-transport/change.md:65-79` — the decision that dispatch
  is unauthenticated and unbound to the row, with the snapshot binding explicitly handed to S-301.
- `context/archive/2026-08-11-solver-service-transport/change.md:83-98` — the barrel client-safety
  constraint (`S-301 imports solver-config directly`) and the ~12.5-minute full-catalog measurement.
- `context/archive/2026-08-11-solver-service-transport/change.md:57-60` — S-307 flagged as
  under-scoped, with clean mode named as unimplemented.
- `context/archive/2026-08-11-solver-service-transport/reviews/impl-review.md` — the ten findings
  whose fixes were re-verified here (F1–F10).
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/` — the frozen contract and the
  least-privilege credential design S-301 narrows.
- `context/archive/2026-07-15-poc-cp-sat-backend-service/results.md:139-196` — the three-board
  frontier, the clean board's dominance, and the confirmation that clean mode was produced by a
  **hard constraint**.
- `context/changes/post-poc-cp-sat-refactoring-plan/research.md` — the seed research for this
  migration, incl. the "~12–20 min in cloud" extrapolation.

## Related Research

- `context/archive/2026-08-11-solver-service-transport/research.md` — F-302 feasibility; §1.1
  first recorded that clean mode is unimplemented, and §6 that CP-SAT is not a second `GeneratePlan`.
- `context/archive/2026-08-10-solver-contract-and-jobs-schema/research.md` — contract + jobs schema.
- `context/archive/2026-07-11-plan-generation/research.md` — the original "verify costs ~1 ms" and
  200 ms-budget reasoning this research re-measured.

## Feasibility verdict

**Feasible. Proceed to `/10x-plan`, after recording two decisions.**

Must be decided before planning (both are design forks, not obstacles):

1. **Snapshot id space and the `snapshot_hash` baseline** — recommend option (A): assemble and hash
   from the **source**, translate `courseId` to the clone at apply time via the natural key
   (validated 84/84). Record it in `change.md`; it sets S-306's cost.
2. **Clean-mode infeasibility semantics** — refuse with a message naming the soft cells, or fall back
   to non-clean and flag the board? FR-302's "shipped default" argues for the fallback.

Ordinary work, no obstacles found: wiring dispatch, server-side assembly (promote two bench
functions), the enqueue Action with `23505` handling, the snapshot binding + Python digest + parity
assertion, the achievable RLS narrowing, the server-side oracle call site, the clean-mode engine flag
(~15–25 lines plus ~3 tests), and `apply_generated_placements` onto the clone.

Larger than the Outcome sentence implies, and worth sizing explicitly in the plan: the **delivery
trigger and pipeline**, which do not exist in any form today.

Smaller than the Outcome sentence implies: **"settles unsaved board state"** is an existing `busy`
guard.

Housekeeping before starting: `pnpm exec supabase db reset` (policy-name drift), and consider
pinning policy names/predicates in `src/test/solver-credential.integration.test.ts` so that class of
drift cannot recur silently.

## Open Questions

1. **Which id-space option?** (A) source-assembled + natural-key translation *(recommended)*,
   (B) clone-assembled + a second source-side digest column, or (C) clone at delivery. Owner: author,
   before `/10x-plan`.
2. **Clean-mode infeasibility: refuse or fall back?** Owner: author, before `/10x-plan`.
3. **What triggers the result read in S-301?** An Action fired by the launching page is the honest
   minimum; anything headless is S-303/S-306 and is undesigned. Owner: plan phase.
4. **Does the raw seed/production catalog need `autoParkPhantomCourses` promoted into `src/`?**
   Bench applies it before every solve; nothing in production does. Owner: plan phase.
5. **Should the roadmap's S-301 Outcome be trued up** ("assembles from the clone", "settles unsaved
   board state") once (1) is decided? Owner: author.
6. **Is `code` the intended cross-plan teacher natural key?** Not needed for S-301 (results carry no
   teacher ids), but `full_name` is unusable (18 teachers, 1 distinct value) and this will matter the
   first time teachers need cross-plan identity. Owner: parked.
