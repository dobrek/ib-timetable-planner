---
date: 2026-07-13T15:53:16+02:00
researcher: Claude (Fable 5)
git_commit: 50294b07f79bb61b7512eacc3d640e01035c41c4
branch: main
repository: ib-timetable-planner
topic: "What to ask the expert after analyzer run #1 — an evidence-anchored elicitation protocol"
tags: [research, codebase, generation-quality-tuning, plan-quality-analyzer, expert-elicitation, objective, timetable]
status: complete
last_updated: 2026-07-13
last_updated_by: Claude (Fable 5)
last_updated_note: "Added follow-up research: expert answers collected in expert-questions.pl.md — digest, rule classification, revised objective ordering"
---

# Research: What to ask the expert after analyzer run #1

**Date**: 2026-07-13T15:53:16+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: 50294b07f79bb61b7512eacc3d640e01035c41c4
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

The plan-quality-analyzer shipped and produced
[`analysis-run-1.md`](../../archive/2026-07-12-plan-quality-analyzer/analysis-run-1.md) — the
verify-gold verdict (world (a): rules are *missing*, not mis-specified) plus the full
expert-vs-engine feature diff. Given those findings, **what questions should we ask the expert to
move generation-quality tuning forward?**

## Summary

The expert session's job has fundamentally changed since discovery-notes §7 was written. That
agenda was designed to *discover* rules; measurement has now discovered them. Three of §7's core
questions are already answered by data (adjacency is near-inviolable, soft unavailability is
respected absolutely, day starts are never free), several are refuted (density, fixed-period
consistency, `is_optional`, teacher daily-load caps), and one entire family turned out not to be
preferences at all (the 9-cell fixture skeleton — those are *inputs*). What remains for the expert
is what data cannot answer:

1. **Classification boundaries** — measurement shows a pattern is *unbroken* in one 248-placement
   board; only the expert can say whether it is *unbreakable* (hard rule) or merely never-yet-worth
   breaking (top soft tier). The engine encodes these two answers in different places, so the
   distinction is load-bearing.
2. **Trade-off order, not weights** — the objective is a lexicographic tuple
   (`objective.ts:17`), deliberately weightless after the tier-bleed bug. Elicitation must
   therefore produce an *ordering* (forced A-or-B choices), never importance ratings.
3. **Fixture confirmation** — the mirrored-cell census found the school skeleton; the expert
   confirms it is fixed next year too, and whether the *cells* or only the *patterns* are fixed.
4. **Motive probes** — patterns whose cause decides whether they need their own objective term
   (edition anti-batching, cohort-switch weave, few-days concentration) or fall out of another
   term for free.
5. **Data ground truth** — the Chemistry overlap gap (4 of the 5 "unplaced" hours) and
   availability-data hygiene are modeling questions, not preferences; the expert supplies the
   facts, we decide the schema/loader fix.
6. **Acceptance thresholds** — what makes a generated board *shippable*, in countable features,
   so the tuning change has a success criterion.

**The meta-lesson shaping all of this**: open recall demonstrably under-reports. At frame time the
author confirmed the two captured rules were "the full tacit rule set"
(`context/archive/2026-07-11-plan-generation/frame.md:32-33`); measurement then surfaced at least
six missing dimensions. Every question below is therefore anchored to an artifact (a table, a
board, a perturbed variant) — never "what are your rules?".

Highest-leverage questions, in order: **E1** (Chemistry combined-session ground truth — unblocks
4 of 5 completeness hours, pure data decision), **B1–B3** (fixture skeleton — unblocks the pre-pin
experiment permanently and explains the 5th hour, dp2 EE), **A1** (same-day-split hard/soft — the
dominant missing term).

## The Expert Question Set

Capture format for every answer (from discovery-notes §7, extended):
**(rule) → (hard | top-soft | soft | bias | fixture | data) → (beats slots? beats teacher gaps?
beats student gaps?) → (encoding destination)**. The six possible destinations, with precedent:

| Destination | Where | Precedent |
|---|---|---|
| Hard rule | `verify.ts` constraint + `board.fitsAt` guard | `early-finish-edge.ts` (day-scoped, delta-aware) |
| Objective tier (+ position) | `objective.ts` tuple | `studentHoles` (`objective.ts:87-110`) |
| Construction bias | `stages.ts` / `problem.ts` | interior-first cell order (`problem.ts:83-91`) |
| LNS operator | `search.ts` | `migrateHolesToEdges` (`stages.ts:176-178`) |
| Fixture / pin | pre-placed board rows — works today, no code (`assemble-snapshot.ts:40-53`) | every existing placement is already an immovable pin |
| Data / schema | loader or migration | `finishes_early` flag — the template for a per-course rule flag |

### Block A — Classification boundaries (hard vs top-soft)

**A1. Is a same-day split EVER acceptable?**
*Evidence*: 0 splits in 248 expert placements vs 67 in the engine's board; the expert's own stated
heuristic ("never a gap between two hours of the same subject") predates measurement and the gold
board obeys it perfectly.
*Ask*: "Here is a board where Chemistry meets P2 and P5 on Tuesday. Is that ever shippable — even
if fixing it costs an extra slot, or leaves an hour unplaced? If yes, show the situation."
Follow-ups: does the ban hold across a lunch boundary? Do biweekly `a`/`b` lanes count separately?
*Encode*: never → new blocking cell-adjacent constraint beside `course-day-stacking.ts` (which
already scans a course's day) + a `fitsAt` guard; rare-exception → top soft tier, inserted
**above** `totalSlots`.

**A2. Are doubles a target, or only splits a sin — and for which courses are doubles *required*?**
*Evidence*: 226 adjacent pairs vs 26; the expert solved the hardest feasibility case (Chemistry,
teacher 20% strong-blocked) with three doubles; 41 multi-day courses vs the engine's 64 — the
expert concentrates hours into doubles on fewer days.
*Ask*: "Do you deliberately aim for double periods, or do they just fall out of the no-split rule?
Which courses *must* be doubles to be teachable (labs? languages?)? Is a 2-hour course always one
double?"
*Encode*: required-doubles → per-course flag à la `finishes_early` + hard placement shape;
general preference → soft adjacency tier + a "pull-adjacent" repair operator (§4 of
discovery-notes, step 4).

**A3. Is soft unavailability actually inviolable?**
*Evidence*: 0 soft hits in the gold board vs 3 oracle-legal hits in the engine's. Today the search
doesn't even *see* soft rows (`problem.ts:51-56` indexes only `strong`), and verify counts them as
warnings (`verify.ts:85-86`).
*Ask*: "You never used a soft-blocked cell. Would you ever — to complete the board? to avoid a
split? to save a slot? And when you enter 'soft', does it mean 'prefers not to' or 'actually
can't, but negotiable'?"
*Encode*: never → flip soft to blocking in `verify.ts` + index into `strongNo`; last-resort → a
high `softHits` tier + search-time penalty. Either answer also calibrates whether the current
strong/soft vocabulary (`shared/config/availability-severity.ts`) matches how the school uses it.

**A4. Day shape: must every day start at P1, and is short-Friday a rule?**
*Evidence*: expert day-start free slots 0/0 (engine 2/1); free capacity banked at day *ends* (2/3)
and specifically Friday's tail (both cohorts end Friday at P8; golden dp1's only free slots are
Friday P9–P10).
*Ask*: "Must every cohort day start at P1, even a light day? Is the short Friday deliberate policy
or this year's coincidence? Where is free capacity *allowed* to sit — end of any day, or
preferentially end of the week?"
*Encode*: hard day-start → structural check in `checkStructural` (`verify.ts:40-61`); preference →
free-slot position term weighted by (day-of-week, lateness), or extend the existing edge
reservation (`search.ts:262-266`) to prefer week-tail cells.

