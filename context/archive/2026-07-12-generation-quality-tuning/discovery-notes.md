---
title: Generation quality tuning — discovery notes
created: 2026-07-12
status: discovery
purpose: Seed for a future change. Capture why generated plans trail expert plans, how to discover the missing "quality" rules, where to encode them, and a concrete checklist to walk through with the human planner.
related:
  - context/archive/2026-07-12-generation-engine-refactor/ (the engine this builds on)
  - context/archive/2026-07-11-plan-generation/ (original engine)
  - context/archive/2026-07-12-generation-engine-hardening/
---

# Generation Quality Tuning — Discovery Notes

> These are pre-change notes, not a plan. When ready: `/10x-new generation-quality-tuning`
> → build the analyzer (§6) → gather expert rules (§7) → `/10x-shape` or `/10x-frame` → `/10x-plan`.

---

## 1. The core finding: "quality" is a hidden objective function

The engine is **GRASP + LNS** (greedy construction + large-neighborhood local search), not a one-shot
greedy. It is an *anytime* algorithm: it keeps the best board found and only accepts strictly-better
candidates, so more time is never worse — but on the real catalog it **converges in ~7 s and then
plateaus** (best board found ~6.7 s; extra budget produced no improvement across 60 s runs). So more
compute is NOT the lever.

The entire definition of "good" the algorithm knows is one tuple in
`src/entities/timetable/model/generation/objective.ts`:

```ts
Objective = [unplacedTotal, holes, totalSlots, studentHoles]   // compared lexicographically, lower = better
//            1) place all    2) no      3) fewest   4) compact
//               hours           interior    occupied     student
//                               gaps        slots        days
```

Two consequences:

1. **Slot count is already near-optimal.** The engine computes a provable max-weight-clique lower
   bound per cohort; the deferred CP-SAT spike estimated the *entire* remaining slot headroom at only
   **~1–2 dp1 slots**. So the prize is NOT in `totalSlots` — it is in the *softer* quality dimensions
   the tuple barely captures (or doesn't at all).
2. **The human's edge is a richer objective, not harder search.** A human doing manual planning runs
   the same destroy/repair loop the LNS does — try a change, keep it if better, repeat. They win
   because they optimize a *more complete* definition of "better." **Every consistent gap between the
   expert's plan and the algorithm's is evidence of a missing (or mis-ordered) term in that tuple.**
   Encode the term, and the machine's search-speed advantage does the rest.

The example the expert gave — *"put two of the same subject next to each other; don't leave a gap
between two of the same subject"* — is exactly such a missing term. The tuple has no notion of
subject adjacency, so the search will happily break it to gain nothing.

---

## 2. How to discover the missing rules — "observe good plans, extract patterns"

Three methods, cheap → heavy. Do them in order; stop when you have enough signal.

**(a) Elicitation (start here).** Sit with the planner. Enumerate every heuristic they use as an
explicit sentence, and classify each:
- **Inviolable** ("a science double must be consecutive") → a *hard rule*.
- **Preference, all else equal** ("prefer same subject adjacent") → a *soft objective term*.
- **A tie-breaker they reach for while placing** ("fill mornings first") → a *construction bias*.

**(b) Revealed-preference diff (the microscope).** Take a handful of expert "gold" plans and run the
generator on the *same* inputs. Measure the same **structured features** on both (see §6). Where the
expert *consistently* scores differently, you have found a latent objective term — **no ML needed,
just feature counting.** This converts "the human's is better" into "the human's has 12 same-subject
adjacencies vs the algorithm's 4, at the *same* slot count." Now you have a measurable target.

**(c) Inverse optimization (only if (b) is ambiguous).** With enough gold plans, fit the tier weights
so expert plans outrank perturbations (learning-to-rank / structured perceptron). Principled, but
overkill for one expert — name it as the endpoint, don't start there.

---

## 3. Where each discovered rule lives (the layer map)

| Kind of pattern | Encode it in | Precedent already in the codebase |
|---|---|---|
| **Inviolable constraint** | `verify.ts` (the oracle) + `board.fitsAt` (`board.ts`, feasibility during search) | flagged-edge rule, 2/day cap, cross-cohort teacher clash |
| **Soft preference** | a new tier in the `Objective` tuple (`objective.ts`) | `studentHoles`, interior `holes` |
| **"Look here first" bias** | construction stages (`stages.ts` / `problem.ts`) | backbone cliques, interior-first cell order, edge reservation |
| **A move the search must be able to *find*** | an LNS destroy/repair operator (`search.ts`) | the deferred "studentHoles-targeting move operator" |

**Rule of thumb for hard vs soft:** if a plan that violates it is *unshippable*, it's hard (goes in
`verify.ts`). If it's *worse but acceptable*, it's soft (goes in the objective tuple). When unsure,
default to **soft** — hard rules shrink the feasible space and can make instances unsolvable.

