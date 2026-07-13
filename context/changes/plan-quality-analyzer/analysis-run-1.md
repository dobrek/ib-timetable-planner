---
title: "Analyzer run #1 — verify-gold verdict + Golden vs generated diff"
date: 2026-07-13
tool: "pnpm analyze:plans (bench/plan-quality.analyze.ts)"
command: "ANALYZE_PLAN_A=4bc9fe99-33ae-4c58-9b66-9b8477dad33f ANALYZE_PLAN_B=e67d3b63-d32c-4332-8f78-bd991b93ecd3 pnpm analyze:plans"
inputs:
  plan_a: "Golden Plan — 4bc9fe99-33ae-4c58-9b66-9b8477dad33f (expert manual plan, local snapshot of prod '2026/2027')"
  plan_b: "Golden Catalog Clone — e67d3b63-d32c-4332-8f78-bd991b93ecd3 (identical catalog + availability, engine-generated 2026-07-12)"
  rig: "local Supabase stack; both plans survived from the 2026-07-12 session (248 / 243 placement rows) — the SAME boards `comparison-report.md` measured"
status: final
---

# Analyzer run #1

The first execution of the tool this change exists to build, against the same two boards the
hand-made SQL report (`comparison-report.md`) measured. It answers the tier-0 question, reproduces
the report's placement-derived numbers, and **corrects the report on two points**.

## 1. Verify-gold verdict: world (a) — the rules are MISSING, not mis-specified

```
=== Rule verdict — Golden Plan (4bc9fe99-33ae-4c58-9b66-9b8477dad33f) ===
oracle-valid: YES · soft-availability warns: 0
  (no blocking violations, no generated-row stacking)

=== Rule verdict — Golden Catalog Clone (e67d3b63-d32c-4332-8f78-bd991b93ecd3) ===
oracle-valid: YES · soft-availability warns: 3
  (no blocking violations, no generated-row stacking)
```

**The expert's plan passes the engine's own oracle, cleanly**: zero blocking violations, zero
soft-availability warns, and no `course-day-stacking` breach even under the harshest reading (the
whole board fed in as `generated` with `pins: []`, so the generator-hard 2/day cap applies to every
row of it).

