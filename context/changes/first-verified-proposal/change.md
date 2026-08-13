---
change_id: first-verified-proposal
title: First verified proposal
status: impl_reviewed
created: 2026-08-12
updated: 2026-08-13
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Decisions

- **2026-08-12 — Clean mode ships in S-301, and its promise is "the solve adds no NEW soft
  violations" — not `softHits == 0` literally.** FR-302 makes clean mode the _shipped default_, so it
  cannot be deferred to S-307 (which adds the selectable alternatives on top of it); the roadmap's own
  Unknown already recorded that it is not inherited from the POC. Mechanism: compute the **pinned
  floor** of tier 5 before solving — a set intersection of pins against soft availability cells,
  microseconds — then constrain `softHits == floor` rather than `== 0`. Rationale: pinned rows enter
  tier 5 as an irreducible constant (`services/solver/src/cpsat_engine/objective.py:107-110`), so a
  single author-placed lesson on a soft cell makes `softHits == 0` unsatisfiable no matter what the
  solver does with the free hours — measured: identical snapshot, `complete` without clean mode,
  **INFEASIBLE** with it. Constraining to the floor costs exactly the same (one linear constraint,
  ~0.6 s measured), and when `floor == 0` — the common case, and every case in the available data —
  it _is_ `softHits == 0`, so FR-302's literal spec is satisfied whenever it is satisfiable. The
  product rule becomes statable in one sentence: the author's pins are their decision; the solver will
  not make it worse. Rejected: refuse the run on clean-infeasibility (a default that refuses is a bad
  default), and drop clean mode from S-301 (the POC's clean board _dominated_ the canonical board on
  every prioritised tier — shipping the north star with the less-valued default would make the first
  proposal an author ever sees the worse one).

- **2026-08-12 — Clean-infeasibility is DETECTED before the solve, never inferred from an
  `INFEASIBLE` status; exactly one fallback covers the genuinely-hard case.** Today the inference
  path lies: `_assert_pins_precondition` (`model.py:379-389`) inspects only hard rules so no
  `PreconditionError` fires, `runner.py:170` then writes _"infeasible: the snapshot admits no complete
  board under the hard rules"_ — false, the hard rules are fine — and `explain_infeasibility`
  (`explain.py:34-38`) reasons only over completeness literals, so it would name **courses** as the
  conflict and never mention the soft cell. The author would read "your plan cannot be completed" plus
  a list of innocent courses. Computing the floor up front lets the message name the offending cells
  instead. Fallback, for the case where `softHits == floor` is _still_ infeasible (many soft teachers
  — outside all current evidence, see the n=1 caveat in `research.md` §C): drop the constraint,
  minimise tier 5 normally, and let the board through **labelled**, never refused. Costs one extra
  ~0.6 s solve in a rare case.

- **2026-08-12 — Clean mode is a defaulted-off `SolveConfig` flag applied at the FEASIBILITY stage;
  no contract change, and the cleanliness signal already exists on the wire.** Four implementation
  constraints, each load-bearing:
  1. **Placement.** The constraint goes at the completeness/feasibility solve
     (`services/solver/src/cpsat_engine/solve.py:196-200`), **not** next to `build_objective` after
     Mode A. Otherwise a later ladder stage returning neither OPTIMAL nor FEASIBLE leaves
     `best = None`, no hardening happens (`solve.py:356-358`), and `_generated(incumbent)` returns the
     **pre-clean** incumbent — `softHits` possibly > 0 — while `runner.py:148` still writes
     `succeeded`. A silently broken promise behind a green status.
  2. **Config-gated, never `build_model`.** A `clean_mode: bool = False` field on `SolveConfig`
     (`solve.py:31-41`) read only inside `solve_complete` is invisible to the 10/10 objective-parity
     gate **by construction**, because `parity()` (`solve.py:109-128`) and `evaluate_board()` take no
     `SolveConfig`. Implementing it as variable pruning in `build_model` would be mathematically
     equivalent but would put the gate's own model inside the change. This is the whole reason the
     work is ~15–25 lines rather than a gated engine project.
  3. **No contract change.** `SolveRequest` is `{formatVersion, snapshot, warmStart?}` with
     `additionalProperties: false` and F-302 decided the solver does not read
     `generation_jobs.policy`, so the clean default is necessarily **solver-side** — which is exactly
     what FR-302 asks for. Zero schema edit, no `formatVersion` bump, no golden regeneration, no
     bilateral commit. S-307 still inherits the policy-carrier decision.
  4. **Cleanliness is a derived read, not a new field.** `GenerationDiagnostics` is
     `additionalProperties: false` with no cleanliness property — but none is needed: tier 5's
     `StageReport.best` in `generation_jobs.stages` **is** the achieved `softHits`, and F-302's runner
     already writes `stages` on both the success and failure paths.

