# Comparing Plans — Plan Brief

> Full plan: `context/changes/comparing-plans/plan.md`
> Research: `context/changes/comparing-plans/research.md`

## What & Why

Give the plan author an in-app surface to compare two or more plans side by side, using the analyzer that
already exists. Today the only way to see how a generated plan stacks up against the expert's golden plan
is a terminal CLI that prints raw UUIDs. This is the deferred **"Option C"** from `plan-quality-analyzer`
— its gating condition (*"until after the expert session validates which features matter"*) was satisfied
by `generation-quality-tuning`, so the block is lifted.

## Starting Point

The expensive part is already paid for. `analyzePlan` is a pure, Workers-safe fold whose own docblock
states the intent: *"so a future in-app surface reuses it verbatim."* The plan-id → analyzer-input loader
exists in `bench/` and moves into `src/` unchanged. Two-plan loading already runs today, and the bench's
text report already renders N plans as N columns. What's missing is a route, a slice, a React table, a
picker, name resolution — and one thing nobody has built: a **cross-plan catalog-drift detector**.

The trap: the existing `catalog_hash` cannot do that job. It digests course/teacher/student **UUIDs**, and
`clone_plan` re-mints every one — so even a clone and its own source hash differently. It isn't broken; it
answers a different question (intra-plan staleness). Cross-plan equivalence needs a new fingerprint over
**natural keys**.

## Desired End State

An author opens **Compare** from the Plans hub, picks plans, and lands on
`/plans/compare?plans=…&baseline=…`. They see a rule verdict per plan, a banner naming any catalog drift
from the baseline, and five scoreboard sections at full parity with the CLI report — each in a
frozen-pane container so the header row and the metric-label column stay visible while scrolling.
Every numeric metric carries a signed delta against the baseline. Worst teacher and worst student show
**names**, not UUIDs.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| N-plan shape | Model `{ baselineId, planIds[] }`; UI comfortable at 2–4 | Free today (`analyzePlan` has zero pairwise coupling), expensive to retrofit | Plan |
| Scoreboard content | **Full parity** with the bench report (5 sections, ~42 rows) | The digital twin of a report already trusted; no metric silently goes missing | Plan |
| Grid mismatch | **Render everything, banner loudly** | Consistent with the analyzer's own stance: *it reports; it never judges* | Plan |
| Drift banner | **Structured diff, named** ("3 courses added, 1 teacher removed") | The banner is now the *sole* guard — a boolean can't tell a renamed course from a different student body | Plan |
| Loader home | Slice `api/`; `bench/` re-points, its copy deleted | A duplicated 15-query loader will drift — and the CLI is what validates the UI's numbers | Plan |
| Name resolution | Resolve the **extremes** only (worst teacher/student) | Turns the most-cited row from a UUID into a name; full maps are loaded anyway for the fingerprint, so it's free | Plan |
| Test depth | Unit + loader integration + **E2E** | The loader has two consumers and real failure modes; E2E guards the drift detector's headline claim | Plan |
| Table scrolling | Per-section frozen pane (sticky header + sticky label column, bounded box) | The 5 sections have *different* column sets, so one global frozen header is structurally impossible | Plan |
| Catalog fingerprint | New natural-key hash in the slice's `model/` | The existing `catalog_hash` digests UUIDs that `clone_plan` re-mints | Research |
| Where the code lives | New `src/_pages/plan-comparison/` slice | Mirrors `teacher-plan-view` / `student-plan-view`; one consumer, so not `widgets/` | Research |
| Where compute runs | Server-side, in the Astro frontmatter | `analyzePlan` is a ~3 ms fold — the Web Worker seat is right for a 20 s solve, wrong here | Research |
| Hard invariants | Feature vector never a score; slots never without completeness; `emptyDays` beside day-edges; warnings beside numbers | Each encodes a bug that shipped | Research |

## Scope

**In scope:** the `plan-comparison` slice; `/plans/compare` route; natural-key fingerprint + structured
diff + severity tiers; baseline-relative deltas; the five-section scoreboard with frozen panes; drift
banner; rule-verdict block; `MultiSelect` picker; Plans-hub entry point; entity-barrel widening; a
`courseIdentity` side-set on `CohortCatalog` (keyed over the grouping projection, which lets the *bench*
loader drop its own redundant `courses` query).

