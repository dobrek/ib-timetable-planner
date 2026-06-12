---
project: IB Schedule Planner
version: 3
status: draft
created: 2026-05-25
updated: 2026-06-12
prd_version: 2
main_goal: market-feedback
top_blocker: decisions
---

# Roadmap: IB Schedule Planner

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The `## At a glance` table is the index.

## Vision recap

A plan author at one IB-offering school manually builds the timetable for two cohorts (Year 1 + Year 2) — students individually pick their own subject set, there are no homeroom classes, so detecting collisions requires checking every student, every teacher, and every availability rule simultaneously. Today a standalone algorithm emits ranked "collision-free groupings" as a CSV, and the author drags those groupings around in a spreadsheet that knows nothing about the constraints — collisions are caught visually and late. The PRD proposes a purpose-built editor: the same drag-and-drop, but with an in-app validator that responds valid/invalid in real time for every collision class (student, teacher within cohort, teacher across cohorts, availability).

PRD §Business Logic names two paired rules — **recommendation** (the grouping algorithm) and **validation** (the per-drop check). They are paired, but they have _different cadences_: grouping is a one-shot computation over the catalog snapshot (re-run only when the catalog changes), while validation is an online per-drop function over the current placement state. The roadmap below splits them accordingly — F-03 ports the grouping algorithm; the validator grows incrementally inside the placement slices.

## North star

**S-01: First valid drop with validation** — the first moment the author experiences the "feel of the puzzle": they drag a pre-seeded Y1 grouping onto a slot and see an immediate response from the online validator. This is the moment the PRD's core hypothesis either holds or falls.

> The **north star** in this roadmap is the smallest end-to-end flow (author → catalog seed → drop → validator feedback) whose successful delivery proves that the product's core hypothesis (live validation collapses the spreadsheet step) actually works — which is why it sits as early as its prerequisites allow.

## At a glance

| ID   | Change ID                            | Outcome (user can …)                                                                                 | Prerequisites          | PRD refs                                            | Status   |
| ---- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------- | -------- |
| F-01 | gated-author-provisioning            | (foundation) closed registration — only approved authors can hold an account                         | —                      | FR-001, NFR Data privacy, Access Control            | done     |
| F-02 | minimal-domain-schema                | (foundation) Supabase tables + RLS for catalog, plans, variants, placements, and grouping cache      | —                      | FR-002, FR-006, FR-008, FR-010, NFR Work durability | done     |
| F-03 | port-grouping-algorithm              | (foundation) pure-function port of the existing CSV grouping algorithm, edge-runtime safe            | F-02                   | FR-013, Business Logic (recommendation rule)        | done |
| S-01 | first-valid-drop-with-validation     | drag a pre-seeded Y1 grouping onto a slot and see live student-collision validation                  | F-01, F-02, F-03       | US-01(d), FR-008, FR-011, FR-012, Business Logic    | done     |
| S-02 | course-and-dependency-catalog-ui     | CRUD courses `(name, level, group-index)` + overlap/merge dependencies + weekly hours                | F-01, F-02             | FR-002, FR-003, FR-003A                             | proposed |
| S-03 | teachers-and-availability-catalog-ui | CRUD teachers/assignments/availability; online validator extends to teacher + availability classes   | S-01, S-02             | FR-004, FR-005, FR-012                              | blocked  |
| S-04 | students-and-choices-ui              | CRUD students and their course choices (primary entry path)                                          | F-01, F-02, S-02       | FR-006                                              | proposed |
| S-05 | csv-import-students                  | bulk-import students from the existing `students_subjects.csv` without silently overwriting UI edits | S-04                   | FR-007, NFR Single-source-of-truth                  | proposed |
| S-06 | compute-groupings-from-catalog       | run F-03 against the populated catalog from the authoring UI and see the ranked groupings list       | F-03, S-02, S-03, S-04 | FR-013, Business Logic (recommendation rule)        | proposed |
| S-07 | multi-variant-management             | manage plans as cloneable whole-domain scenarios — `/plans` hub with create/clone/rename/delete      | S-01                   | FR-010, US-02                                       | done |
| S-08 | year-1-complete-placement            | place every required Y1 slot end-to-end under the full catalog with real (not seeded) groupings      | S-03, S-06             | US-01(d), FR-011, FR-012, FR-013                    | blocked  |
| S-09 | year-2-with-cross-cohort-constraint  | place Y2 while honoring fixed Y1 teacher occupancy (cross-cohort)                                    | S-08                   | US-01(e), FR-009, FR-012                            | blocked  |
| S-10 | finalize-and-csv-export              | export any plan as a master-grid CSV with cohort distinguishable                                     | S-09                   | US-01(g)(h), FR-015                                 | proposed |