- **2026-08-12 — Definition of done for the clean-mode work includes three tests and two stale
  comments.** Tests (all fast micro-tests): (a) clean mode drives `softHits` to 0 on a snapshot whose
  unconstrained optimum would not — the `b.soft(...)` builder already exists
  (`services/solver/tests/builders.py:49-50`); (b) pin-on-soft-cell produces the distinct, honest
  outcome, explicitly asserting it is **not** "infeasible under the hard rules"; (c) the runner
  actually requests clean mode (one assertion on the recorded `SolveConfig` in `tests/test_service.py`).
  Discipline note: run the **golden** parity test locally before claiming green — it is `skipif`-gated
  on the dump's presence, so a green CI does not prove it. Comments to correct in the same diff:
  `services/solver/src/cpsat_engine/schema.py:76` (soft severity as "a tier-5 objective term, **never
  a constraint**" becomes false) and the soft-tier framing in
  `contracts/generation-wire.schema.json`'s `AvailabilitySeverity` description (impl-review
  correction: the plan named `contracts/README.md`, but the stale prose lived in the schema's
  description annotation — canonical form untouched, fixtures byte-identical) — leaving them is the
  prose-coupled-to-mechanism drift `context/foundation/lessons.md` warns about.

- **2026-08-12 — Snapshot id space: assemble and hash from the SOURCE; translate `courseId` to the
  clone at apply time (option A).** Resolves the contradiction in `research.md` §B. The roadmap's S-301
  Outcome says the snapshot is "assembled from the clone"; the schema header
  (`supabase/migrations/20260810200122_generation_jobs.sql:49-55`) says `snapshot_hash` is "computed
  over the SOURCE plan at T0 … so `clone_plan`'s UUID re-minting never enters it". Both cannot hold —
  `clone_plan` re-mints every course UUID through six `gen_random_uuid()`-defaulted temp maps
  (`20260711174905_clone_plan_include_board.sql:39-59`), **measured: 0 of 84 course ids survive a
  clone**. Under the clone-assembled reading, FR-307's drift check (re-assemble the source at T1,
  re-hash, compare) would report drift on **every** run and S-306's auto-apply could never fire, while
  applying clone-id placements to the source would be an FK error. Chosen: the schema header's intent —
  assemble the snapshot from the source, hash the source, dispatch the source's snapshot, and
  translate `courseId` into the clone's id space at apply time. So the **roadmap sentence is the thing
  that is wrong**, not the schema.

  Why this is cheap rather than an identity-mapping project, all measured: the frozen contract's
  `GeneratedPlacement` is `{cohort, courseId, day, period, week}` with `additionalProperties: false`,
  so **`courseId` is the only id that comes back**; and the natural key
  `(cohort, name, level, group_index)` is **unique across all 84 source courses** and **matches 84/84
  across the clone**, because `clone_plan` copies those columns verbatim. One unambiguous `Map`, one
  dimension. The full-flow probe drove exactly this path end to end and applied all **250** returned
  placements onto the clone with every id mapped — so this is a demonstrated route, not a design
  hypothesis.

  Rejected: **(B)** assemble/hash from the clone and add a second source-side digest column — coherent,
  but costs a migration the schema header's design deliberately avoided, and puts two hashes on one row
  that can disagree; **(C)** clone at delivery instead of at enqueue (`proposal_plan_id` is nullable,
  so it would be consistent) — but it contradicts the roadmap's S-301 wording and pushes work into
  S-306 without making anything cheaper.

  Consequences to carry into the plan: the snapshot binding (§F) compares the row's `snapshot_hash`
  against the **dispatched** snapshot, which is the source's — internally consistent, no special case.
  A source→clone course map helper is new production code; the only existing mapper is bench-only
  (`bench/fixture-courses.ts`). And **do not generalise the natural-key trick**: teachers are not
  natural-keyable on `full_name` (measured: 18 teachers, **1** distinct value; `code` is the real key).
  It is safe here only because results carry no teacher or student ids.