### Block B — Fixtures (inputs, not preferences)

**B1. Confirm the 9-cell skeleton — and whether cells or patterns are fixed.**
*Evidence*: the mirrored-cell census (`cross-cohort.ts:138-157`) found exactly 9, all deliberate:
Polish A SL d1 P1–P2 (parallel staffing), SSSTS d3 P1–P2 (one teacher, opposite week lanes),
Advisory d3 P7 (synchronized school-wide), CAS/EE d3 P8 + d5 P7 (paired biweekly, coordinators
swapping cohorts weekly).
*Ask*, per fixture, with the census printed: "Fixed at this exact cell next year? Fixed in
*pattern* only ('Advisory synchronized, some afternoon period')? Or free?" Also: "Who sets these —
you, or the school above you?"
*Encode*: pre-pin before generating — zero code needed, every placement is already a pin
(`generation/types.ts:16-23`). If patterns-not-cells, the fixture becomes a constraint family
instead — materially different, so pin down which.

**B2. Are there fixtures the detector can't see?**
*Evidence*: the census only finds cells mirrored *across cohorts*; single-cohort anchors would be
invisible.
*Ask*: "Before real planning starts, what do you place first? Anything immovable that lives in
only one cohort?"
*Encode*: extends the pre-pin list.

**B3. Must paired biweekly courses co-locate?**
*Evidence*: CAS(a)+EE(b) share cells throughout the gold board — `opposite_week` made physical.
The engine's *only* dp2 completeness failure was EE (−1 h): exactly this structure.
*Ask*: "Is 'CAS and EE share a cell on opposite weeks' a rule? Is the pairing fixed (always
CAS↔EE) or opportunistic? Are there other pairs?"
*Encode*: if a rule → a biweekly-pairing constraint/bias and possibly a data relation (pair id);
short-term the pre-pin covers it.

### Block C — Trade-offs and tier ordering

**C1. The forced-choice ladder.**
*Evidence*: the tuple is strict-priority — insertion position decides everything (discovery-notes
§5); the tier-bleed history (`hardening/change.md:14`) bans weighted sums, so we need *order*,
not ratings. The "engine out-minimizes the expert on dp2 slots" story died as a stale-catalog
artifact, so slot-tier dominance is genuinely unmeasured.
*Ask* as A-or-B cards, all else equal: (i) one extra occupied slot **vs** one same-day split;
(ii) one extra slot **vs** three soft-availability hits; (iii) one extra slot **vs** +50 teacher
gap-slots; (iv) +10 teacher gap-slots **vs** +30 student gap-slots; (v) one unplaced hour **vs**
*any* of the above (confirms completeness stays tier-1).
*Encode*: directly fixes each new term's insertion point in `Objective`.

**C2. Teacher vs student compactness — and the per-teacher tolerance.**
*Evidence*: teacher gaps 74 vs 345 (4.7×, the largest numeric gap; no teacher term exists in the
tuple at all); student gaps 612 vs 1020. Worst expert teacher: 12 gap-slots/week; engine's worst:
36.
*Ask*: "When a teacher's day and a student's day conflict, whose do you protect? Is there a number
of weekly gap-slots per teacher you'd never exceed (your worst case is 12)?"
*Encode*: `teacherHoles` tier (likely above `studentHoles` per the measurement) and possibly a
worst-teacher cap — hard or soft per the answer.

**C3. "First thing you look at" + "valid but never ship" — with both real boards open.**
*Evidence*: this is the world-(a) collection procedure — the oracle is complete on what it knows;
every expert "never ship" reason is a candidate *hidden hard rule*
(`archive research.md:330`).
*Ask*: side-by-side boards. "Which is better, and what did you check first? Now list everything on
the generated board you'd refuse to publish." Push each reason to a countable feature.
*Encode*: new hard rules and/or analyzer metrics; the "first thing" answer reveals the top soft
tier.

**C4. Acceptable bands, not zeros.**
*Evidence*: even the gold board carries student gaps (dp2 median 12, minimum 4) — zero is not the
target; the *right amount* is unknown.
*Ask*: "What's an acceptable gap-slot count per student per week? Per teacher? At what number do
you start reworking a day?"
*Encode*: normalization anchors for tier counting functions; possible soft caps.

### Block D — Motive probes (pattern measured, cause unknown)

**D1. Subject-edition anti-batching.**
*Evidence*: expert puts a subject's dp1 and dp2 editions on the same day less often (37 shared
days) than the engine (54), *not* explained by any daily-load cap (identical distributions,
already checked and refuted). Explicitly flagged "unknown motive → expert question" in the
archive (`research.md:509-510`).
*Ask*: "You avoid teaching a subject's two editions the same day. Deliberate? If so, why — prep
spreading, student rhythm, something else?"
*Encode*: only if deliberate → a shared-edition-day term; if a side effect of doubles-packing →
nothing, and we verify it emerges post-adjacency-fix.

**D2. Cohort-switch weave — rule or emergent?**
*Evidence*: 16 of 17 teachers teach both cohorts; expert takes 86 within-day switches (63%
seamless, 49% cohort-pure teacher-days) vs engine 180 (45%, 28%). Gapped switches are precisely
where the engine's teacher holes are manufactured.
*Ask*: "When a teacher has both cohorts in a day, do you consciously schedule the boundary
back-to-back? Do you aim for whole days in one cohort?"
*Encode*: deliberate → switch-count/seamlessness terms; emergent → expect `teacherHoles` to
capture it, and re-measure after that tier lands before adding anything.

