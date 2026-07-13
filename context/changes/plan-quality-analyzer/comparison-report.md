---
title: "Plan quality report: Golden Plan vs generated board"
date: 2026-07-13
data_collected: 2026-07-12
author: Claude (Fable 5), with the plan author
inputs:
  golden_plan: "Golden Plan — 4bc9fe99-33ae-4c58-9b66-9b8477dad33f (expert manual plan, local snapshot of prod '2026/2027')"
  generated_plan: "Golden Catalog Clone — e67d3b63-d32c-4332-8f78-bd991b93ecd3 (identical catalog + availability, engine-generated 2026-07-12, in-app defaults: 20 s budget)"
status: final
---

# Plan Quality Report — Expert vs Generated, Same Inputs

This is the report the plan-quality analyzer (discovery notes §6) was designed to produce,
executed manually in SQL as the analyzer's v0. Both boards share an **identical catalog**:
17 teachers (125 availability constraints), 85 courses, 61 students, 609 enrollments,
5×10 grid, two cohorts (dp1/dp2).

## Executive summary

The engine's output is **not a worse version of the expert's plan — it is missing four
dimensions of the expert's objective and fails one it already has.** On identical inputs the
engine: left **5 hours unplaced** (the expert placed everything); produced **67 same-course
same-day gaps** (the expert: **zero** across 248 placements); gave teachers **4.7× more
gap-slots**; took **3 soft-availability hits** (the expert: zero); and shaped days differently
(free mornings vs the expert's packed-mornings-short-Friday). Three "placements" in the expert
plan turned out to be **school fixtures** (synchronized Advisory, morning SSSTS with
cross-cohort week-alternation, paired biweekly CAS/EE cells) that no objective can derive —
they are inputs, and pre-pinning them is the cheapest experiment likely to improve completeness.

The expert plan also settles a standing question: dp1 **can** be solved complete in 48 slots
(the provable clique optimum — the engine has never done better than a complete 49), and the
long-deferred "real manual counts" (checkpoint 2.8) are **dp1 = 48, dp2 = 47**.

## Scoreboard

Counting conventions: gaps/adjacency are **lane-expanded** (a `both`-week row counts in both
A and B lanes — mirrors `countStudentHoles`); student/teacher joins use direct enrollments and
`course_teachers` (no overlap/merge expansion — same approximation for both plans).

| Metric | Golden dp1 | Generated dp1 | Golden dp2 | Generated dp2 |
|---|---:|---:|---:|---:|
| **Completeness — unplaced hours** | **0** | **4** (Chemistry HL 2/6) | **0** | **1** (EE 0/1) |
| Occupied slots | 48 | 47 ⚠️ | 47 | 47 ⚠️ |
| Placement rows | 113 | 109 | 135 | 134 |
| Interior holes (cohort grid) | 0 | 0 | 0 | 0 |
| Free slots at day START | 0 | 2 | 0 | 1 |
| Free slots at day END | 2 | 1 | 3 | 2 |
| Same-course adjacent pairs | **101** | 8 | **125** | 18 |
| Same-course same-day SPLITS | **0** | 27 | **0** | 40 |
| Students-per-slot median (cohort 27/34) | 14.5 | 17.0 | 21.0 | 21.0 |
| Thin slots (≤25% cohort) | 4 | 3 | 2 | 1 |
| Courses-per-slot avg | 2.35 | 2.32 | 2.87 | 2.85 |

| Board-wide metric | Golden | Generated | Ratio |
|---|---:|---:|---:|
| **Teacher gap-slots** | **74** | **345** | **4.7×** |
| Avg hours per teaching day | 3.46 | 3.21 | |
| Avg teaching days per teacher | 4.12 | 4.35 | |
| **Student gap-slots** | **900** | **1374** | 1.5× |
| Single-lesson student-days | **0** | 4 | |
| Avg hours per student-day | 5.71 | 5.54 | |
| Soft-availability hits | **0** | 3 | |
| Strong-availability hits | 0 | 0 | |
| Multi-day courses | 41 | 64 | |
| `is_optional` rows | 0 | 0 | |

⚠️ Slot counts on an incomplete board flatter it (fewer hours → fewer slots). **A slot count
must never be reported without completeness beside it.**

## Findings, ranked by impact

### 1. Same-course adjacency is the missing dominant term — and behaves like a hard rule
Expert: 226 adjacent pairs, zero same-day splits. Engine: 26 pairs, 67 splits. The expert's
stated heuristic ("never a gap between two hours of the same subject") is an **invariant** in
the gold plan, and the `Objective` tuple has no notion of it. This single dimension plausibly
explains most of "nothing close" and much of "not truly valid."
*Encode:* same-day-split as a hard rule in `verify.ts` (zero observed violations support hard),
or as the top soft tier; "prefer doubles" as a further soft term.

### 2. Teacher compactness is entirely unmodeled — and it's the biggest numeric gap
74 vs 345 teacher gap-slots (4.7×), denser teacher days on fewer days-in. The tuple has **no
teacher term at all**. *Encode:* a `teacherHoles` tier (measure suggests it may belong above
`studentHoles`).

### 3. The engine fails completeness (tier 1) on the real inputs
5 hours unplaced under real availability — invisible until now because the bench's seed
catalog has **zero** availability rows (the real catalog has 125). Case study — Chemistry HL,
teacher `OT`, 10 strong-blocked cells (20% of the grid): the expert places all 6 hours as
**three double periods across three days** (d1 P9–P10, d2 P1–P2, d4 P7–P8 — 2/day cap × 3
days); the engine placed 2 scattered singles and abandoned 4 hours. The instance is feasible —
this is a search failure, and **doubles are the mechanism that solves it**: adjacency and
completeness are coupled, not competing.

### 4. The expert treats soft unavailability as inviolable
Zero soft hits in 248 expert placements; the engine took 3 oracle-legal warnings.
*Encode:* promote soft-hit count to a high tier, or reclassify as hard after expert
confirmation.

### 5. Student experience (tier 4) is a real human edge the search never contests
−35% student gap-slots, zero single-lesson days. The tier exists but is dead last and no LNS
operator targets it (the deferred `studentHoles` move). *Encode:* the deferred operator, and
re-examine tier position.

### 6. Week shape: packed mornings, short Friday
Every expert day starts at P1; free capacity is banked almost exclusively at **Friday's tail**
(both cohorts end Friday at P8; golden dp1's only free slots are Friday P9–P10). The engine
left mornings free instead. *Encode:* free-slot position term weighted by (day-of-week,
lateness), or a construction bias.

## School fixtures discovered (inputs, not preferences — candidates for PRE-PINNING)

| Fixture | Structure |
|---|---|
| **Advisory** | Whole-cohort hour at **day 3, period 7 in BOTH cohorts simultaneously** — a synchronized school-wide anchor |
| **SSSTS** | All hours strictly P1–P2, same cells in both cohorts with **opposite week lanes** (dp1 = week A, dp2 = week B — one teacher alternating cohorts weekly; only legal because the weeks differ) |
| **CAS / EE** | Biweekly pair sharing cells throughout: CAS(a)+EE(b) in one cell — `opposite_week` made physical. The engine's only dp2 failure was EE: exactly this structure |

No objective term can derive these; the generator honors pins. **Cheapest next experiment:
pre-pin the fixtures on a fresh catalog clone and regenerate** — likely improves completeness
and possibly the whole board shape.

## Time-of-day gradient (input for the expert's "heavy subjects" labeling)

Mean period per subject, golden plan: SSSTS 1.5 → ESS 2.5 → Polish A 3.5 → Physics 4.5 ·
English A 4.5 → Math AI/AA 4.8 → German B / Biology 5.2 → Spanish B 5.4 → English B / History
5.5 → Psychology 5.7 → Computer Science 5.8 → BM 6.0 → Geography 6.2 → Chemistry 6.3 →
TOK / CAS / EE 6.4. National-language and skills subjects morning; self-directed/pastoral
(TOK/CAS/EE) and several content-heavy electives afternoon.

## Negative results (metrics to drop from v1)

- **Fixed-period consistency refuted**: only 5% of the expert's multi-day courses repeat the
  same period signature across days (engine: 11%) — course times rotate freely.
- **`is_optional` unused** in both boards.
- **Slot-coverage density is not an expert objective**: the expert's median students-per-slot
  is *lower* than the engine's, and all 6 thin slots are deliberate **edge doubles** of small
  courses. Measure *where* thin slots sit, not how many exist.
- **Interior holes don't differentiate** — both plans sit at zero; tier 2 is adequate.

## Recommendations

1. **Pre-pin fixtures experiment** (no code): clone catalog-only, pin Advisory/SSSTS/CAS-EE
   per the fixtures table, regenerate, re-measure. Confirms the fixture theory and may fix
   completeness cheaply.
2. **Analyzer v1** (`entities/timetable/model/analysis/`): the pure extractor per research.md —
   every metric in this report took minutes in SQL, so the scope is validated. Requirements
   confirmed by this run: rule-verdict block alongside the feature table; completeness always
   printed beside slots; plans addressed **by id, never by name** (the bench's name-lookup broke
   the moment the gold plan arrived).
3. **Objective changes, in evidence order**: no-same-day-split (hard or top tier) → teacher
   gaps tier → soft-availability promotion → studentHoles operator → week-tail free-slot term.
   Every change A/B'd via `createGreedyEngine` on fresh clones against this report's numbers;
   mind the lexicographic-ordering caveat (research.md §5 / discovery notes §5).
4. **Expert session** (§7 of the discovery notes): the agenda shifts from discovering rules to
   confirming classifications — is a same-day split *ever* acceptable? a soft hit under duress?
   must every day start at P1? label the time-of-day gradient; confirm the fixtures are truly
   fixed.

## Addendum (2026-07-13): cross-cohort patterns

16 of 17 teachers teach **both cohorts** — dp1/dp2 are one staffing system, and the expert
weaves them deliberately:

| Cross-cohort metric | Golden | Generated |
|---|---:|---:|
| Cohort-pure teacher-days | **34 / 70 (49%)** | 21 / 74 (28%) |
| Cohort switches (teacher, within-day) | **86** | 180 |
| — of which back-to-back (seamless) | **63%** | 45% |
| Same-day cross-cohort subject editions (shared days) | 37 | 54 |
| Mirrored cells (same course, same cell, both cohorts) | **9 — all deliberate** | 1 (accidental) |

> **Corrected 2026-07-13 by analyzer run #1** ([analysis-run-1.md](analysis-run-1.md)): mirrored
> cells are **9, not 10** — the ad-hoc SQL over-counted by one. The analyzer enumerates all nine
> by name, a fresh SQL probe agrees under both candidate keys (`name` and `name+level`), and the
> prose below always described nine. The fixture family is unchanged.

The 9 mirrored cells are the **school's synchronized weekly skeleton**: Polish A SL Monday
P1–P2 (simultaneous, parallel staffing KK/MD — a fixture missed by earlier probes), Advisory
d3 P7, SSSTS d3 P1–P2 (one teacher, cross-cohort week alternation), CAS/EE at d3 P8 + d5 P7
(coordinators swap cohorts weekly: dp1 CAS(a)+EE(b) while dp2 EE(a)+CAS(b)). This extends the
pre-pin experiment from 3 fixtures to the full skeleton, and the mirrored-cell census doubles
as an automatic **fixture detector** for the analyzer. Rules read: *minimize cohort switches;
switch seamlessly when unavoidable; prefer cohort-pure teacher days.* Negative result: teacher
daily-load caps do NOT differentiate the plans (identical distributions, max 7 h) — the
expert's anti-batching of subject editions (37 vs 54) has an unknown motive → expert question.

## Reproduction

Local rig: restore `data/golden-plan.sql` (LOCAL-ONLY, gitignored — production data), clone
catalog-only via `clone_plan(golden_id, name, false)`, generate in-app, then compare. The SQL
probes behind every number are reproducible one-liners over `placements` joined to `courses` /
`course_teachers` / `student_choices` / `teacher_availability`; lane expansion via
`unnest(case when week='both' then array['a','b'] else array[week::text] end)`. Full history
and provenance: `research.md` (Follow-ups 2–5) and `gold-plan-import.md` in this folder.