**Current hard rules already enforced** (so the expert can tell you what's NEW):
in-grid bounds · week-mode/week consistency · course must be in catalog · no duplicate rows in a cell ·
no same-student clash in a cell · no cross-cohort teacher clash · max 2 hours/day per course ·
strong teacher-unavailability = blocking (soft = warning) · `finishes_early` course must sit at a day
edge, never interior.

---

## 4. Encoding cookbook — the mechanics of adding a soft term

Adding a soft preference is a clean, mostly one-file change (this is the payoff of the recent refactor
that made `objective.ts` the single, engine-agnostic definition of quality):

1. **Write a counting function** in `objective.ts`, structurally like `countStudentHoles` — e.g.
   `countSubjectGaps(courses, rows)`: for each subject, per day, count gaps between its hours.
2. **Add it to the tuple** in `scoreCandidate` and the `Objective` type. `compareObjectives` needs
   **no change** — it already loops over the tuple length.
3. **Decide its priority position** (the crux — see §5).
4. **(Optional) add a targeted LNS operator** in `search.ts` so the search actively hunts the
   improvement instead of stumbling onto it (e.g. a "pull same-subject hours adjacent" repair,
   analogous to the existing `migrateHolesToEdges`).

Two nice properties:
- **Engine-agnostic:** the objective is shared, so a future CP-SAT engine optimizes the same terms
  for free.
- **A/B-able:** `createGreedyEngine({...})` is already tunable — a new term can go behind a flag so you
  can generate with/without it on real inputs and compare via the analyzer (§6).

---

## 5. The one caveat that will bite you: lexicographic ordering

The tuple is **strict priority**, not a weighted sum. Where you insert a new term decides everything:
- `subjectGaps` **below** `totalSlots` → "never spend a slot to fix a gap."
- `subjectGaps` **above** `totalSlots` → "a compact-subjects plan wins even if it costs a slot."

And the deeper possibility the expert's observation hints at: **their better plan may use *more* slots
than the algorithm's.** If the diff (§2b) shows that, then slot-minimization is *not* actually the top
priority and the current tuple's dominant tier is wrong — no amount of adding lower tiers will
reproduce the human's plan. **Only measurement tells you this.** It is the highest-value thing the diff
can reveal, so resist hand-tuning tier order before you have the numbers.

---

## 6. First step (recommended): a read-only plan-quality analyzer

Before touching the engine, build a pure, additive **feature extractor**: feed it any plan (human-made
or generated) and it prints a feature vector. Run it on expert plans vs the generator's output on the
same inputs.

Candidate features to measure (extend as the expert reveals more):
- **Slot count** per cohort (already have `countOccupiedSlots`).
- **Interior holes** per day (already have `countInteriorHoles`).
- **Student gaps** per student-day (already have `countStudentHoles`).
- **Same-subject adjacency** — count of consecutive same-subject pairs / double periods.
- **Subject fragmentation** — for each subject, how scattered its hours are across the day/week.
- **Subject-per-day spread** — is a subject clustered on few days or spread across many?
- **Time-of-day distribution** — morning vs afternoon load; first/last-period occupancy by subject.
- **Daily load balance** — variance in hours-per-day across the week.
- **Teacher gaps** — gaps in each teacher's day (if teacher identity is available in the snapshot).

Output: a side-by-side "expert vs generated" table. This turns intuition into a **ranked list of
objective terms to add**, each testable in a tight loop. It is *not* benchmarking (performance) — it's
plan-quality measurement, and it's the thing that makes the rest data-driven instead of guesswork.

---

## 7. Practice notes — questions to walk through with the expert

Group the conversation like this. For each item, capture: **(rule) → (hard or soft?) → (if soft,
does it beat slots? does it beat student gaps?)**. That last bit is the tier-ordering data.

### 7a. Meta questions (these reveal the *shape* of the objective — ask first)
- When two plans both satisfy the hard rules, **what is the first thing you look at** to decide which
  is better? (→ reveals the top soft tier)
- If you had to accept **one more gap OR one more occupied slot**, which would you take? (→ reveals
  whether compactness or slot-count is dominant)
- Show them a generated plan and a hand plan for the same input: **"why is this one better?"** Push
  until every reason is an explicit, countable feature.
- What's a plan that is **"technically valid but you'd never ship"**? (→ flushes out *hidden hard
  rules* the current oracle doesn't know)

### 7b. Adjacency & blocking
- Should two hours of the **same subject** be adjacent (double period)? Always, or only for some
  subjects (labs/practicals)? → likely *soft*, possibly *hard* for specific subject types.
- Are there subjects that should **never** be back-to-back (e.g. two heavy sciences in a row)? → soft
  penalty, or hard.
- Do some subjects **require** a double period to be usable at all? → hard.

### 7c. Gaps & compactness
- No gaps in a **student's** day — already modeled as `studentHoles`. Is it weighted correctly?
- No gaps in a **teacher's** day — currently *not* modeled. Add it? How important vs student gaps?
- Should a compact block be preferred even at the cost of a later start / earlier finish?

### 7d. Time-of-day & day shape
- Should **cognitively heavy** subjects go in the morning? Which subjects count as heavy?
- Should some subjects avoid **first or last period**?
- Should PE / arts / electives prefer the **afternoon**?
- Is an **even daily load** wanted (no overloaded day), or is front-loading the week fine?

### 7e. Subject distribution across the week
- Should a subject's hours be **spread across different days** rather than clustered? (⚠ this can
  *conflict* with the same-subject-adjacency rule in 7b — clarify the boundary: "adjacent within a
  day, but spread across the week"?)
- Is there a **max occurrences per day** per subject beyond the existing 2/day cap?
- Should certain subject **pairs** be balanced across the week (not both heavy on the same day)?

### 7f. Teacher-centric
- Minimize a teacher's **gaps** / **span** (first-to-last)?
- Limit a teacher's **consecutive teaching hours**?
- Keep a teacher's classes **grouped**?
- (Note: strong/soft teacher *unavailability* is already modeled — this is about *preferences*, not
  availability.)

### 7g. Student experience & fairness
- Balance difficult subjects across the week for a student?
- Any fairness rule across cohorts (dp1 vs dp2) — e.g. neither should get all the bad slots?
- Any preference for **week-to-week similarity** (biweekly courses already alternate A/B weeks)?

### 7h. Hidden hard rules ("valid but never ship")
- Anything the planner *always* enforces without thinking that the current oracle doesn't check?
- Room / resource constraints? (⚠ do we even have room data in the snapshot? probably not — see §9.)
- Any assessment / exam-spacing rules? (⚠ likely no data — scope out unless data exists.)

---

## 8. Known tensions & risks (raise these explicitly)

- **Adjacency vs spread (7b vs 7e).** "Same subject together" and "spread a subject across the week"
  pull opposite ways. The real rule is probably *"adjacent within a day, distributed across days"* —
  pin the exact boundary with the expert.
- **Hard rules cause infeasibility.** Every new hard rule shrinks the feasible space and can make some
  instances unsolvable; the flagged-edge rule is already the one delicate hard preference. Prefer soft.
- **Lexicographic brittleness.** Adding/reordering a tier changes what "optimal" means globally (§5).
- **Data availability.** Some heuristics (rooms, assessments, teacher preferences vs availability) may
  need snapshot fields that don't exist yet — scope those out or plan the data first.
- **Slot floor is near-optimal.** Don't chase `totalSlots`; the headroom is ~1–2 slots and needs an
  exact solver (CP-SAT), not more greedy tuning. The wins here are in the *soft* tiers.

---

## 9. Open modeling questions to resolve before coding

- **"Same subject" identity:** is it the `courseId`, or a subject/level attribute *above* the course?
  (Decides how the adjacency/fragmentation metrics group rows.)
- **Metric level:** student-level, cohort-level, or teacher-level? (`studentHoles` is student-level;
  new terms may need a different granularity.)
- **Week handling:** how do `both` / biweekly `a`/`b` rows interact with adjacency? (`countStudentHoles`
  already expands `both` into both lanes — mirror that.)
- **Snapshot completeness:** do we have the fields (rooms, teacher preferences, subject metadata) the
  candidate rules need, or is a data change a prerequisite?

---

## 10. Deferred items inherited from the archived refactor (relevant precedents)

From `context/archive/2026-07-12-generation-engine-refactor/` "What We're NOT Doing":
- **CP-SAT / second engine** — deferred pending real per-cohort manual counts; estimated prize ~1–2 dp1
  slots. The objective being engine-agnostic means new soft terms would carry over to it.
- **`studentHoles`-targeting move operator** — deferred; the direct precedent for §4 step 4.
- **Week-aware hole/slot metrics** — deferred; relevant if week-aware adjacency comes up (§9).

---

## 11. Suggested path to a change

1. `/10x-new generation-quality-tuning` (formalizes this folder with a `change.md`).
2. Build the **analyzer** (§6) — pure, additive, no engine change. Ship it or keep it as a dev tool.
3. Run the analyzer on expert gold plans vs generated output → ranked list of missing terms.
4. Walk the expert through §7 with the analyzer numbers in hand → confirmed rules + tier ordering.
5. `/10x-shape` or `/10x-frame` on the confirmed rule set → `/10x-plan` → implement one term at a time,
   A/B'd via `createGreedyEngine`, re-measured with the analyzer each step.