This settles the fork the author drew on 2026-07-12 ("nothing *close* to the gold plan — and nothing
*truly valid* either"). We are in **world (a)**: the rule set is not wrong, it is *incomplete*. The
engine is free to produce the expert's board; it simply has no objective term that would lead it
there. Nothing in `verify.ts` needs relaxing before the objective work starts — and the same run
shows the engine taking 3 soft-availability hits the expert never takes, which is a *preference* gap
(promote the soft-warn count), not a legality gap.

## 2. Golden-side parity against `comparison-report.md`

Every placement-derived and `course_teachers`-derived golden number reproduces **exactly**:

| Metric | Report | Analyzer | |
|---|---:|---:|---|
| dp1 / dp2 unplaced hours | 0 / 0 | 0 / 0 | ✓ |
| dp1 / dp2 occupied slots | 48 / 47 | 48 / 47 | ✓ |
| dp1 / dp2 placement rows | 113 / 135 | 113 / 135 | ✓ |
| dp1 / dp2 interior holes | 0 / 0 | 0 / 0 | ✓ |
| Free slots at day START | 0 / 0 | 0 / 0 | ✓ |
| Free slots at day END | 2 / 3 | 2 / 3 | ✓ |
| Same-course adjacent pairs | 101 / 125 | 101 / 125 | ✓ |
| Same-course same-day splits | 0 / 0 | 0 / 0 | ✓ |
| Courses-per-slot avg | 2.35 / 2.87 | 2.35 / 2.87 | ✓ |
| Multi-day courses (board-wide) | 41 | 41 (19 + 22) | ✓ |
| **Teacher gap-slots** | **74** | **74** | ✓ |
| Avg teaching days / teacher | 4.12 | 4.12 | ✓ |
| Soft / strong availability hits | 0 / 0 | 0 / 0 | ✓ |
| **Cohort-pure teacher-days** | **34 / 70 (49%)** | **34 / 70 (49%)** | ✓ |
| **Cohort switches** | **86** | **86** | ✓ |
| — of which seamless | 63% | 54 (63%) | ✓ |
| Shared subject-edition days | 37 | 37 | ✓ |

The generated side reproduces too: 345 teacher gap-slots (**4.7×**), 3 soft hits, 180 switches at 45%
seamless, 21/74 (28%) cohort-pure days, 54 shared-edition days, 8/18 adjacent pairs, **27/40 same-day
splits**, 64 multi-day courses, 1 accidental mirrored cell.

The lane-expansion convention is confirmed by the exactness of the teacher-gap (74) and switch (86)
matches — the SQL v0 and the analyzer agree digit-for-digit on independent implementations.

### Correction 1 — mirrored cells: **9, not 10**

The report's addendum claims 10; the analyzer finds 9, and a fresh SQL probe written against the same
data agrees under **both** candidate keys (`name+level` → 9, `name` only → 9). The report's own prose
also enumerates nine: Polish A SL d1 P1–P2 (2) + SSSTS d3 P1–P2 (2) + Advisory d3 P7 (1) + CAS/EE at
d3 P8 and d5 P7 (4). The "10" was an off-by-one in the ad-hoc SQL. **The fixture family itself is
unchanged** — the detector found the complete school skeleton, including the Polish A Monday-morning
fixture, with no false positives:

```
d1 P1  Polish A SL      d3 P1  SSSTS SL      d3 P7  Advisory      d3 P8  CAS / EE
d1 P2  Polish A SL      d3 P2  SSSTS SL                           d5 P7  CAS / EE
```

The engine's board: **1** mirrored cell (English B HL @ d3 P2 — accidental).

### Correction 2 — the "5 unplaced hours" story is wrong, and the truth is worse

The report attributes the engine's dp1 failure to *"Chemistry HL 2/6, 4 hours abandoned"*. Under the
app's own catalog projection the engine's dp1 board is **complete** — and that is not the engine
being exonerated, it is the measurement being blind. What the database actually holds:

- dp1 Chemistry is an **overlap pair**: `Chemistry HL` (2 h required, 9 students) is the *dependent*
  of `Chemistry SL` (4 h required, **0 direct enrolments**).
- `loadCohortCourses` keeps only courses with direct student choices (plus merge parents), so the
  zero-enrolment **SL base is dropped from the projection entirely** — with its 4 required hours.
- The expert places **6 hours** on the HL course — `d1 P9–P10, d2 P1–P2, d4 P7–P8`, the three doubles
  the report describes — i.e. the whole combined session, base hours included.
- The engine places exactly **2** — `d1 P7, d4 P4`, two scattered singles — which is precisely what
  its catalog asks of it. It is *complete and 4 hours short of the school's reality at the same time*.

The analyzer surfaces this as **over-placement**, reported beside the shortfall and never netted
against it (`OVER-PLACED HOURS: golden dp1 = 4`, printed as `Chemistry HL 6/2h`). Had the two totals
been netted, the finding would have cancelled itself out to zero.

**This reframes finding #3 of the report.** "The engine fails completeness under real availability" is
only half true: 1 of the 5 hours (dp2 EE) is a genuine search failure; the other 4 are a **modeling
gap** — a required teaching session that the catalog projection cannot see. No objective tuning can
fix that, and a pre-pin experiment will not either. It is a data/loader question, and it is now the
cheapest known lead on completeness. Candidate follow-up change: decide whether a zero-direct-choice
overlap base belongs in the projection (it is a real session the expert schedules), or whether the
production catalog should carry the hours on the dependent.

### Student-lens deltas (expected, documented in the plan)

| Metric | Report (SQL, direct enrolments) | Analyzer (app projection) |
|---|---:|---:|
| Student gap-slots (golden) | 900 | 612 |
| Student gap-slots (generated) | 1374 | 1020 |
| Students/slot median dp1 / dp2 (golden) | 14.5 / 21.0 | 20 / 24 |
| Thin slots ≤25% (golden dp1 / dp2) | 4 / 2 | 0 / 0 |
| Avg hours per student-day (golden) | 5.71 | 6.77 |

Cause, exactly as the plan's Critical Implementation Details predicted: the SQL v0 joined **direct
enrolments only**, while `GroupingCourse.studentKeys` unions overlap-dependents and merge-children
(18 overlaps + 11 merges in this catalog). Each placed course therefore serves more students in the
analyzer's view — denser student days (fewer gaps, higher students-per-slot, no slot falling under
the 25% thin bar). **The projection is identical for both plans, so the comparison stays fair**: the
expert still beats the engine by 40% on student gaps (612 vs 1020) — the report's 1.5× ratio, intact.
The thin-slot census is the one metric the projection change silences entirely; it was already a
negative result ("density is not an expert objective"), so nothing is lost.