**D3. Few-days concentration vs spread.**
*Evidence*: 41 multi-day courses vs 64 — the data contradicts discovery-notes §7e's spread
hypothesis; the expert concentrates. The 2/day cap is currently generator-hard
(`course-day-stacking.ts` + `verify.ts:121-125`).
*Ask*: "Do you put a course's hours on as few days as possible? Any course that must meet every
day, or has a minimum days-spread? Is 'max 2 per day' the real cap for every course?"
*Encode*: days-per-course preference → candidate-ranking bias (`stages.ts:181-198`) or soft term;
any per-course cap exceptions → data flag.

**D4. Label the time-of-day gradient.**
*Evidence*: the expert's gradient is a legible curriculum (SSSTS 1.5 → … → Advisory 7.0); the
engine's is noise (Advisory at 9.5, EE at 2). The T3 metrics (heaviness shares, discouraged
back-to-back pairs, lab doubles, subject-pair balance) are all blocked on labels that exist
nowhere (`archive research.md:288`).
*Ask*: bring the gradient table; the expert labels every subject **must-morning / prefer-morning /
neutral / prefer-afternoon / must-be-last**. Then: "Is this ordering about cognitive load, or did
teacher availability force it? Which placements here are convention (Advisory last) vs choice?"
Also collect: subject pairs that should never be back-to-back.
*Encode*: labels stored as analyzer config first (unblocks T3 metrics), a soft time-of-day term
second; schema column only if labels prove stable.

### Block E — Data ground truth (modeling, not preference)

**E1. How is dp1 Chemistry actually taught?** *(highest leverage in the whole set)*
*Evidence*: `Chemistry SL` (base, 4 required h, **0 direct enrolments**) is dropped by the
projection (`load-cohort-courses.ts:61`) — the overlap fold only pushes students *onto the base*
(`load-cohort-courses.ts:67`), never hours onto the dependent — so the engine's catalog asks for
2 h where the school teaches 6. This is 4 of the 5 "unplaced" hours; no objective tuning can
touch it.
*Ask*: "Do the 9 HL students sit all 6 weekly hours together (4 shared + 2 HL-only)? Is anyone
enrolled in SL only? One teacher for all 6 hours? And are there *other* courses where the taught
session differs from the catalog's hours?"
*Encode*: pick one — (a) projection keeps zero-direct-choice overlap bases, (b) prod catalog
carries the hours on the dependent, (c) the pair becomes a merge (the only existing
combined-session mechanism, `load-cohort-courses.ts:70-84`). The expert's answer selects the
option; all three are cheap.

**E2. Availability data hygiene and the missing positive axis.**
*Evidence*: 125 availability rows across 10 teachers; the schema knows only *negative* preference
(`soft` = "prefers not to", `20260613130000_teacher_availability.sql`). No "wants mornings"
signal exists anywhere.
*Ask*: "Is the availability data complete and current for next year? Do teachers have positive
preferences you honor but never wrote down? Are the 7 teachers with zero rows genuinely
unconstrained?"
*Encode*: possibly nothing; possibly a positive-preference severity or a teacher-preference term.
Don't build until the expert says the data exists.

**E3. Subject identity for adjacency grouping.**
*Evidence*: open question since the analyzer plan (`archive research.md:208`): the projected
`GroupingCourse` deliberately carries no name/level; the analyzer re-queries and groups mirrored
cells by name+level, subject roll-ups by name alone.
*Ask*: "Is Math AA 'the same subject' as Math AI for adjacency purposes? Is 'same subject' the
course, name+level, or a discipline above both?"
*Encode*: the grouping key for every adjacency/fragmentation metric and any subject-level term.

### Block F — Acceptance and generality

**F1. The shippability threshold.**
*Ask*: "Suppose the generator returns a board with all fixtures respected, zero same-day splits,
zero soft hits, and teacher gaps within 2× of yours. Do you publish it after light edits? How many
manual fixes make it not worth using?"
*Encode*: the tuning change's success criterion — without this, "better" has no stopping rule.

**F2. The intended workflow.**
*Ask*: "Would you adopt: place fixtures → generate → hand-repair? What must the tool show you to
trust the output?" (The B-vs-C in-app surface decision is explicitly deferred until after this
session — `archive research.md:212`.)

**F3. More gold plans.**
*Evidence*: exactly one gold board exists (prod "2026/2027"); with n=1 we cannot separate the
school's invariants from this year's accidents. The mirrored-cell census doubles as an automatic
fixture detector on any future import (`archive research.md:525`).
*Ask*: "Do previous years' timetables survive anywhere — old system, spreadsheet, paper? Even one
more year would let us test which patterns repeat."
*Encode*: a small import scope item (`gold-plan-import.md:195-196` already sketches it).

**F4. Perturbation probes (bring these prepared).**
*Evidence*: sharper than abstract questions — directly tests hard-vs-soft at the boundary.
*Ask*: 3–4 near-miss variants of the golden board, one edit each: introduce one same-day split;
move one placement onto a soft-blocked cell; move Advisory off d3 P7; fill Friday P9–P10 and free
Monday P1 instead. For each: "still shippable?"
*Encode*: each "no" hardens the corresponding rule; each "yes, reluctantly" places it as a soft
tier and hints at its position.

### Do NOT re-ask (settled by measurement)

- Whether the oracle's rules are wrong — **world (a) settled**: gold passes cleanly; rules are
  missing, not mis-specified.
