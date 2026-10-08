# Plan generation runbook

How to get a usable timetable out of the generator: **pin the skeleton first, then generate, then
hand-finish the residue.** The engine is a strong assistant, not an oracle — it will not produce a
board you can publish untouched, and it is not meant to. The bar it has to clear is the ~40 hours the
manual plan costs today; anything that lands well under that is a win (R18).

The order matters. Generation from an empty board is the one workflow that reliably wastes your time:
the fixtures are decisions the school has already made, and a generator that does not know them will
happily place a lesson where Advisory has to go, then build the rest of the week around its mistake.

---

## a) Before you generate: the data checklist

Two fields decide whether the engine's output is even meaningful. Both live in the catalog you are
generating against — neither is a generation setting.

1. **`finishes_early` is set on every course that stops before the exam session.** In the current
   catalog that is DP2's TOK, CAS and EE (and SSSTS by the same logic). A flagged course is held to
   the day-edge rule: it may never be _boxed_ between two lessons of a student who takes it, because
   after it ends that student's day would begin or end with a hole for the rest of the year. Miss the
   flag and the engine will bury the course mid-day; set it on a course that does _not_ end early and
   you will hand it a constraint nobody asked for.
2. **Teacher availability rows are current.** `strong` is a hard "no" — the engine will not place
   there. `soft` is a "would rather not": under the default **clean** policy Generate adds no new
   lesson on a soft cell beyond the ones you pinned there yourself, and drops that rule for the run
   only if no complete timetable exists without it. The other two policies weigh it as a preference,
   after completeness, holes and compactness.

Both are worth a look before every planning season, because both drift silently: a course changes its
end date, a teacher changes their Tuesday.

---

## b) Pin the fixture skeleton

Clone the catalog (or start from the season's fresh import), open the board, and place these **by
hand** before you touch Generate. They are not preferences — they are the week's fixed points, and
three of them are set above the planner, not by them.

| What         | Where                               | Why it is a fixture                                                                                                                                                                                                          |
| ------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Advisory** | Wed P7, **both cohorts**            | School leadership fixes it, not the planner. Whole school, synchronized — every teacher is free that hour by construction. Moving it: "never."                                                                               |
| **CAS + EE** | Wed P8 and Fri P7, **paired**       | The two share a cell on opposite week lanes (CAS week A, EE week B, or the reverse — the pairing is fixed, which of the two leads is not). Both end mid-year, so both sit at the students' day edge.                         |
| **SSSTS**    | Wed P1–P2 (a _pattern_, not a cell) | One teacher, alternating cohorts week A / week B. What is fixed is the shape: their availability is heavily restricted, and the course must sit at the student-day edge. The exact cell can move if their availability does. |

**Polish A on Monday P1–P2 is _not_ a fixture** — it is the mirrored-cell detector picking up a
coincidence, and the expert confirmed it as one. Do not pin it. If you do, you are handing the engine
a constraint the school never imposed.

A pinned row is immovable for the whole solve: the engine plans _around_ it, and every rule (day
split, teacher span, day edge) is enforced against pins and generated rows alike.

---

## c) Generate

Hit **Generate**, pick a solve policy (**clean** is the default; the dialog says what each one does),
and confirm. What happens next:

- **It runs in the background, on the server.** A typical run takes 22–28 minutes and the ceiling is
  "up to about 38 minutes" — the board under it shows "Generating — stage N of 10" as it works
  through the priorities in order. You can leave the page; the run carries on.
- **It lands as a new proposal plan.** The plan you generated from is never written to. The proposal
  is a copy of it with the generated lessons added around your pins.
- **Stop & keep** ends the run early and keeps the board from the last stage that finished. Stopped
  before the first stage finished, it keeps nothing.

What comes back:

- **A complete board.** Every course's hours are placed — the first stage proves a complete board
  exists before anything else is tuned. If the pins and the hard rules leave no complete timetable,
  the run fails and says so, rather than leaving hours out or breaking a rule (R17: _an unplaced hour
  beats a rule violation_ — so no board at all beats a broken one).
- **No double-booking, no same-day splits, at most two hours of a course a day, teacher days within
  span 8 / streak 6, early-finishing courses at the day's edge.** These are enforced, not hoped for.
  A late start or a long Friday is a preference the later stages work on, not a rule.
- **Golden slots mid-day.** The cells where the whole cohort is in class land in the P4–P7 band,
  where they cost nobody a window — not at the day's tail, where they buy nothing.

What the stages after the first do with their time (measured on production, S-308): cohort holes
and soft hits reached a proven zero in every run, while the total slot count and the teacher,
student, Friday and golden-band tiers stop on their time budget rather than on a proof — so a run
returns a very good board, not a proven-best one. The slot count in particular depends more on the
search's luck than on time — **two Generates, keeping the better proposal, are
likelier to find a free slot than one long one.** Treat the proposal as a strong first draft whose
teacher days are the first thing worth your eye.

---

## d) Hand-finish

1. **Open the proposal.** Hand edits on it go through the same validation as any drag, so the rules
   still hold. If you changed your mind about a pin, change it on the source plan and generate again.
2. **Sweep the teacher days.** Look for a teacher with a window between two lessons and see whether a
   swap closes it. This is where the manual work still pays.
3. **Check the week's shape** — the expert's own first three checks on any plan: does Friday end
   early, is Advisory in its fixed place, is any subject's block split across a day.

---

## Known gaps

- **The Advisory convention is not a rule.** "Every teacher is free during Advisory" is true of the
  data, not enforced by the engine: a _manual_ edit that puts a lesson in the Advisory hour will only
  warn (as a stacking warning would), not block. Pinning Advisory first makes this moot for
  generation, which is why the workflow above starts there.
- **Teacher compactness is where the time goes.** It is modeled (`teacherHoles`, above soft
  availability and above student gaps) and it keeps improving with more time per stage — production
  runs went 115 → 102 → 86 → 70 gap-slots (median) as the per-stage budget grew 60 → 120 → 240 →
  480 s (S-308) — but it ranks below completeness and slots, which the expert ranks above it, so the
  shipped budget stops at 240 s where the slot count stops improving.
- **Doubles are a preference, not a target.** They rank seventh, below every people tier, and the
  delivered boards in the S-308 runs ranged from fully paired to over two hundred avoidable singles.
  Expect to pair some courses by hand.