## 3. What the run says about the objective (unchanged in rank, sharper in mechanism)

1. **Same-course adjacency / no-splits** — 226 expert pairs and **zero** splits vs 26 pairs and
   **67** splits. Still the dominant missing term, and still behaving like a hard rule.
2. **Teacher compactness** — 74 vs 345 gap-slots, with the mechanism now localized: the engine takes
   **180 cohort switches (55% of them across an idle gap)** where the expert takes 86 (63% seamless).
   Gapped switches are where the engine's teacher holes are manufactured.
3. **Soft-availability as inviolable** — 0 vs 3, on a board the oracle permits.
4. **Student experience** — 612 vs 1020 gap-slots; the tier exists, sits last, and no operator hunts it.
5. **Week shape** — the expert starts every day at P1 and banks free capacity at Friday's tail
   (day-start free slots: 0/0 golden vs 2/1 generated).
6. **The fixtures are inputs** — 9 mirrored cells, all deliberate; the engine reproduces 1 by accident.

## 4. Full runner output

```
=== Rule verdict — Golden Plan (4bc9fe99-33ae-4c58-9b66-9b8477dad33f) ===
oracle-valid: YES · soft-availability warns: 0
  (no blocking violations, no generated-row stacking)

=== Rule verdict — Golden Catalog Clone (e67d3b63-d32c-4332-8f78-bd991b93ecd3) ===
oracle-valid: YES · soft-availability warns: 3
  (no blocking violations, no generated-row stacking)

=== Cohort scoreboard ===
Metric                       Golden Plan dp1  Golden Plan dp2  Golden Catalog Clone dp1  Golden Catalog Clone dp2
───────────────────────────  ───────────────  ───────────────  ────────────────────────  ────────────────────────
UNPLACED HOURS                             0                0                         0                         1
OVER-PLACED HOURS                          4                0                         0                         0
Uncatalogued rows                          0                0                         0                         0
Occupied slots                            48               47                        47                        47
Placement rows                           113              135                       109                       134
Interior holes                             0                0                         0                         0
Free at day START                          0                0                         2                         1
Free at day END                            2                3                         1                         2
Same-course adjacent pairs               101              125                         8                        18
Same-course same-day SPLITS                0                0                        27                        40
Students/slot median                      20               24                        19                        26
Thin slots (≤25% cohort)                   0                0                         0                         0
Courses/slot avg                        2.35             2.87                      2.32                      2.85
Multi-day courses                         19               22                        31                        33
Student gap-slots                        218              394                       436                       584
Single-lesson student-days                 0                0                         0                         0
Week A/B slot delta                        0                0                         0                         0
  ~ Golden Plan dp1 carries hours beyond the catalog's requirement: Chemistry HL 6/2h
  ! Golden Catalog Clone dp2 is INCOMPLETE — its slot count is flattered: EE −1h

=== Board-wide (both cohorts) ===
Metric                                                    Golden Plan                      Golden Catalog Clone
───────────────────────────  ────────────────────────────────────────  ────────────────────────────────────────
TEACHER gap-slots                                                  74                                       345
Worst teacher (gaps)         287fc436-3497-4dd1-bbb0-561f65e96caa: 12  8499a9a0-ca31-4403-9523-f481d4963088: 36
Avg teaching days / teacher                                      4.12                                      4.35
Avg hours / teaching day                                         3.56                                      3.30
Max consecutive teaching                                            6                                         7
Soft-availability hits                                              0                                         3
Strong-availability hits                                            0                                         0
Student gap-slots                                                 612                                      1020
Worst student (gaps)         167814a4-380e-42ed-8b18-51fe20994c0f: 20  2afe06cf-4b3a-4782-a342-ac259e8f9ce0: 27
Avg hours / student-day                                          6.77                                      6.64
Single-lesson student-days                                          0                                         0
Unplaced hours (total)                                              0                                         1

--- Distributions (the signal totals hide) ---
  Golden Plan
    teacher gaps: min 0 · p10 0 · median 4 · mean 4.35 · max 12
    teacher day span: min 1 · p10 2 · median 4 · mean 3.99 · max 8
    dp1 student gaps: min 0 · p10 0 · median 8 · mean 8.07 · max 16
    dp1 span efficiency: min 0.67 · p10 0.75 · median 1 · mean 0.90 · max 1
    dp1 late finishes: min 0 · p10 0 · median 1 · mean 1.23 · max 6
    dp2 student gaps: min 4 · p10 5.20 · median 12 · mean 11.59 · max 20
    dp2 span efficiency: min 0.50 · p10 0.75 · median 0.80 · mean 0.87 · max 1
    dp2 late finishes: min 0 · p10 0 · median 1 · mean 1.22 · max 6
  Golden Catalog Clone
    teacher gaps: min 0 · p10 6.40 · median 22 · mean 20.29 · max 36
    teacher day span: min 1 · p10 1 · median 6 · mean 5.54 · max 10
    dp1 student gaps: min 8 · p10 10.60 · median 16 · mean 16.15 · max 26
    dp1 span efficiency: min 0.43 · p10 0.63 · median 0.80 · mean 0.81 · max 1
    dp1 late finishes: min 0 · p10 0 · median 0 · mean 0.70 · max 6
    dp2 student gaps: min 6 · p10 12.30 · median 16.50 · mean 17.18 · max 27
    dp2 span efficiency: min 0.40 · p10 0.60 · median 0.80 · mean 0.80 · max 1
    dp2 late finishes: min 0 · p10 0 · median 1 · mean 0.99 · max 5

=== Cross-cohort weave ===
Metric                            Golden Plan  Golden Catalog Clone
──────────────────────────────  ─────────────  ────────────────────
Teachers (both cohorts / all)         16 / 17               16 / 17
Cohort-pure teacher-days        34 / 70 (49%)         21 / 74 (28%)
Cohort switches (within a day)             86                   180
— of which seamless                  54 (63%)              81 (45%)
Shared subject-edition days                37                    54
Mirrored cells (fixtures)                   9                     1

=== Mirrored cells — Golden Plan (4bc9fe99-33ae-4c58-9b66-9b8477dad33f) (9) ===
  d1 P1  Polish A SL
  d1 P2  Polish A SL
  d3 P1  SSSTS SL
  d3 P2  SSSTS SL
  d3 P7  Advisory
  d3 P8  CAS
  d3 P8  EE
  d5 P7  CAS
  d5 P7  EE

=== Mirrored cells — Golden Catalog Clone (e67d3b63-d32c-4332-8f78-bd991b93ecd3) (1) ===
  d3 P2  English B HL

=== Time-of-day gradient — Golden Plan (4bc9fe99-33ae-4c58-9b66-9b8477dad33f) ===
SSSTS 1.50 · ESS 2.50 · Polish A 3.50 · English A 4.50 · Physics 4.50 · Math AI 4.75 · Math AA 4.77 ·
Biology 5.17 · German B 5.17 · Spanish B 5.39 · English B 5.50 · History 5.50 · Psychology 5.67 ·
Computer Science 5.83 · BM 6 · Geography 6.17 · Chemistry 6.25 · CAS 6.40 · EE 6.40 · TOK 6.42 · Advisory 7

=== Time-of-day gradient — Golden Catalog Clone (e67d3b63-d32c-4332-8f78-bd991b93ecd3) ===
EE 2 · Physics 3.58 · German B 4.08 · Biology 4.58 · Spanish B 4.72 · Math AI 5 · CAS 5.20 · SSSTS 5.25 ·
Math AA 5.31 · Geography 5.33 · English B 5.39 · Polish A 5.50 · Computer Science 5.58 · English A 5.58 ·
Chemistry 5.75 · History 5.75 · Psychology 5.83 · BM 6.05 · TOK 6.25 · ESS 6.75 · Advisory 9.50
```

The expert's gradient is a legible curriculum (national-language and skills subjects in the morning,
pastoral/self-directed work in the afternoon, Advisory last). The engine's is noise — its Advisory
sits at mean period 9.5 and its EE at 2.

## Reproduction

Local stack up, both plans present (they survived from the 2026-07-12 session; after a `db reset`
restore `data/golden-plan.sql` and re-clone per `gold-plan-import.md`):

```bash
ANALYZE_PLAN_A=4bc9fe99-33ae-4c58-9b66-9b8477dad33f \
ANALYZE_PLAN_B=e67d3b63-d32c-4332-8f78-bd991b93ecd3 \
pnpm analyze:plans
```