- Slot-coverage density (refuted — expert's is *lower*; thin slots are deliberate edge doubles).
- Fixed-period consistency (refuted — only 5% of multi-day courses repeat a signature).
- `is_optional` placement (unused in both boards).
- Interior holes (both boards at zero — tier 2 is adequate).
- Teacher daily-load caps (identical distributions, max 7 h — drop the hypothesis).

### Session materials checklist

Both boards open in the app (perspective views) · the cohort scoreboard + board-wide tables from
analysis-run-1 · the mirrored-cell census · the time-of-day gradient table · forced-choice cards
(C1) · perturbation variants (F4) · a blank subject-labeling sheet (D4) · the capture template.

**Sequencing recommendation**: run the pre-pin fixture experiment *before* the session if
feasible — it needs no code (clone catalog-only via `clone_plan(id, name, false)`, hand-place the
9 cells, generate, `pnpm analyze:plans`). It likely fixes dp2 EE, tests the fixture theory, and
gives the session a third board to react to.

## Detailed Findings

### The encoding surface — what the engine can act on today

- **Objective**: `Objective = [unplacedTotal, holes, totalSlots, studentHoles]`, lexicographic,
  at `src/entities/timetable/model/generation/objective.ts:17`; comparator `objective.ts:35-40`;
  assembled by `scoreCandidate` `objective.ts:46-71`. No teacher, adjacency, time-of-day, or
  day-shape term exists. Adding a soft term is a mostly one-file change (counting function +
  tuple position); `compareObjectives` needs no change.
- **Hard rules** (verify oracle `generation/verify.ts` + registry
  `model/collision/constraints/index.ts:12-20`): duplicate-course, teacher-conflict,
  student-conflict, teacher-availability (strong→block, soft→warn), cross-cohort-teacher,
  early-finish-edge (blocking, delta-aware), course-day-stacking (2/day cap — generator-hard via
  `verify.ts:121-125`, pin-only stacks permitted).
- **Search feasibility** `engines/greedy/board.ts:162-166` (`fitsAt` = `feasibleWeek` +
  `flaggedEdgeOk`). **Soft availability is invisible to the search** — only `strong` rows are
  indexed (`engines/greedy/problem.ts:51-52`); the 3 soft hits in the generated board were never
  even penalized.
- **Construction biases**: interior-first cell order (`problem.ts:83-91`), backbone cliques
  (`problem.ts:100-118`), edge reservation at rate 0.67 (`search.ts:39`, `search.ts:262-266`),
  most-remaining-first candidate ranking (`stages.ts:181-198`).
- **LNS**: destroy = whole-day slice or random ~15% (`search.ts:273-287`), repair = stage
  pipeline re-run; accepts only strict tuple improvements (`search.ts:121`). One polish operator
  exists (`migrateHolesToEdges`, `stages.ts:176-178`); nothing hunts student holes, teacher
  holes, or adjacency.
- **Tunables**: `createGreedyEngine({ stagnationMs, diversifyAttempts })` (`search.ts:52-57`);
  in-app budget is a 20 s constant (`_pages/plan-detail/model/generation/worker-protocol.ts:12`),
  no Astro Action — generation runs in a client Web Worker.
- **Pins**: every existing placement becomes an immovable pin
  (`generation/assemble-snapshot.ts:40-53`, semantics `generation/types.ts:16-23`) — the
  fixture pre-pin experiment requires no code. There is no persisted pin flag; `is_optional` is
  unrelated (render-only).

### The projection gap behind "4 unplaced hours"

`loadCohortCourses` keeps a course only if it has ≥1 direct `student_choices` row (or is a merge
parent) — `src/shared/api/load-cohort-courses.ts:60-68`. The overlap fold
(`load-cohort-courses.ts:43-47,67`) pushes the *dependent's students onto the base*, assuming the
base has direct enrolments. dp1 Chemistry inverts that topology: the SL **base** has 0 direct
choices → dropped with its 4 `hours_per_week`; the HL **dependent** survives at 2 h. No constraint
re-couples the pair (the collision registry has no overlap rule — the only coupling is the shared
student roster), and no schema mechanism exists for combined-session hours across an overlap
(merges are the only combined-session concept). The analyzer surfaces the expert's 6 h on HL as
`OVER-PLACED HOURS: golden dp1 = 4`, never netted. Fix options (E1) are all cheap; the expert's
ground truth picks between them.

### What history says about elicitation reliability

- Frame-time claim, later falsified: "the two captured rules (2/day spread cap, early-finishing
  courses at day edges) are the full tacit rule set"
  (`context/archive/2026-07-11-plan-generation/frame.md:32-33`); the hypothesis "hidden rules
  remain unmodeled" was marked **Refuted** on the author's word (`frame.md:65`). Measurement then
  found ≥6 unmodeled dimensions. Conclusion: recall-based questioning under-reports badly;
  artifact-anchored confirmation is the method.
- The one prior hard/soft classification made without data went *against* research advice:
  `finishes_early` was promoted to HARD by author fiat
  (`plan-generation/change.md:34-37`) and became the engine's most fragile rule (relational,
  whole-board-rejecting, source of the shipped boxing bug and the livelock-avoiding delta
  semantics). The A-block boundary questions exist precisely to make the next hard/soft calls
  with evidence.
- The expert's one pre-measurement stated heuristic ("no gap between two of the same subject")
  was *confirmed exactly* by the gold board (0 splits / 226 pairs) — self-reported rules are
  reliable when stated; they are just incomplete. Ask for confirmations and boundaries, not
  enumerations.

### Why the questions target the objective, not search power or compute

- More compute is not the lever: real-catalog runs stagnate around 6.7–9.2 s against the 20 s
  budget (`refactor/plan.md:33`), and the CP-SAT spike found the entire remaining slot headroom
  is ~1–2 dp1 slots (`refactor/plan.md:39-44`).
- But a search wall exists: dp1 = 48 (the exact max-weight-clique bound) has never been produced
  complete by the engine (`plan-generation/change.md:110-113`) — the expert's board proves it is
  feasible *and oracle-valid*. Archive Follow-up 6 recommends a hybrid (CP-SAT as an exact
  residual-repair operator) if GRASP+LNS can't close the last gap after the representational
  fixes. None of that needs the expert — hence no questions about it.

## Code References

Permalink base: `https://github.com/dobrek/ib-timetable-planner/blob/50294b07f79bb61b7512eacc3d640e01035c41c4/`