**Out of scope:** any composite score, ranking, or "Plan A wins"; per-row dimming on drift; blocking on
grid mismatch; a charting library; a `Tabs` shell; a web worker; per-student/per-teacher drill-down; a
lineage column on `plans`; a PRD/roadmap amendment; **deleting the three app loaders' `courses` queries**
(they are not redundant — `catalog.courses` omits merge children with no direct choices, which those
surfaces still render; a follow-up change).

## Architecture / Approach

Follow the **read-only view precedent**, not the editing board. One SSR load in the Astro frontmatter →
everything plain-serializable across the island boundary (no `Map`s) → the island rebuilds indexes at
render by calling pure `entities/timetable` functions.

```
/plans/compare?plans=A,B&baseline=A
  └─ frontmatter: loadPlanAnalysis ×N (Promise.all)
       → analyzePlan ×N        (pure, ~3 ms each)
       → verifyGeneration ×N   (free — the loader's pins:[] snapshot)
       → fingerprint → diff → tier
       → scoreboard data (baseline-relative deltas)
  └─ <PlanComparisonPage data={…} client:load />
       picker · drift banner · verdict block · 5 frozen-pane tables
```

No schema change, no migration, no new RLS or grant — every table the loader reads is already read by the
authenticated app client. Middleware auto-gates the route.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Enable | Widen the entity barrel; add `courseIdentity` to `CohortCatalog`. Purely additive | Touching shared types — mitigated: **never** widen `GroupingCourse` (~130 refs) or `CourseDisplay` (~40 files). `courseIdentity` is keyed over `catalog.courses` (the filtered projection), **not** the full row set |
| 2. Loader | Promote `loadPlanAnalysis` into the slice; add natural keys; `bench/` re-points | The bench's numbers must not change — verify against a pre-move capture |
| 3. Drift model | Natural-key fingerprint + structured diff + severity tiers | The one genuinely new mechanism. Load-bearing test: clone vs source → *equal* fingerprint |
| 4. Scoreboard model | Port the bench's 5 metric catalogs + formatters + baseline deltas | Losing an invariant in the port (completeness-beside-slots; `pooledMean` pools samples, not means) |
| 5. UI | Route, island, 5 frozen-pane tables, banner, verdict, picker, hub entry | **Sticky headers fail silently** without a bounded container — see below |
| 6. Verify | E2E via the clone flow; full CI gate | E2E has no DB access — the drifted pair must be built through the UI |

**Prerequisites:** none — no schema work, no engine work, no upstream change. Local Supabase stack for the
integration + E2E lanes.
**Estimated effort:** ~1–2 sessions across 6 phases. The compute core, the read-only-view infrastructure,
and the loader all already exist.

## Open Risks & Assumptions

- **The sticky header fails silently if done naively.** The DS `Table` wraps itself in `div.overflow-x-auto`, which per the CSS overflow spec is *already a scroll container in both axes* — so `sticky top-0` resolves against that div, not the viewport, and never sticks. It looks fine in a short table and breaks in exactly the long one we're building. The container needs an explicit bounded height.
- **The student natural key is weak.** `students.full_name` has no unique constraint (unlike `teachers_plan_code_unique` and `courses_unique`). Two same-named students collide. Fine for the fingerprint and for aggregate metrics; a hazard only if a per-student drill-down is ever added.
- **The barrel widening reverses a deliberate impl-review fix (F7).** Done consciously and narrowly — named exports for the types the UI actually uses as props, never `export *`.
- **The research doc is wrong about steiger.** It claims both prior view slices needed an `insignificant-slice` override; git history shows those overrides were for the *entity* and *widget* extractions, not page slices. Expect **no** override. Verify in Phase 1 rather than pre-emptively adding one.
- **PII, consciously.** The surface renders real teacher and student names. Normal for this app (the board already does) and it sits behind deny-by-default auth — but it's a deliberate yes, not an accident.
- **Plan comparison is net-new to the PRD** — zero hits in `prd.md` / `roadmap.md`. This is author/expert tooling that grew out of the generation-quality work. A PRD amendment is a follow-up, not a gate.

## Success Criteria (Summary)

- An author can pick two plans from the Plans hub and read the full analyzer feature vector side by side, with deltas against a chosen baseline, without opening a terminal.
- Comparing a plan against its own clone shows **no** drift; comparing two unrelated plans shows a banner that **names** what drifted.
- The numbers on screen match `ANALYZE_PLAN_A=<plan-id> pnpm analyze:plans` digit-for-digit — because the UI and the analyzer now share one loader.