## Streams

Navigation aid over the dependency graph — the canonical order still lives in `## Foundations` + `## Slices` below.

| Stream | Theme                          | Chain                             | Note                                                                                          |
| ------ | ------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------- |
| A      | Foundations & northstar        | `F-01` → `F-02` → `F-03` → `S-01` | The northstar track — everything else only matters once the validation UX holds up.           |
| B      | Catalog UI                     | `S-02` → `S-04` → `S-05`          | Parallel with S-01; produces the catalog content S-06 will feed to the algorithm.             |
| C      | Algorithm & cohort progression | `S-03` → `S-06` → `S-08` → `S-09` | Validator classes grow, then the grouping algorithm gets its UI, then the cohorts come alive. |
| D      | Plans & launch                 | `S-07` → `S-10`                   | `S-07` parallel with B and C; `S-10` closes the loop after `S-09`.                            |

## Baseline

What's already in place in the codebase as of 2026-05-25 (auto-researched + user-confirmed). Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro 6.3.7 + React 19.2.6 + Tailwind 4 + shadcn wired (`astro.config.mjs:14`, `components.json`). No domain components yet — only auth + stock (`src/components/auth/*`, `src/components/Welcome.astro`).
- **Backend / API:** partial — Astro in `output: "server"` mode with the Cloudflare adapter; only three stock auth endpoints exist (`src/pages/api/auth/{signin,signup,signout}.ts`). `src/lib/utils.ts` contains only `cn()`. No domain logic.
- **Data:** absent — `supabase/config.toml` exists (project_id: "ib-timetable-planner"), but `schema_paths=[]`, no `supabase/migrations/`, no `seed.sql`, no generated types.
- **Auth:** partial — sign-in + sign-up + signout flow + middleware redirect (`src/middleware.ts:18-21`) + Supabase SSR client (`src/lib/supabase.ts:5-24`) all work, BUT registration is open. The product needs a closed author list (approval / invite) — F-01 closes that gap.
- **Deploy / infra:** present — `wrangler.jsonc` with `compatibility_date: "2026-05-08"`, `nodejs_compat`; `.github/workflows/ci.yml` runs install→astro sync→lint→build plus deploy to Cloudflare Workers on main; `pnpm env:local` / `pnpm env:prod` swap `.envs/*.vars` into `.env.local` + `.dev.vars`.
- **Observability:** absent — no sentry/otel/datadog/pino in deps, no structured logging in middleware/routes. Not promoted to an F-NN in this MVP — `main_goal: market-feedback` does not weight this layer.

## Foundations

### F-01: gated-author-provisioning

- **Outcome:** (foundation) registration into the application is closed. Only an author who has been approved or created by someone with permissions can register and sign in; the open self-service signup currently wired in `src/pages/auth/signup.astro` is no longer publicly reachable.
- **Change ID:** gated-author-provisioning
- **PRD refs:** FR-001, NFR Data privacy, Access Control
- **Unlocks:** every S-NN below (every slice touches student PII — without a gate, a public URL exposes the catalog).
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:**
  - Gate mechanism: invite-only (Supabase email invite) vs. allow-list in middleware vs. manual user creation in Supabase Studio — Owner: user. Block: no (decided during `/10x-plan`).
