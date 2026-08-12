# First Verified Proposal (S-301) — Plan Brief

> Full plan: `context/changes/first-verified-proposal/plan.md`
> Research: `context/changes/first-verified-proposal/research.md`

## What & Why

The north-star slice: an author starts a CP-SAT solve on a plan and receives a complete,
oracle-verified board on a proposal plan — proving that contract, jobs schema, service, and the
server-side oracle compose into one trustworthy flow. Ships the clean-mode default (FR-302) as
pinned-floor semantics: *the author's pins are their decision; the solver will not make it worse.*

## Starting Point

F-301/F-302 delivered the frozen wire contract, the `generation_jobs` table (forward-designed:
statuses, links, one-active-job index all exist), and a tested dispatch transport with **zero
production call sites**. Research drove the entire proposed flow end to end on the real stack
(clone → source-side assembly → 11¼-min solve → oracle → id translation → apply): every assertion
passed. What's genuinely missing: clean mode in the engine, the hash binding, the enqueue/delivery
Actions, any result trigger, and any job UI.

## Desired End State

The plan-detail Generate button enqueues a durable CP-SAT job (clone created as the proposal
target). A status strip shows the active job; on revisit or refresh after completion the app
verifies the board server-side, translates course ids to the clone, applies atomically, and shows
"Proposal ready — open" with honest clean labelling. Failures show a diagnostic and remove the
orphan clone. A tiny-fixture E2E test proves the chain in CI.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Clean-mode semantics | Constrain `softHits == pinned floor`, at the feasibility stage, config-gated | `== 0` is unsatisfiable with one pin on a soft cell; config-gating keeps the 10/10 parity gate untouched by construction | change.md |
| Clean infeasibility | Pre-solve floor + one non-clean fallback, labelled, never refused | A default that refuses is a bad default; today's error path would report a falsehood | change.md |
| Snapshot id space | Assemble + hash from the **source**; translate `courseId` to the clone at apply (option A) | Clone re-mints all UUIDs (0/84 survive); natural key validated 84/84; matches the schema author's design | change.md |
| Result-read trigger | On-visit check + manual refresh | Honest minimum; FR-313's *location* satisfied, its headless *rationale* explicitly deferred to S-303/S-306 | Plan |
| Launch surface | Existing Generate button switches engines to CP-SAT | One affordance; greedy can't produce valid results and loses only its entry point | Plan |
| RLS narrowing | Ship `using (status in ('queued','running'))` + rewrite stale comment | Per-dispatch binding is impossible with one machine credential; this removes terminal rows from reach | Plan |
| Phantom courses | Promote `autoParkPhantomCourses` from bench into `src/` | Production assembly does what bench and the human expert already do; refusing default rejected | Plan |
| Result/failure UX | Minimal status strip (active / ready / failed states) | Every terminal state visible with one component; S-303 upgrades it in place | Plan |
| Failed-job clone | Delete the orphan (guarded: own `proposal_plan_id`, undelivered only) | No plans-list clutter; retry gets a fresh T0 snapshot | Plan |
| E2E verification | Tiny-fixture integration test in the existing CI integration job | The full real chain crossed on every push; full-catalog solve (~12 min) stays manual | Plan |

## Scope

**In scope:** engine clean-mode flag + fallback; Python snapshot digest + post-claim hash binding +
cross-language parity assertion; RLS status-window migration; relocating `loadPlanAnalysis`/
`clonePlan` to `entities/timetable/api/` (steiger forbids cross-`_pages` imports); promoting
`loadPins`/`toSnapshot`/`autoParkPhantomCourses`; enqueue + check-and-deliver Actions; course-map
translation; status strip; tiny-fixture E2E test; roadmap wording truth-up; two stale comments.

**Out of scope:** polling/headless delivery (S-303/S-306), policy picker (S-307), cancel (S-305),
wedged-row reclaim (S-304), container deploy (S-302), greedy removal, drift-decided delivery,
per-job credentials, any wire-contract change.

## Architecture / Approach

Enqueue: assemble + hash from source (pure) → clone → insert job (`23505` → "already running") →
dispatch (failure → mark failed + delete clone). Solver: claims with widened CAS, binds
`snapshot_hash`, solves with clean default (floor constraint at feasibility, fallback once).
Delivery (Action, on visit/refresh): narrow status read → on success verify via the injected-engine
`runVerifiedGeneration` seam → natural-key `courseId` map → `apply_generated_placements` onto the
clone → delivered-marker CAS. Cleanliness is derived (floor recomputed app-side vs tier-5
`StageReport.best`) — no new field anywhere.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Engine: clean mode + hash binding | Clean default + fallback; digest parity; 3+ tests; comment fixes | Floor math must exactly mirror tier-5 pin constants |
| 2. DB: RLS narrowing | Status-window SELECT policy + truthful comment + posture pinned in tests | Local policy-name drift (mitigated: `db reset`, `if exists` for both names) |
| 3. App: assembly + enqueue | Loader relocations, bench promotions, enqueue Action, Generate button swap | FSD relocation ripples through plan-comparison/plans-list/bench imports |
| 4. App: delivery + strip | Verify → translate → apply → delivered CAS; orphan cleanup; status strip | Idempotency under concurrent refresh (CAS on `delivered_plan_id`) |
| 5. E2E proof + truth-up | Tiny-fixture CI test; roadmap wording fixes; full gates | Fixture must solve in seconds yet exercise the full ladder |

**Prerequisites:** local Supabase stack (`db reset` first), solver machine user provisioned, native
solver running for integration tests.
**Estimated effort:** ~4–5 sessions across 5 phases (engine + app + one migration + one E2E test).

## Open Risks & Assumptions

- Clean-mode satisfiability evidence is n=1 (one soft teacher in all dumps) — the fallback path is
  the mitigation, and it must be tested, not just designed.
- The tiny E2E fixture's solve time is assumed seconds; if the ladder drags in CI, shrink the
  fixture or cap stage budgets via `SolveConfig`.
- FR-313 is satisfied in *location* only; the plan states the headless rationale is deferred.

## Success Criteria (Summary)

- An author can Generate, come back, and open a complete, oracle-verified, clean(-as-permitted)
  proposal — with every failure mode visible and honest.
- CI proves the full chain on every push (tiny fixture); all existing gates (parity 10/10, steiger,
  `pnpm check`, solver lane) stay green.
- No wire-contract change, no golden regeneration, no stale prose left behind.