- `src/entities/timetable/model/generation/objective.ts:17` — the lexicographic `Objective` tuple; every C-block answer maps to an insertion position here
- `src/entities/timetable/model/generation/verify.ts:64-98` — oracle verdict rule; destination for A-block "hard" answers
- `src/entities/timetable/model/collision/constraints/index.ts:12-20` — the complete hard-rule registry (no adjacency, no overlap coupling)
- `src/entities/timetable/model/generation/engines/greedy/board.ts:106-124` — search-time feasibility; soft availability absent
- `src/entities/timetable/model/generation/engines/greedy/problem.ts:51-52` — only `strong` availability indexed into the search
- `src/entities/timetable/model/generation/engines/greedy/search.ts:52-57` — `GreedyTuning`; A/B seam for every new term
- `src/entities/timetable/model/generation/types.ts:16-23` — pins semantics ("never moves or removes them") — the fixture mechanism
- `src/entities/timetable/model/generation/assemble-snapshot.ts:40-53` — every board placement becomes a pin
- `src/shared/api/load-cohort-courses.ts:60-68` — the projection filter that drops the Chemistry SL base
- `src/shared/api/load-cohort-courses.ts:43-47` — overlap fold direction (base receives dependent's students; never the reverse)
- `src/entities/timetable/model/analysis/cross-cohort.ts:138-157` — mirrored-cell census = fixture detector (B1 artifact)
- `src/entities/timetable/model/analysis/subject-rollup.ts:22-50` — time-of-day gradient (D4 artifact)
- `bench/plan-quality.analyze.ts` — `pnpm analyze:plans`; the instrument for every post-session A/B
- `bench/load-plan-analysis-input.ts:62-71` — `pins: []` verify-gold convention
- `supabase/migrations/20260711174905_clone_plan_include_board.sql:17` — `clone_plan(id, name, include_board)`; catalog-only clones for experiments
- `supabase/migrations/20260613130000_teacher_availability.sql:12-27` — strong/soft availability schema; absence = available
- `_pages/plan-detail/model/generation/worker-protocol.ts:12` — the 20 s zero-config budget

## Architecture Insights

- **Lexicographic elicitation**: because the objective is an ordered tuple (weighted sums are
  banned by the tier-bleed lesson), the *only* useful preference data is ordinal — forced-choice
  pairs, not importance scores. The C1 ladder is shaped by this.
- **Six encoding destinations**: hard rule / tier / bias / operator / pin / data. Every question
  above was designed backwards from a destination; an answer that doesn't select one isn't
  actionable and was cut.
- **Pins are already universal**, so the fixture experiment (the cheapest completeness lead
  besides E1) is a workflow, not a feature.
- **Labels-as-config before labels-as-schema**: D4's subject labels should land as analyzer
  config first (unblocking the T3 metrics), graduating to a `courses` column only once stable —
  mirrors how `finishes_early` was introduced only when the rule was confirmed.
- **The analyzer is the loop-closer**: every expert answer that becomes a term gets A/B'd via
  `createGreedyEngine` on fresh catalog-only clones and re-measured with `pnpm analyze:plans`
  against the run-1 numbers.

## Historical Context (from prior changes)

- `context/archive/2026-07-12-plan-quality-analyzer/analysis-run-1.md` — the run this research
  responds to: world (a) verdict, exact golden parity, the two report corrections (9 mirrored
  cells; the Chemistry over-placement reframe).
- `context/archive/2026-07-12-plan-quality-analyzer/comparison-report.md` — ranked findings and
  the original expert-session recommendation (§Recommendations 4).
- `context/archive/2026-07-12-plan-quality-analyzer/research.md` — Follow-ups 2–7: the fork
  (`:326-336`), rig verification, the first diff, latent patterns, engine-capability assessment,
  cross-cohort weave; open questions `:206-214`; anti-batching flag `:509-510`; boundary probes
  `:428`.
- `context/archive/2026-07-12-plan-quality-analyzer/gold-plan-import.md` — provenance: prod
  "2026/2027" is the only gold board; `data/golden-plan.sql` is LOCAL-ONLY/gitignored (production
  PII — see the no-prod-data rule); import runbook + backup-tool candidate scope.
- `context/archive/2026-07-11-plan-generation/frame.md:32-33,65` — the "full tacit rule set"
  claim, refuted by measurement; the origin of the artifact-anchored method.
- `context/archive/2026-07-11-plan-generation/change.md:110-113` — dp1=48 "unreachable" under
  current rules; the expert's board later proved it feasible and legal.
- `context/archive/2026-07-12-generation-engine-hardening/change.md:12-16` — the flagged-edge
  boxing bug + tier-bleed bug: why hard rules are delicate and scalars are banned.
- `context/archive/2026-07-12-generation-engine-refactor/change.md:33-38,65-67` — objective.ts
  extraction (engine-agnostic terms) and the standing deferrals (CP-SAT, studentHoles operator,
  week-aware metrics).
- `context/changes/generation-quality-tuning/discovery-notes.md` — §7 (the pre-data question
  framework this protocol supersedes), §5 (lexicographic caveat), §3 (layer map).

## Related Research

- [`expert-questions.md`](expert-questions.md) — the expert-facing handout distilled from the
  question set below: internal jargon and encoding destinations stripped, evidence restated in
  domain language, answer-capture lines added. Give the expert that file, not this one.
  Polish version: [`expert-questions.pl.md`](expert-questions.pl.md).
- `context/archive/2026-07-12-plan-quality-analyzer/research.md` — the analyzer's own research
  doc (metric taxonomy, acquisition options, the fork).
- This document supersedes discovery-notes §7 as the expert-session agenda; §7's capture format
  (rule → hard/soft → tier evidence) is retained and extended.

## Open Questions

- **Ours, not the expert's** (from the archive, still open): does the catalog hash serialize all
  `GroupingCourse` fields (must check before extending the type —
  `archive research.md:214`)? Cross-plan drill-down join identity `(cohort, name, level,
  group_index)` (`archive research.md:210`). The gitignore glob `/data/golden-plan*.sql` is
  name-specific — broaden to `/data/*.sql` (impl-review F5, still open).
- **Sequencing**: pre-pin experiment before or after the session? (Recommended: before, if the
  session isn't imminent — it's a no-code afternoon and produces a third artifact.)
- **Session capture tooling**: where do the expert's labels/classifications live so they survive
  into implementation — analyzer config module, or a `context/` decision doc first? (Lean:
  decision doc in this change folder, promoted to config when terms are built.)
- **n=1 risk**: every finding is one board by one expert for one year. F3 (more gold plans) is
  the only mitigation available; if none exist, classifications from this session should be
  encoded soft-first (reversible) wherever the expert hesitates.

## Follow-up Research 2026-07-13 — the expert answered

The expert filled in the Polish questionnaire ([`expert-questions.pl.md`](expert-questions.pl.md),
answers inline under each `> Odpowiedź:`). Only 7.1 (the labeling exercise — answered inside the
table instead), 9.2 (live-session walkthrough), and the 9.2 notes remain blank. The answers
**confirm the two headline rules, validate the current dominant tier, and overturn four of our
working hypotheses**. Digest, classification, and revised model below. Answers were given partly
via dictation; two probable transcription artifacts are flagged where interpretation matters.

### Answer digest (translated, grouped by what it settles)

**Confirmed hard (the "never" answers).**
- **Same-day split: never** (1.1) — *even at the cost of an extra slot or an unplaced hour*, and
  the lunch break counts like any other break (1.2). Re-confirmed twice: forced choice 5.1
  ("I would never look for another solution" — i.e. the split variant is not an option) and
  perturbation 9.3(a) "never".
- **Advisory is an immovable synchronized cell** — school leadership decides, not the planner
  (4.2); perturbation 9.3(c) moving it: "never". New detail: Advisory is effectively biweekly —
  the same slot hosts an all-teachers meeting on the alternate week, so **all teachers must be
  free in that slot board-wide**.
- **A teacher's working day must not exceed 8 hours** (labor law) — surfaced twice, in 2.3 and as
  the *reason* teachers win trade-off 5.6. **A brand-new hard rule: the engine has no daily
  teacher-hour cap at all** (gold's max is 7, engine's 7 — never tested above).

**The trade-off ladder (5.x) — the tier-ordering data we wanted.**
- 5.1 split vs slot → **split refused outright** (hard, consistent with 1.1).
- 5.2 one extra slot vs three soft-availability hits → **takes the soft hits**. Slots outrank
  soft hits.
- 5.3 one extra slot vs +50 teacher windows → **takes the teacher windows** — because DP teachers
  also teach other divisions of the school, so their DP "windows" are often absorbed by other
  lessons. Slots outrank teacher gaps.
- 5.4 +10 teacher windows vs +30 student windows → **takes the student windows**. Teacher comfort
  outranks student comfort (5.6: teacher wins, labor-law backed).
- 5.5 one unplaced hour vs a complete board that violates any of the above → **the violation is
  worse**. An hour left for hand-placement beats a rule-breaking complete board.
- 5.7 no hard per-teacher window cap exists — and a key measurement caveat: our teacher-gap
  metric sees only the two DP boards; the teachers' school-wide schedules make some measured
  windows not-really-windows.
- 5.8 student windows: the expert *checked their own plan* — max 10 per student, average lower
  (consistent with our dp2 distribution: max 20 per two-week cycle = 10/week). Mechanism note:
  student windows are also minimized at *grouping* time, by assigning students to TOK/CAS/EE
  groups so the would-be window is filled — an optimization lever outside placement entirely.

**Soft availability (block 2) — softer than measurement suggested.**
- Soft = "a polite wish, often negotiated personally" (2.2). Placement on a soft-blocked cell is
  acceptable **as a last resort, teacher-dependent**, and when done the expert *compensates* on
  another day — a very short day or one with no windows (2.1; "bez ognia" read as a dictation
  artifact for "bez okienek"/no windows). Perturbation 9.3(b): "possible". **Do NOT promote soft
  to blocking** — it is a high soft objective, not a hard rule. Measurement's "inviolable"
  reading was over-strong; asking was worth it.
- The real availability story is richer than the schema (2.3–2.4): some teachers are available
  **either the first four or the last four periods of a day** (a disjunction the per-cell model
  cannot express); positive, frequency-capped preferences exist ("early mornings ≤2×/week",
  "until 17:00 ≤1×/week") and live in a pre-planning teacher survey, not in the system.

**Day and week shape (block 3) — deliberate policy, softly held.**
- Day starts at P1: "last resort" — students prefer finishing earlier over starting later (3.1).
  Strong soft preference, not hard.
- **Short Friday is explicit school policy** born of complaints (Friday-till-17:00, commuting
  students) (3.2). Free space belongs "at the end of the day, and as much as possible on Friday"
  (3.3); moving Friday's free tail to Monday morning is "worse — everyone wants to start the
  weekend earlier" (9.3d).

**Fixtures (block 4) — the skeleton shrinks and sharpens.**
- **Polish A Monday P1–P2 is a coincidence** (4.1 row 1) — *not* a fixture. The mirrored-cell
  detector over-claims: it finds candidates, a human must confirm. (Correction to
  analysis-run-1's "all deliberate".)
- SSSTS is not a fixed cell but a *pattern*: teacher SD's heavily restricted hours + "must be the
  first or last lessons of the students' day", split across cohorts week A/B (4.1 row 2) — i.e.
  availability data plus a finishes-early-style edge requirement.
- CAS/EE: confirmed as the only paired structure (plus SSSTS's alternation) (4.4); the pair is
  movable but must obey the finish-early edge rule (4.2); lanes are swapped between cohorts
  deliberately to rebalance monthly EE-vs-CAS emphasis (4.1 row 4).
- **The expert's construction order**: planning *starts* from Advisory, the TOK blocks, and
  CAS/EE — everything that stops mid-year and must sit at student-day edges (4.3). The engine
  places flagged courses at stage 4; the expert seeds with them first.
- Pre-pin workflow: "a possible variant" (4.5), "it is possible" (10.2) — accepted.

**Doubles and subject identity (block 1).**
- Doubles are *deliberately sought* — "because that's what the teachers prefer" (1.3). Exceptions
  (no doubles): CAS/EE and one DP1 TOK hour; some language courses (Spanish ab initio, German B
  SL) may be split into singles. TOK is the only 2 h/week course and "will usually be a block"
  (1.4).
- Subject identity: Math AA and Math AI are **entirely different subjects**; English B exists
  only as HL at this school (it's the language of instruction) (1.5). "Same subject" = the
  concrete course — our per-course adjacency grouping is correct; no cross-level family merging.
- New thread: English B lessons are "mostly coupled with English A" and depend on the English A
  teacher's availability (7-table note) — meaning unclear, flagged as a follow-up question.

**The time-of-day gradient is an availability artifact (block 7) — hypothesis refuted.**
The expert annotated the gradient table cell by cell: Math teachers "prefer morning"; ESS/Biology
= teacher wish; CAS teacher "very much does not want mornings"; EE = very limited availability;
Physics teacher = first-4-or-last-4 + fully unavailable Tuesdays; Psychology/TOK = teachers'
personal circumstances; Geography, History, Computer Science, Spanish B, BM = *coincidence*;
Advisory = fixed slot; SSSTS = student-day-edge rule. 7.2 verdict: **"availability, teacher
preferences"** — not subject heaviness. 7.3: no forbidden back-to-back subject pairs. The
"legible curriculum" reading of the gradient was wrong; **there is no subject-heaviness objective
to encode**, and the planned T3 heaviness-label config is dead. The investment belongs in teacher
preference/availability data instead.

**Patterns that turned out emergent (block 6) — no new terms needed.**
- Edition anti-batching: not deliberate — yearly enrollment/assignment variance (6.1).
- The cohort-switch weave (seamless switches, cohort-pure days): "the effect of avoiding teacher
  windows" (6.2) — `teacherHoles` should capture it; no separate switch term.
- Few-days concentration: no deliberate rule — 2/day cap + teacher availability drive it (6.3);
  no exceptions to the 2/day cap beyond the doubles notes (6.4).

**Chemistry and catalog ground truth (block 8).**
- The combined-group mechanism confirmed: SL+HL taught together while the group is ≤16 students
  (teacher availability and school budget permitting); above 16 it splits into separate SL and HL
  classes (8.1). This year's combined 6 h session is real; **next year may differ** — so the fix
  must be per-year catalog data, not hardcoded structure. Nothing else in the catalog deviates
  from recorded hours (8.2).

**Acceptance and generality (blocks 9–10).**
- First checks on any plan (9.1): does Friday end early · is Advisory in its fixed place · are
  subjects blocked, "not stupidly split — e.g. TOK at period 7 and period 9".
- **The manual plan took ~40 hours of work. "Any solution that costs less work is worth it"**
  (10.1) — a generous, concrete acceptance bar.
- Old plans exist (10.3), but the expert doubts year-to-year transferability of specifics
  (enrollment- and assignment-driven). Import optional, for invariant-checking only.
- Closing catch-all: no further hidden rules (matches the oracle-valid verdict).

### Rule classification table

| # | Rule / fact | Class | Encoding destination |
|---|---|---|---|
| R1 | No same-day split, lunch included; outranks slots AND completeness | **Hard** | new blocking constraint beside `course-day-stacking.ts` + `fitsAt` guard |
| R2 | Teacher day ≤ 8 h (labor law) | **Hard (new)** | per-teacher daily-hour cap in verify + `fitsAt` — engine currently has none |
| R3 | Advisory cell immovable, synchronized, all teachers free that slot | **Fixture (hard pin)** | pre-pin; slot-wide teacher block is implied data |
| R4 | Slot count is the dominant soft dimension (beats soft hits, teacher gaps) | **Confirmed tier** | `totalSlots` stays where it is — frame-time contention resolved |
| R5 | Teacher gaps > student gaps, both below slots; DP-only measurement overstates real windows | **Soft tiers** | `teacherHoles` tier above `studentHoles`, below `totalSlots` |
| R6 | Soft-availability hit = last resort, negotiated, compensated | **Soft, high** | `softHits` tier + search-time penalty (currently invisible to search); do NOT make blocking |
| R7 | Deliberate doubles; exceptions CAS/EE, one DP1 TOK hour, some languages splittable | **Soft bias + per-course data** | adjacency preference term / repair operator; exception flags à la `finishes_early` |
| R8 | Days start at P1 (last-resort exceptions); free space at day ends, maximally Friday | **Soft (two terms or one weighted)** | free-slot-position term; possibly extend edge reservation toward week tail |
| R9 | CAS/EE pairing (only pair); movable under finish-early rule | **Fixture-pattern** | pre-pin now; pairing constraint later if needed |
| R10 | SSSTS = restricted-availability + student-day-edge pattern, cohort-alternating | **Data + existing edge rule** | verify availability rows; likely `finishes_early`-family flag |
| R11 | Polish A Monday mirror = coincidence | **Correction** | drop from fixture list; mirrored-cell census = candidate detector, human-confirmed |
| R12 | Construction seeded from mid-year-ending courses (Advisory, TOK, CAS/EE) | **Construction bias** | consider flagged/fixture-first stage ordering (engine currently stage 4) |
| R13 | Gradient = teacher availability/preferences, not subject heaviness | **Refutation** | drop T3 heaviness labels; no time-of-day subject term |
| R14 | No back-to-back-pair rule; anti-batching, weave, few-days all emergent | **Negative results** | no new terms |
| R15 | Disjunctive availability (first-4 XOR last-4); frequency-capped positive prefs | **Data-model gap** | future change: teacher-preference survey modeling |
| R16 | Chemistry combined ≤16 group; per-year, budget-dependent | **Data (per-year)** | catalog fix for 2026/27 (hours on dependent or keep base); projection decision stands |
| R17 | Unplaced hour < any rule violation; hand-finish acceptable | **Semantics confirmation** | engine already never emits oracle-rejected boards; keep unplaced as the residue |
| R18 | Acceptance: beat ~40 h of manual work; checks = Friday short, Advisory fixed, blocks unsplit | **Success criteria** | the tuning change's definition of done |

### Revised objective picture

```
HARD (verify + fitsAt):  existing oracle rules
                         + no-same-day-split          (R1 — new)
                         + teacher-day ≤ 8h           (R2 — new)
                         + fixtures honored via pins  (R3)

SOFT (lexicographic):    1. unplacedTotal      (unchanged)
                         2. holes              (unchanged, untested — both boards 0)
                         3. totalSlots         (CONFIRMED dominant — R4)
                         4. teacherHoles       (R5; above softHits per G4)
                         5. softHits           (above studentHoles — inferred, not probed)
                         6. studentHoles       (R5, stays last of the people-tiers)
                         + day-shape terms     (R8 — position below slots; exact rank TBD)
                         + golden-slot band    (R20 — mid-day P4–P7 per G3; soft)

BIAS/OPERATOR:           doubles preference (R7), flagged-first seeding (R12),
                         week-tail edge reservation (R8)
```

The single biggest planning consequence: **the objective work is smaller than feared**. Two new
hard rules, one confirmed tier, two tier insertions, one bias — and four whole hypothesis
families (heaviness, switches, anti-batching, spread) need *nothing*.

### Corrections to prior findings

- `analysis-run-1.md` §"mirrored cells: all deliberate" — **wrong for Polish A** (coincidence);
  the deliberate skeleton is 7 cells (SSSTS ×2, Advisory, CAS/EE ×4), of which Advisory is the
  only leadership-fixed cell.
- "Soft availability behaves as inviolable" (comparison-report finding #4) — behavior yes,
  classification no: it is a compensated last resort, top-soft not hard.
- "The expert's gradient is a legible curriculum" (analysis-run-1 closing) — refuted by the
  author of the plan; it is an availability shadow.
- "Teacher compactness may belong above `studentHoles`, possibly high" — direction confirmed
  (above students), magnitude capped (below slots); and the metric itself overstates harm since
  DP windows are partly absorbed by other-division teaching.

### New/remaining unknowns

- ~~`softHits` vs `teacherHoles` relative order~~ — **resolved** by follow-up G4:
  `teacherHoles` above `softHits` (see the G-answers in the addendum below).
- ~~What "English B coupled (sprzężone) with English A" means operationally~~ — **resolved** by
  the expert's post-questionnaire addendum: they are deliberately co-scheduled into the same slot
  to form a *Golden Slot* (see the addendum below).
- Whether SSSTS/TOK/CAS/EE all carry `finishes_early` flags in the imported gold catalog —
  verify by query before relying on R10/R12.
- Whether the Advisory slot's "all teachers must be free" is representable today (it isn't in
  `teacher_availability` semantics — absence = available); a pre-pin makes it moot for
  generation, but verify would not catch a manual violation.
- Two transcription artifacts interpreted, to confirm with the expert if ever load-bearing:
  "bez ognia" → "bez okienek" (2.1); English A's "wybór niedostępny" (7-table) → garbled
  availability remark.

### Addendum 2026-07-13 — the Golden Slot rule (post-questionnaire)

After submitting the questionnaire the expert revised her catch-all answer ("no hidden rules")
with one more rule — verbatim in [`expert-questions.pl.md`](expert-questions.pl.md)
§Uzupełnienie. Translated:

> English A is often combined with English B — and if there are two English B groups, with BOTH
> of them — because that creates what I call a **Golden Slot**: at that moment absolutely every
> student is in class. You asked about a golden rule and I didn't write one in then; now that I
> think about it, the golden rule is *finding exactly these slots*. They are certainly possible
> for English A + English B, and possible for TOK — provided all TOK lessons are taught by
> different teachers. If a Golden Slot (or an *almost*-Golden Slot) can be assembled from other
> subjects, it must absolutely be placed on the plan, because it engages the maximum number of
> students.
>
> When you find such golden slots, place them **roughly mid-day, around the lunch break**. That
> creates a *peak* in the day's plan, and it is easier to arrange the smaller-enrolment subjects
> around that peak.

This resolves the "English B sprzężone with English A" unknown (deliberate co-scheduling, not a
teacher dependency) and revises the catch-all answer: one hidden rule *did* surface — after the
artifact-anchored session ended, which is itself a data point (the questionnaire primed recall
that fired later).

**Verified against both boards** (SQL census, 2026-07-13; local rig, coverage = distinct
students per `(cohort, day, period, week-lane)` via the app's roster expansion — direct choices
∪ merge-children ∪ overlap-dependents):

| | Golden Plan | Golden Catalog Clone |
|---|---|---|
| Golden cells (100% coverage, both lanes) | **15** (dp1 7 / dp2 8) | 13 (dp1 8 / dp2 5) |
| — of which composite (3+ subjects) | **3** | 0 |
| Near-golden lanes (≥ cohort−3, <100%) | 16 | 12 |
| **Mean period of golden cells** | **dp1 4.6 / dp2 5.75** (mid-day band P2–P10, centred P3–P7) | dp1 7.5 / dp2 8.0 (day-tail, P4–P10) |

Composition confirms every element of the statement: dp1 has English A SL + English B HL doubles
(d3 P3–P4, d5 P3–P4) and a TOK + TOK double with two distinct teachers (d2 P5–P6 — her stated
precondition, satisfied); dp2 has English A + **both** English B groups (d1 P3–P4, d5 P5–P6);
and only the expert assembles composite golden slots from "other subjects": `BM HL + German B AB
+ TOK + TOK` (d2 P9–P10) and `BM SL + CAS(a) + EE(b) + TOK` (d5 P2 — the biweekly pair *inside*
a golden slot). Advisory is trivially golden in both boards.

**The discriminating signal is position, not count.** English A+B and TOK unions are the only
student-disjoint exhaustive families, so the engine forms those golden cells incidentally
(13 vs 15 — near parity). What the engine gets wrong is *placement*: its golden cells sit at the
day tail (mean period 7.5/8.0) where the expert centres them mid-day (4.6/5.75). The structural
logic makes this more than taste: a full-coverage slot placed mid-span can never create a
student window (it sits inside every student's day), while partial-coverage courses at the
edges truncate day-spans instead of punching holes. The unimodal "peak" shape is a
window-prevention mechanism, not an aesthetic.

**Classification (extends the rule table):**

| # | Rule / fact | Class | Encoding destination |
|---|---|---|---|
| R19 | Golden/near-golden slots must be assembled where possible (English A+B; TOK if teachers distinct; composites opportunistically) | **Construction target** | cover-set detection (student-disjoint courses whose roster union ≈ cohort) seeded as anchors — the coverage dual of the backbone conflict-clique |
| R20 | Golden slots belong mid-day (~lunch); coverage peaks mid-day, small courses at the shoulders | **Soft position term / bias** | coverage-weighted cell ordering (extend `interiorFirstCellOrder`, which is centre-out but enrolment-blind today); candidate analyzer metric: mean period of top-coverage slots |
| R21 | Slot-coverage census (golden count, near-golden count, coverage-by-period profile) | **Analyzer metric (new)** | extend `slot-census.ts` — note this *refines* the earlier negative result: median density is not an objective, but the coverage *peak and its position* are |

**New open questions:** the "almost" threshold for near-golden (she said "prawie wszyscy" —
cohort−1? 90%?); whether golden-slot count should ever be *maximized* or only the naturally
available ones placed well (her wording — "if you manage to find one" — suggests the latter);
where the lunch break actually falls in the 10-period grid (needed to define "mid-day"
precisely). All three are one-liners for the live session.

#### G-answers (2026-07-13, same day) — the follow-up questions came back

The expert answered the four G-questions (verbatim in `expert-questions.pl.md` §Dopytki):

- **G1 — near-golden threshold: "1–2 students, max 10%."** Concrete: a slot is near-golden when
  missing ≤ 10% of the cohort (dp1: ≥25/27; dp2: ≥31/34). The analyzer census threshold is now
  defined by the expert, not guessed.
- **G2 — "actively build. Though everything depends on student choices anyway. Actively
  *find*."** The self-correction from "build" to "find" is the design: golden slots are a
  property of the enrollment structure (cover sets either exist in a given year or they don't);
  the generator's job is to *detect* them from `studentKeys` and place them — not to contort the
  plan to manufacture them. This confirms the cover-set-detection construction anchor over an
  objective push. ⚠️ The price sub-question (would a golden slot justify an extra occupied slot
  / a worse teacher day) went unanswered — encode conservatively: golden-slot placement must not
  cost anything the confirmed tiers above it care about, until she says otherwise.
- **G3 — mid-day band = P4–P7.** "Around the lunch break" is now a concrete period band (no
  fixed lunch period was named — the band is the answer). Her own board keeps 10 of 15 golden
  cells inside P4–P7 (outliers at P2/P3 and the d2 P9–P10 composite), so this is a soft position
  preference, not a hard rule — consistent with everything else shape-related.
- **G4 — publishes A (3 soft hits) over B (+50 teacher windows).** Combined with 5.2 (3 soft
  hits cheaper than a slot) and 5.3 (50 windows cheaper than a slot), this fixes the last
  ordering gap: **`teacherHoles` sits above `softHits`**, both below `totalSlots`. The usual
  lexicographic caveat applies (the forced choice was at 3-vs-50 magnitudes; a tuple makes the
  ordering absolute), but her boards live near zero on both, so the regime the tuple must get
  right is exactly the probed one. `softHits` vs `studentHoles` remains inferred-only
  (soft-above-student, from her 0-soft-hits vs ~600-student-gaps revealed practice) — the one
  soft-ordering claim without a direct forced-choice behind it.

**Elicitation is now complete** except the live 9.2 walkthrough. Every parameter needed for the
tuning plan has an expert-sourced value: two new hard rules, the full soft-tier order, the
fixture list, the golden-slot definition (threshold + band), the doubles exception list, and the
acceptance bar (~40 h of manual work to beat).