- **Risk:** Sequenced first alongside F-02 because NFR Data privacy says student PII cannot sit next to open registration even in a preview demo. If deferred, every catalog investment (S-02, S-04, S-05) operates on data trivially reachable via the public signup form.
- **Status:** done

### F-02: minimal-domain-schema

- **Outcome:** (foundation) Supabase carries the tables needed to power the northstar plus a cache for grouping algorithm output: `courses`, `students`, `student_choices`, `plans`, `plan_variants`, `placements`, and a `course_groupings` table (per plan + cohort, holding the ranked output of F-03). RLS scoped to the authenticated author. Generated TS types land in `src/lib/database.types.ts` (or equivalent). Schema for teachers / dependencies / availability arrives in the slices that introduce them (S-02, S-03) — F-02 does not try to drag the whole domain in at once.
- **Change ID:** minimal-domain-schema
- **PRD refs:** FR-002, FR-006, FR-008, FR-010, NFR Work durability
- **Unlocks:** F-03 (needs the catalog types to define its input/output), S-01 (needs `plans` + `plan_variants` + `placements` + `students` + `student_choices` + `courses` + `course_groupings` to seed the drop-and-validate scenario at all), S-02 / S-04 / S-07 (each extends the schema with its own tables).
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - Should `placements.variant_id` be per-cohort scoped (a separate placement row per (variant, cohort, slot)) or does a variant carry the cohort implicitly via the slot? — Owner: user / design in `/10x-plan`. Block: no.
  - Should `course_groupings` persist as a materialized table or as a JSONB blob keyed by `(plan_id, cohort, catalog_hash)`? — Owner: dev. Block: no (perf-driven choice in `/10x-plan`).
- **Risk:** Sequenced together with F-01 as an absolute prerequisite of the northstar. Kept minimal (the seven tables) because pulling the whole domain in here is horizontal-first scope creep and pushes UX validation later. Trade-off: extending the schema slice-by-slice produces more migrations — accepted, because a solo-dev 8-week MVP prefers incremental migrations over one big upfront decision.
- **Note (2026-06-11):** delivered as specified at the time; `plan_variants` and the `cohorts` table were later dropped by S-07 (PRD v2) — plans absorbed the catalog and became the cloneable domain root. References to variants in this entry are historical.
- **Status:** done

### F-03: port-grouping-algorithm

- **Outcome:** (foundation) the existing CSV-based grouping algorithm (input directory `data/dp2/`, output `data/out/dp2-variants-2.csv`) is re-implemented as a pure function in `src/lib/`, operating on domain types (courses + dependencies + student choices + teachers + availability) rather than raw CSVs. Edge-runtime safe (no `fs` / `child_process` / native modules per CLAUDE.md). Returns a ranked list of compatible groupings with coverage scores matching the existing algorithm's output shape. Unit-testable in isolation; output is deterministic for a given catalog snapshot. Handles all collision classes (student, teacher, availability, overlap/merge dependencies) the existing algorithm handles — it does not need to grow incrementally because its input is catalog state, not placement state.
- **Change ID:** port-grouping-algorithm
- **PRD refs:** FR-013, Business Logic (recommendation rule), §"Current Algorithm" in shape-notes
- **Unlocks:** S-01 (needs grouping output, even pre-seeded, to render the draggable building blocks), S-06 (puts UI on top of this function), S-08 (uses real algorithm output at full-cohort scale).
- **Prerequisites:** F-02
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - Behavior when catalog is partially populated (no teachers yet, no availability rules yet) — degrade to student-only groupings, or refuse to compute? — Owner: dev. Block: no.
  - Output persistence strategy: write to `course_groupings` table after each run vs. compute-on-read with caching — Owner: dev. Block: no (tied to F-02 Unknown about JSONB vs. materialized).
  - Re-run trigger semantics: explicit author action only (a "Compute groupings" button — see S-06), or auto on every catalog mutation — Owner: user / design. Block: no.