- **2026-08-12 — UI labelling: name the residue honestly rather than call a floor-clean board
  "clean".** When `floor > 0` the board is clean-as-permitted, not clean; surface it as e.g. "clean —
  2 pinned hours remain on soft cells" with the hint that unpinning them goes fully clean. Rejected:
  keeping "clean" strict and requiring the author to unpin first (makes the shipped default refuse).

### Found during implementation

- **2026-08-12 (Phase 2) — the RLS status-window narrowing is NOT shippable, and the narrowing that
  is turned out to be better. Measured, not reasoned.** The plan (and `plan-review.md`'s Grounding,
  which recorded it as deep-verified) held that `using (status in ('queued','running'))` was safe for
  the solver's own writes because "`finish` PATCHes while the row is still `running`". That is only
  half the rule. **PostgREST's UPDATE always carries a `RETURNING`, and Postgres applies SELECT
  policies to the NEW row** — so the row's post-write status has to satisfy the SELECT window too.
  Live measurements against the local stack with the machine credential:

  | probe | result |
  | --- | --- |
  | `finish`, `return=representation` (shipped code) | **403 `42501` "new row violates row-level security policy"**, row stuck `running` |
  | `finish`, `return=minimal` | 403 — so it is not the representation preference |
  | `finish`, `return=minimal,count=exact` | 403 |
  | same write, window widened to include `succeeded` | **200**, row reaches `succeeded` |

  A window would therefore have to admit every state the solver may declare (`succeeded`/`failed`/
  `stopped`/`interrupted`, per the UPDATE policy's WITH CHECK) plus `queued`/`running` — all six,
  i.e. `using (true)` spelled at length. It would have narrowed nothing while producing a solver that
  can never record a result. Only Phase 2's insistence on running the transport suite caught it;
  `solver-transport.integration.test.ts` went red at "never settled; observed: queued -> running".

  **Shipped instead: a COLUMN-scoped SELECT grant** (`id`, `status`, `snapshot_hash`), row predicate
  left at `using (true)` with the reasoning and the measurements in the migration. This is strictly
  stronger than the intended win: `snapshot` (~124 KB), `policy`, `result`, `error`, `stages`,
  `checkpoint`, `plan_id`, `proposal_plan_id`, `delivered_plan_id` and `delivery` leave the role's
  reach **on every row**, not just terminal ones, and a bare `select=*` is refused outright (403).
  Verified live: the claim (`select=id,snapshot_hash`) and the terminal write (which *writes* `result`
  while holding no SELECT on it) both return 200.

  Two stale claims in `20260810200931_solver_job_writer_role.sql` fall out of this and are marked
  superseded in place: the forward promise that S-301 would narrow the predicate, and "the solver
  needs the whole row, `snapshot` above all, to solve at all" — F-302's dispatch carries the snapshot
  in the request **body**, so the service SELECTs only `id`, `status` and `snapshot_hash`
  (`cpsat_service/supabase.py:114,186`).

  **Row-level narrowing is deferred, not abandoned**: it requires moving the terminal write behind a
  `security definer` RPC so the SELECT policy stops governing it — a rewrite of F-302's reviewed
  transport, and its own slice.

  Also corrected: `src/test/postgres-client.ts` documented `has_table_privilege` as reporting true
  when a role holds the verb on any column. It is the opposite — it sees table-level grants only and
  is blind to column grants (verified both ways). That false docstring produced one wrong assertion
  before the catalog corrected it.

- **2026-08-13 (Phase 3) — the plan's relocation into `entities/timetable/api/` is not reachable
  from `_pages`, by either route; the enqueue path assembles from the slice's OWN loader instead.**
  The plan moved `loadPlanAnalysis` + `clonePlan` into the entity and imported them at their own
  paths, inheriting that contract from `solver-config.ts`'s docstring. Measured with throwaway probes:

  | probe | verdict |
  | --- | --- |
  | `_pages/plan-detail` → `@/_pages/plan-comparison/api` | ✘ `fsd/forbidden-imports` — the plan's premise holds |
  | `_pages/plan-detail` → `@/entities/timetable/api/solver-config` | ✘ **error** `fsd/no-public-api-sidestep` |
  | `_pages/plan-detail` → `@/entities/timetable/api` (segment index) | ✘ **error**, same rule |
  | `src/actions/…` → `@/entities/timetable/api/solver-config` | ✔ `src/actions/` is outside the FSD graph |

  Own-path import is a CI-failing error, not a convention — and nothing had ever proved otherwise,
  because `solver-config` had zero call sites. Barrel-exporting is worse: both modules import
  `@/shared/api`, whose barrel exports `createClient` → `astro:env/server`, so the entity barrel
  would break **every React island** that imports it, not merely the greedy worker the plan reasoned
  about. Three consequences, all shipped:

  1. **No `loadPlanAnalysis` relocation.** `plan-detail`'s own `loadCombinedPlannerData` already
     loads exactly what `assembleGeneratorSnapshot` needs — the same inputs the board feeds the
     CLIENT-side assembler (`use-cohort-board-state.ts`). So the snapshot the server hashes is, by
     construction, the one the author's board would build. `plan-comparison` and `bench/` are
     untouched, and `loadPins`/`toSnapshot` stay in bench (nothing in `src/` needs them; both sides
     still funnel through the one `assembleGeneratorSnapshot`, which was the actual anti-drift
     guarantee).
  2. **`clonePlan` → `src/shared/api/`**, not the entity: it touches no entity type, only shared
     accessors and the shared catalog hash, and that segment already hosts `loadCohortCourses` /
     `loadPlanSummary`. Both `_pages` consumers reach it legally.
  3. **The solver transport is INJECTED from `src/actions/`**, which is outside steiger's graph:
     the slice exports `createGenerationActions(deps)` and the composition root supplies
     `getSolverTransport`. Same split as `solver-transport`/`solver-config`, one level up — and it
     keeps the enqueue domain function unit-testable without `astro:env/server`.

- **2026-08-13 (Phase 4) — the on-visit check runs in the PAGE RENDER, not in a mount effect.** The
  plan said "the hook fires the check action on mount". Written that way it fails lint twice over:
  `react-hooks/exhaustive-deps` (suppressing which makes the **React Compiler skip optimizing the
  whole hook** — it says so explicitly) and then `react-hooks/set-state-in-effect`, React 19's rule
  against fetch-and-set-state effects. Rather than fight both, the check moved to where the visit
  actually happens: `src/pages/plans/[id]/index.astro` calls `checkGeneration` in its frontmatter and
  passes the result down as `generationJob`, which seeds the strip. Strictly better than the planned
  shape — the trigger is now literally the visit, with no client round-trip and no frame of empty
  strip — and the hook keeps only what the author does *after* the page exists (launch, refresh). The
  page-render call is wrapped so a delivery failure degrades to "no job" instead of 500-ing the board.

- **2026-08-13 (Phase 4) — `translateCourseIds` ships in Phase 3's `course-map.ts`, not Phase 4.**
  The plan scoped the map to Phase 3 and the translation to Phase 4. A bare `Map` invites an
  unguarded `.get()` at exactly the point where a miss means a silently short board, so the guarded
  translation lives beside the map and is unit-tested with it.

- **2026-08-13 (Phase 5) — the new E2E suite forced a CI change the plan did not carry:
  `SOLVER_MAX_CONCURRENT_JOBS=2`.** The service defaults to a cap of 1 and answers 503 past it —
  correct for production, where one container solves one ~12-minute job. But the integration lane now
  has TWO suites that dispatch (`solver-transport` and `generation-proposal`) and CI runs
  `--maxWorkers=2`, so they race and the loser gets a 503. Caught locally, on the full-suite run,
  before it could land as a flaky gate. Sized the cap to the worker cap rather than retrying around
  it or serializing the suites: the cap is a capacity contract, not a queue. The two numbers now have
  a comment tying them together in `ci.yml`, and the README says the same for local runs.

- **2026-08-13 (impl review) — the enqueue ordering cannot forbid a stranded `queued` row; the
  window is S-304 inherited scope.** Process death between `insertJob` and `dispatch` (or a failed
  dispatch whose best-effort `markDispatchFailed` also fails) leaves a `queued` row that trips the
  partial unique index — Generate answers "already running" forever, recoverable only by manual DB
  surgery. The module docstring previously overclaimed that the ordering "forbids" this state;
  corrected. S-304's stale-job reclaim must cover app-side `queued` staleness, not only
  wedged-`running` rows.

### Resolved during `/10x-plan` (2026-08-12)

The three formerly-open items, plus four solution-design choices made in the planning session — all
recorded with rationale in `plan-brief.md` (Key Decisions table) and specified in `plan.md`:

1. **Result-read trigger: on-visit check + manual refresh.** The plan states out loud that FR-313's
   _location_ is satisfied and its "without a browser open" _rationale_ is deferred to S-303/S-306.
2. **`autoParkPhantomCourses` is promoted into `src/`** — production assembly does what bench does
   before every solve; the refusing-default alternative was rejected (same philosophy as clean mode).
3. **RLS narrowing ships now**: `using (status in ('queued','running'))` plus the comment rewrite,
   with policy name/predicate pinned in `solver-credential.integration.test.ts`.
4. **Launch surface**: the existing Generate button switches engines to CP-SAT (greedy keeps its code,
   loses its entry point). 5. **Result UX**: minimal status strip (active/ready/failed). 6. **Failed
   jobs delete the orphan clone** (guarded: own `proposal_plan_id`, undelivered only). 7. **CI proof**:
   tiny-fixture E2E integration test in the existing integration job.

### Roadmap truth-up owed (consequence of the id-space decision)

`context/foundation/roadmap.md:113` (S-301 Outcome) now contains two statements the code contradicts.
Neither is a scope change — both are wording:

- "**assembles the snapshot from the clone** server-side" → assembles from the **source**; the clone is
  the apply target, reached by `courseId` translation.
- "the app **settles unsaved board state**" → there is no unsaved board state (every mutation persists
  per gesture, `src/_pages/plan-detail/model/placement/board-writes.ts`); "settle" is the existing
  `busy` guard, already labelled "Waiting for pending edits to settle"
  (`src/_pages/plan-detail/ui/chrome/GenerateButton.tsx:42`).

### Found during research

- **2026-08-12 — the local Supabase stack carries policy-name drift.** Live policy on
  `generation_jobs` is `Solver reads its jobs`; the migration
  (`20260810200931_solver_job_writer_role.sql:79`) creates `Solver reads any job`. Predicates are
  identical (`using (true)`) so the security posture is unaffected, but a naive
  `drop policy "Solver reads any job"` in S-301's migration will error on this machine. Run
  `pnpm exec supabase db reset` before starting, and write the drop as `drop policy if exists` for
  **both** names. Nothing asserts a policy name anywhere, which is why this drifted silently —
  consider pinning names/predicates in `src/test/solver-credential.integration.test.ts`.
- **2026-08-12 — the solver machine user's local password was rotated during research**
  (`scripts/provision-solver-user.mjs` is idempotent; rotation is the same operation as creation). Any
  previously-held local value no longer works — re-provision with your own before `mise run solver:dev`.
