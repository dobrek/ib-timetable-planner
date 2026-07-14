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
   there. `soft` is a preference the engine now counts and avoids (the tuning target is zero soft
   hits, and the expert's own board takes none), but it will take one rather than lose a slot.

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

Hit **Generate** and give it its budget (20 s). What comes back:

- **Complete, or nearly.** Expect a small residue — a handful of hours the search could not seat
  under the hard rules. That is by design: the expert's own rule (R17) is that _an unplaced hour beats
  a rule violation_, so the engine leaves the hour out rather than split a course across a day or run
  a teacher nine hours deep. The residue is your hand-finishing list, and it is small (recent runs on
  the real catalog: 5–8 hours).
- **Zero same-day splits, teacher days within span 8 / streak 6, day starts at P1.** These are
  enforced, not hoped for.
- **Golden slots mid-day.** The cells where the whole cohort is in class land in the P4–P7 band,
  where they cost nobody a window — not at the day's tail, where they buy nothing.

What it will _not_ do as well as you: pack a teacher's day. Teacher gap-slots run ~3× the expert's on
the same catalog. Treat the generated board as a strong first draft whose teacher days are the first
thing worth your eye.

---

## d) Hand-finish

1. **Place the residue.** The unplaced hours are listed per course. Dropping them onto the board goes
   through the same validation as any drag, so the rules still hold.
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
- **Teacher compactness is the engine's weakest tier.** It is modeled (`teacherHoles`, above soft
  availability and above student gaps) and it has its own search operator, but the search spends its
  budget on completeness and slots first — both of which the expert ranks above it, so the ordering is
  right even where the result is not yet good enough.
- **Doubles are a preference, not a target.** The engine pairs a course's hours where the cell allows,
  but it does not pull a course's days together, so a 4-hour course still spreads more than the
  expert's would.