- **Risk:** This is the existing algorithm's correctness in a new runtime. The port must preserve the algorithm's collision rules verbatim — a regression here invalidates every downstream placement slice. Mitigation: keep `data/dp2/` files in the repo as reference fixtures and use them as the unit-test golden set against the existing output `data/out/dp2-variants-2.csv`. The edge-runtime constraint also rules out any library that pulls in Node-only APIs; this needs verification early.
- **Status:** done

### S-01: first-valid-drop-with-validation

- **Outcome:** The author opens a plan with a minimal seeded catalog (courses + students + their Year 1 choices, plus pre-seeded `course_groupings` rows produced by running F-03 once against the seed — manually loaded for the northstar), picks a slot-grid preset (Mon–Fri × 6 or × 8), drags a Y1 grouping from the panel onto a slot, and sees an immediate response from the online validator: valid, or a named class of student collision. The placement persists across reloads. The validator implemented here covers the **student-collision class only**; teacher classes arrive in S-03, cross-cohort in S-09.
- **Change ID:** first-valid-drop-with-validation
- **PRD refs:** US-01(d), FR-008, FR-011, FR-012 ("student collision" class only), Business Logic (validation rule)
- **Prerequisites:** F-01, F-02, F-03
- **Parallel with:** S-02 (their dependencies don't intersect)
- **Blockers:** —
- **Unknowns:**
  - **Drop UX policy (PRD Q8):** block-drop / flag-and-allow / prompt — Owner: user / design. Block: **yes**.
  - Initial data seed for the northstar: dev-script SQL vs. minimal UI vs. one CSV from `data/dp2/` piped through F-03 — Owner: user. Block: no.
- **Risk:** The northstar. The whole sequence stands or falls on whether the online validator can deliver feedback under 200ms in an edge-safe runtime AND whether the "feel of the puzzle" actually holds up. If even the cheapest collision class (student) doesn't fit the p95 budget, the entire PRD §Business Logic bet needs revisiting — and it's far cheaper to learn that here than in S-08. Note that S-01 no longer carries the algorithm-port risk (that moved to F-03); this slice is purely about the validator and the UX.
- **Status:** done

### S-02: course-and-dependency-catalog-ui

- **Outcome:** The author CRUDs courses (`name`, `level ∈ {SL, HL, AB, none}`, `group-index ∈ {1, 2, none}`), declares weekly hours per course, and declares dependencies of two kinds: overlap (e.g., Polish A SL / Polish A HL) and merge (e.g., German B AB+SL). Everything in the authoring UI; no self-service flows.
- **Change ID:** course-and-dependency-catalog-ui
- **PRD refs:** FR-002, FR-003, FR-003A
- **Prerequisites:** F-01, F-02
- **Parallel with:** S-01, S-04 (once courses exist), S-07
- **Blockers:** —
- **Unknowns:**
  - IB Group attribute (1–6) per course (PRD Q4) — include now or defer to v2? Owner: user. Block: no.
- **Risk:** Sequenced parallel with the northstar because a real catalog is mandatory for S-06 and S-08. Not done before the northstar because the northstar can lean on a seed script — building full course CRUD _before_ the validation hypothesis is tested would be UI investment whose foundation may not survive.
- **Status:** proposed

### S-03: teachers-and-availability-catalog-ui

- **Outcome:** The author CRUDs teachers and their course assignments (the triple from FR-002) and declares hard availability rules (slots a given teacher cannot be placed in). The **online validator** extends to cover two new collision classes: "teacher in cohort" + "teacher availability". (Note: F-03's grouping algorithm already handles teacher constraints once teachers exist — no F-03 change needed here.)
- **Change ID:** teachers-and-availability-catalog-ui
- **PRD refs:** FR-004, FR-005, FR-012 ("teacher in cohort", "availability" classes)
- **Prerequisites:** S-01, S-02
- **Parallel with:** S-04, S-05, S-07
- **Blockers:** —
- **Unknowns:**
  - **Drop UX policy (PRD Q8)** is inherited — once there are three collision classes, the cost of an unclear invalid-drop presentation grows. Owner: user / design. Block: **yes**.
  - Teacher hours-per-week (PRD Q5), teacher soft preferences (PRD Q6) — Owner: user. Block: no (outside MVP per Non-Goals).
- **Risk:** Validator classes start to compound — this is the first place where aggregating multiple constraint classes might push the online p95 budget. Sequenced after the northstar so the validator's baseline performance is already known.
- **Status:** blocked

### S-04: students-and-choices-ui

- **Outcome:** The author CRUDs students and their course choices (each choice is a course as defined in FR-002). This is the **primary path** for entering student data; the CSV import in S-05 is an alternate seeding path.
- **Change ID:** students-and-choices-ui
- **PRD refs:** FR-006
- **Prerequisites:** F-01, F-02, S-02
- **Parallel with:** S-03, S-07
- **Blockers:** —
- **Unknowns:**
  - PII handling on edit (audit trail, soft-delete vs. hard-delete of a student record) — Owner: user. Block: no.
- **Risk:** Low. A "basic CRUD" slice over the schema F-02 already provides. Sequenced after S-02 because choices reference courses.
- **Status:** proposed

### S-05: csv-import-students

- **Outcome:** The author imports students from a CSV in the existing `students_subjects.csv` shape (student name, course, level, optional group-index). Re-importing the same CSV after subsequent UI edits **does not silently overwrite** — it requires an explicit author decision (merge / overwrite / skip).
- **Change ID:** csv-import-students
- **PRD refs:** FR-007, NFR Single-source-of-truth
- **Prerequisites:** S-04
- **Parallel with:** S-03, S-07
- **Blockers:** —
- **Unknowns:**
  - Re-import conflict-resolution strategy (the actual UI): diff-view + per-row decision vs. a global mode — Owner: user / design in `/10x-plan`. Block: no.
- **Risk:** "Silent overwrite" is precisely the guardrail the PRD calls out — this slice exists to address it, not merely for CSV feature-parity with the prior workflow. Sequenced after S-04 so the rationale for refusing silent overwrite (keeping UI edits as the single source of truth) is concrete.
- **Status:** proposed

### S-06: compute-groupings-from-catalog

- **Outcome:** With the catalog populated (courses + dependencies from S-02, teachers + availability from S-03, students + choices from S-04, optionally seeded via S-05), the author invokes F-03 from the authoring UI — a "Compute groupings" action — and sees the ranked list of compatible groupings rendered with their coverage scores. Output is persisted in `course_groupings` so subsequent placement work reuses it without recomputing. The author can re-run the computation explicitly when the catalog changes; the UI surfaces "groupings out of date" when catalog mutations have happened since the last run.
- **Change ID:** compute-groupings-from-catalog
- **PRD refs:** FR-013, Business Logic (recommendation rule), §"Current Algorithm" in shape-notes
- **Prerequisites:** F-03, S-02, S-03, S-04
- **Parallel with:** S-05, S-07
- **Blockers:** —
- **Unknowns:**
  - "Out of date" detection: catalog-row-timestamp comparison vs. a `catalog_hash` column on `course_groupings` — Owner: dev. Block: no.
  - When the catalog has gaps (e.g., student takes a course with no teacher assigned yet), surface as a per-grouping warning or block compute entirely? — Owner: user / design. Block: no.
- **Risk:** The first time the ported algorithm runs against the author's own data, not a fixture. Discrepancies between the new run and the historical `data/out/dp2-variants-2.csv` output reveal port-correctness issues — this slice is where regression vs. the existing algorithm becomes user-visible. Mitigation: keep the existing CSV pipeline runnable in parallel as a parity check during this slice.
- **Status:** proposed

### S-07: multi-variant-management

- **Outcome:** Plans are cloneable whole-domain scenarios: the catalog (teachers, courses, students, choices, dependencies) is plan-owned; `/plans` is the application hub with create-blank / clone / rename / delete; catalog routes nest under the plan (`/plans/[id]/courses|teachers|students`, board at `/plans/[id]`); the `plan_variants` and `cohorts` tables are dropped (cohort becomes a native enum). Cloning deep-copies the entire scenario — catalog, placements, groupings — and is the primary creation path. Grouping output stays keyed by (plan, cohort), since it depends on the now-plan-owned catalog.
- **Change ID:** multi-variant-management
- **PRD refs:** FR-010, US-02 (both amended in PRD v2)
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - ~~Does "switching" include copy-from-existing (forking) or only empty-new?~~ Resolved 2026-06-11: both — clone is the primary path; blank-new (name + grid preset) remains for cold start.
- **Risk:** Re-scoped 2026-06-11 (PRD v2): the original "surface `plan_variants` in the UI" framing is overturned — user research showed the what-if axis is the catalog, not placements. The slice now carries a destructive schema re-baseline (plans as FK root, composite FKs, cohort enum) and a deep-copy clone RPC; widest blast radius is the app-wide plan threading.
- **Status:** done

### S-08: year-1-complete-placement

- **Outcome:** The author fills in every slot required by Y1 student choices, working from the full catalog (courses + dependencies from S-02, teachers from S-03, students from S-04) and using **real grouping output from S-06** (no longer pre-seeded). The online validator certifies no-collision across all classes within Y1. The plan holds Y1 as a stable basis for Y2.
- **Change ID:** year-1-complete-placement
- **PRD refs:** US-01(d), FR-011, FR-012 (all classes within the cohort), FR-013
- **Prerequisites:** S-03, S-06
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - **Drop UX policy (PRD Q8)** — full coverage of validator classes plus author time pressure is exactly the context in which the policy choice matters most. Owner: user / design. Block: **yes**.
  - Online-validator performance under a realistic catalog (~50–150 students, ~30–60 courses) — a p95 < 200ms budget per drop may require incremental validation rather than full recompute. Owner: dev. Block: no.
- **Risk:** The first moment the online validator runs against a full cohort with real grouping output. Every prior performance measurement gets re-validated here at real scale. If the p95 budget breaks, the sequence must loop back to S-01/S-03 to optimize the validator. (Note: the grouping algorithm's own runtime is _not_ on the hot path — it ran once during S-06 and the output is cached.)
- **Status:** blocked

### S-09: year-2-with-cross-cohort-constraint

- **Outcome:** The author switches to Y2 inside the same plan. The online validator adds the "teacher across cohorts" class — a slot S occupied by teacher T in Y1 cannot accept teacher T in Y2. Grouping recommendations for Y2 are produced by re-running F-03 with the Y2 cohort scope (S-06 covers the trigger).
- **Change ID:** year-2-with-cross-cohort-constraint
- **PRD refs:** US-01(e), FR-009, FR-012 ("teacher across cohorts" class)
- **Prerequisites:** S-08
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - **Drop UX policy (PRD Q8)** is inherited further; cross-cohort is the least intuitive class for the author, so the "invalid: teacher already in Y1 slot 3" message needs careful presentation. Owner: user / design. Block: **yes**.
  - When a Y1 placement is edited _after_ Y2 has started, should the change propagate invalidation into Y2 placements, or should Y1 be frozen until the author explicitly "reopens" it? — Owner: user / design. Block: no.
- **Risk:** The cross-cohort constraint is the "hard problem" called out in CLAUDE.md. Sequenced directly after S-08 so that any decision about plan + cohort representation in the schema is confirmed before adding cross-references.
- **Status:** blocked

### S-10: finalize-and-csv-export

- **Outcome:** The author exports **any plan** as a master-grid CSV (slot × course) with cohort distinguishable in the output. There is no finalize step — plans are peers (FR-014 removed in PRD v2).
- **Change ID:** finalize-and-csv-export
- **PRD refs:** US-01(g)(h), FR-015 (amended in PRD v2; FR-014 removed)
- **Prerequisites:** S-09
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - ~~**Finalize gate (PRD Q9)**~~ Resolved 2026-06-11: dissolved — FR-014 overturned in PRD v2; there is no final mark and nothing to gate.
  - ~~Draft export (PRD Q10)~~ Resolved 2026-06-11: dissolved into amended FR-015 — any plan is exportable.
- **Risk:** The slice with the least technical uncertainty — CSV export is more of a product decision than an engineering one. Sequenced last because it requires both cohorts placed.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                            | Suggested issue title                                                          | Ready for `/10x-plan` | Notes                                                          |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------- |
| F-01       | gated-author-provisioning            | Close registration to invited/approved authors only                            | yes                   | Run `/10x-plan gated-author-provisioning`                      |
| F-02       | minimal-domain-schema                | Supabase schema + RLS for catalog/plan/variant/placement/groupings (MVP scope) | yes                   | Run `/10x-plan minimal-domain-schema`                          |
| F-03       | port-grouping-algorithm              | Port the CSV grouping algorithm to a pure function in `src/lib/`               | no                    | Promotes to `ready` once F-02 done                             |
| S-01       | first-valid-drop-with-validation     | First valid drop with live student-collision validation                        | no                    | Blocked on Drop UX policy (PRD Q8); also waits for F-03        |
| S-02       | course-and-dependency-catalog-ui     | Course catalog + overlap/merge dependencies UI                                 | no                    | Promotes to `ready` once F-01 + F-02 done                      |
| S-03       | teachers-and-availability-catalog-ui | Teachers + availability UI; online validator extends to teacher classes        | no                    | Blocked on Drop UX policy (PRD Q8); also waits for S-01, S-02  |
| S-04       | students-and-choices-ui              | Students + choices UI (primary path)                                           | no                    | Promotes to `ready` once F-01 + F-02 + S-02 done               |
| S-05       | csv-import-students                  | CSV import for student choices, no silent overwrite of UI edits                | no                    | Waits for S-04                                                 |
| S-06       | compute-groupings-from-catalog       | Run grouping algorithm against the populated catalog from the UI               | no                    | Waits for F-03 + S-02 + S-03 + S-04                            |
| S-07       | multi-variant-management             | Plans as cloneable whole-domain scenarios (`/plans` hub + clone)               | yes                   | Re-scoped 2026-06-11 (PRD v2); plan exists (this change)       |
| S-08       | year-1-complete-placement            | Year 1 end-to-end placement under full catalog with real groupings             | no                    | Blocked on Drop UX policy (PRD Q8); also waits for S-03 + S-06 |
| S-09       | year-2-with-cross-cohort-constraint  | Year 2 placement honoring Year 1 teacher occupancy                             | no                    | Blocked on Drop UX policy (PRD Q8); also waits for S-08        |
| S-10       | finalize-and-csv-export              | Export any plan as master-grid CSV                                             | no                    | Finalize gate dissolved (PRD v2); waits for S-09               |

## Open Roadmap Questions

1. **Drop UX policy (PRD Q8).** When a drop creates a collision, does the app (a) block the drop, (b) accept and flag for resolution, or (c) prompt the author? Owner: user / design. Block: **S-01, S-03, S-08, S-09**.
2. **Finalize gate (PRD Q9).** Resolved 2026-06-11: no finalize gate — FR-014 overturned in PRD v2; plans are peers with no final mark. Block: none.
3. **target_scale.qps (PRD Q1).** Shape-notes captured `users: small` but not a qps ballpark. Owner: user. Block: no — defaults to "low" for downstream sizing.
4. **target_scale.data_volume (PRD Q2).** Same gap. Owner: user. Block: no — defaults to "small".
5. **Viewer role v2 (PRD Q3).** Dropped from MVP. For v2, should a read-only Viewer see only finals, or drafts too? Owner: user. Block: no.
6. **IB Group attribute (PRD Q4).** Should each course carry its IB Group (1–6) attribute, in case the algorithm later needs it for stricter compatibility rules? Owner: user. Block: no.
7. **Teacher hours-per-week (PRD Q5).** Some teachers can teach up to N hours per week. Out of scope for MVP — needed in v2? Owner: user. Block: no.
8. **Teacher soft preferences (PRD Q6).** Prefer morning vs. afternoon, prefer non-consecutive slots, etc. Hard exclusions only in MVP. Owner: user. Block: no.
9. **Custom slot grids (PRD Q7).** MVP uses presets only; a bespoke grid editor is deferred. Owner: user. Block: no.
10. **Draft export (PRD Q10).** Resolved 2026-06-11: dissolved into amended FR-015 (PRD v2) — any plan is exportable. Block: no.
11. **Keyboard / accessibility parity (PRD Q11).** Should drag-and-drop have a keyboard-only alternative? Owner: user. Block: no.
12. **Multi-school / cross-school (PRD Q12).** No multi-tenancy in MVP. Owner: user. Block: no.

## Parked

- **End-to-end automatic timetable optimization** — Why parked: PRD §Non-Goals. The app computes compatible groupings and validates placements; it does NOT auto-place courses on slots.
- **Room / location validation** — Why parked: PRD §Non-Goals. Rooms are assigned after the timetable is set, outside this tool.
- **Student-facing and teacher-facing self-entry flows** — Why parked: PRD §Non-Goals. Authors enter all data.
- **Multi-school SaaS tenancy** — Why parked: PRD §Non-Goals + §Access Control. One school per instance.
- **Custom slot-grid editor** — Why parked: PRD §Non-Goals + Open Question Q7. Presets only in MVP.
- **Printable / PDF export** — Why parked: PRD §Non-Goals. CSV only.
- **Cross-plan comparison view** — Why parked: PRD §Non-Goals. Multiple plans exist in parallel, but no side-by-side diff UI; derived hub metrics (valid / complete / used slots) are a future extension.
- **Mobile-optimized UX** — Why parked: PRD §Non-Goals. Laptop browser is the target form factor.
- **Read-only Viewer role** — Why parked: PRD §Non-Goals + Open Question Q3. v2 candidate.
- **Observability stack (logs, error tracking, dashboards)** — Why parked: `main_goal: market-feedback` + small users scope. Returns as a foundation candidate if/when scale grows or `main_goal` shifts to `quality`.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips the item's `Status` to `done` — when a change whose `Change ID` matches a roadmap item is archived.)

- **F-01: (foundation) closed registration — only approved authors can hold an account** — Archived 2026-06-12 → `context/archive/2026-05-29-gated-author-provisioning/`. Lesson: —.
- **S-01: First valid drop with validation** — Archived 2026-06-12 → `context/archive/2026-06-05-first-valid-drop-with-validation/`. Lesson: —.
- **S-07: Plans are cloneable whole-domain scenarios** — Archived 2026-06-12 → `context/archive/2026-06-11-multi-variant-management/`. Lesson: —.
- **F-02: (foundation) Supabase tables + RLS for catalog, plans, variants, placements, and grouping cache** — Archived 2026-06-12 → `context/archive/2026-06-01-minimal-domain-schema/`. Lesson: —.
- **F-03: port-grouping-algorithm** — Archived 2026-06-12 → `context/archive/2026-06-04-port-grouping-algorithm/`. Lesson: —.
