---
title: "Questions for the timetable expert — 2026/2027 plan vs. generated plan"
date: 2026-07-13
audience: the school's timetable planner
purpose: Session handout / async questionnaire. Answers feed the generator's rulebook and priorities.
source: distilled from context/changes/generation-quality-tuning/research.md (internal)
translation: expert-questions.pl.md (wersja polska)
status: draft
---

# Questions for the timetable expert

## Why we're asking

We took the exact data behind your 2026/2027 timetable — same courses, same teachers, same
availability, same student choices — and had the generator build its own plan. Then we measured
both plans the same way. Two headline results:

1. **Your plan follows every rule the generator knows, perfectly.** So the generator's rulebook is
   not wrong — it is *incomplete*. It is allowed to build your plan; it just doesn't know why it
   should.
2. **The differences between the two plans are large and consistent** — and each consistent
   difference is probably a rule or preference that lives in your head and nowhere else.

The comparison in brief:

| What we measured | Your plan | Generated plan |
|---|---:|---:|
| Lesson hours left unplaced | 0 | 5 |
| Same subject split by a gap within one day | 0 times | 67 times |
| Same subject in consecutive periods (double-style) | 226 pairs | 26 pairs |
| Teachers' free periods between lessons ("windows") | 74 | 345 |
| Lessons placed on a "prefers not to" (soft-blocked) cell | 0 | 3 |
| Students' windows | 612 | 1,020 |
| Days that don't start at period 1 | 0 | 3 |

These questions turn those differences into explicit rules. There are no wrong answers — "that's
just a coincidence" and "I never thought about it" are as useful as "that's an iron rule."

**How to answer.** Many questions ask *"is X ever acceptable?"* Please answer on this scale:
- **Never** — an iron rule; a plan that breaks it should not be published.
- **Only in an emergency** — acceptable as a last resort; please describe the emergency.
- **It's fine** — a matter of taste, not a rule.

Where we ask **A or B**, assume everything else about the two plans is identical.

---

## 1. Same subject within a day — splits and doubles

Your plan never separates two lessons of the same subject with a gap on the same day (0 of 248
placements). The generated plan does it 67 times.

**1.1.** Tuesday: Chemistry at period 2 and again at period 5, other subjects in between. Is that
ever acceptable — even if fixing it would cost an extra occupied slot, or leave an hour unplaced?
(Never / emergency / fine)

> Answer:

**1.2.** Does the answer change if the two lessons are separated only by the lunch break?

> Answer:

**1.3.** Do you deliberately *aim* for double periods (two consecutive lessons), or do doubles
just happen because you avoid splits? Which subjects **require** a double period to be teachable
at all (labs? sciences? languages?) — and which should **never** have doubles?

> Answer:

**1.4.** Is a 2-hours-per-week course always placed as one double? When would you split it across
two days instead?

> Answer:

**1.5.** For scheduling purposes, is *Math AA* "the same subject" as *Math AI*? Is *English B HL*
the same as *English B SL*? In other words: when you say "don't split the same subject", does
"same subject" mean the exact class group, the subject+level, or the subject family?

> Answer:

---

## 2. Teacher availability — how absolute is "prefers not to"?

Teachers' availability is marked either **cannot teach** (hard) or **prefers not to** (soft). In
your plan, not a single lesson sits on a soft-blocked cell. The generated plan used 3.

**2.1.** Would you *ever* place a lesson on a "prefers not to" cell — to complete the timetable?
to avoid splitting a subject? to save a slot? (Never / emergency / fine — and if emergency, which
emergencies qualify?)

> Answer:

**2.2.** When you mark "prefers not to", what does it really mean in practice: a polite wish you
try to honour, or "actually can't, but negotiable if I call them"?

> Answer:

**2.3.** Is the availability data in the system complete and current? 7 of the 17 teachers have no
restrictions recorded — are they genuinely fully available?

> Answer:

**2.4.** Do any teachers have **positive** preferences you honour but never wrote down — "wants
mornings", "wants everything packed on 3 days", "never first period"?

> Answer:

---

## 3. The shape of a day and a week

In your plan every day, in both year groups, starts at period 1. The free capacity is banked at
the ends of days — and almost all of it at the end of **Friday** (both cohorts finish Friday at
period 8).

**3.1.** Must every day start at period 1 for the whole cohort, even a light day? (Never start
late / emergency / fine)

> Answer:

**3.2.** Is the short Friday deliberate policy ("bank all the free space at the week's end"), or
just how it worked out this year? If deliberate — why Friday?

> Answer:

**3.3.** Where is free space *allowed* to sit? Rank these: end of any day / end of the week /
middle of a day (a whole-cohort free period) / start of a day.

> Answer:

---

## 4. The fixed points of the week

Nine cells in your plan are identical in **both** year groups at the same time — they look like a
fixed school skeleton rather than choices made during planning:

| Day | Period | What |
|---|---|---|
| Monday | P1–P2 | Polish A SL (both groups simultaneously, two teachers in parallel) |
| Wednesday | P1–P2 | SSSTS (one teacher, alternating year groups week A/week B) |
| Wednesday | P7 | Advisory (whole school, synchronized) |
| Wednesday | P8 | CAS + EE (paired: one on week A, the other on week B) |
| Friday | P7 | CAS + EE (paired, as above) |

**4.1.** For each row: is it fixed at *exactly this day and period* next year too? Fixed only in
*pattern* (e.g. "Advisory must be synchronized, some afternoon period")? Or freely movable?

> Answer (per row):

**4.2.** Who decides these — you, or the school above you? Could they move if the timetable would
be much better without them?

> Answer:

**4.3.** Are there other fixed points we can't see this way — things you always place **first**,
before real planning starts, perhaps in only one year group?

> Answer:

**4.4.** CAS and EE share their cells throughout (one on week A, the other on week B). Is "these
two always pair up in the same slot" a rule? Are there other course pairs like this?

> Answer:

**4.5.** If the generator respected all these fixed points automatically (you place them first,
it fills in the rest), would that match how you actually work?

> Answer:

---

## 5. Choosing between imperfect plans

Real plans involve trade-offs. For each pair below, **which plan would you publish?** Everything
else about the two plans is identical.

**5.1.** Plan A uses one more occupied slot in the week. Plan B has one same-subject split.

> A / B:

**5.2.** Plan A uses one more occupied slot. Plan B has three lessons on "prefers not to" cells.

> A / B:

**5.3.** Plan A uses one more occupied slot. Plan B gives the teachers 50 extra windows in total
across the week.

> A / B:

**5.4.** Plan A gives teachers 10 extra windows. Plan B gives students 30 extra windows.

> A / B:

**5.5.** Plan A leaves one lesson hour unplaced (you'd fit it in by hand). Plan B places
everything but breaks one of the things above (a split / a soft-blocked cell / extra windows).
Which is worse?

> Answer:

**5.6.** When a teacher's day and a student's day pull in opposite directions, whose comfort wins?

> Answer:

**5.7.** In your plan the most window-burdened teacher has 12 windows across the week; in the
generated plan, 36. Is there a number of weekly windows per teacher you would never exceed?

> Answer:

**5.8.** Even your plan has student windows (a typical second-year student has about 12 across
the two-week cycle). What is an *acceptable* number of windows per student per week — at what
number do you start reworking a day?

> Answer:

---

## 6. Patterns we found in your plan — deliberate or accidental?

**6.1.** You rarely teach a subject's first-year and second-year editions on the *same* day
(37 shared days; the generator does 54). Deliberate? If so, why — spreading the teacher's
preparation, students' weekly rhythm, something else?

> Answer:

**6.2.** 16 of 17 teachers teach both year groups. In your plan, when a teacher switches year
groups within a day, the switch is usually back-to-back with no window (63% of switches), and
half of all teacher-days stay within a single year group. Do you consciously plan "whole days in
one year group" and "seamless switches"? Or does it just fall out of avoiding teacher windows?

> Answer:

**6.3.** Your plan concentrates each course's hours onto few days (41 courses on multiple days vs
the generator's 64). Do you deliberately put a course's hours on as few days as possible? Are
there courses that must meet *every* day, or need a minimum spread across the week?

> Answer:

**6.4.** The system enforces "max 2 lessons of one course per day". Is that the right cap for
every course, or are there exceptions in either direction?

> Answer:

---

## 7. Morning vs afternoon — label the subjects

In your plan, subjects clearly drift to times of day. Sorted by average period (1 = first lesson,
10 = last):

| Morning end | | | Afternoon end |
|---|---|---|---|
| SSSTS (1.5) | Math AI (4.8) | English B (5.5) | Geography (6.2) |
| ESS (2.5) | Math AA (4.8) | History (5.5) | Chemistry (6.3) |
| Polish A (3.5) | Biology (5.2) | Psychology (5.7) | CAS (6.4) |
| English A (4.5) | German B (5.2) | Computer Science (5.8) | EE (6.4) |
| Physics (4.5) | Spanish B (5.4) | BM (6.0) | TOK (6.4) |
| | | | Advisory (7.0) |

**7.1.** Please label each subject: **must be morning / prefer morning / no preference / prefer
afternoon / must be late**. (Mark directly in the table or list exceptions.)

> Answer:

**7.2.** Is this ordering about the subjects themselves (concentration-heavy in the morning,
self-directed work in the afternoon), or did teacher availability force it?

> Answer:

**7.3.** Are there subject pairs that should never be back-to-back for a student (e.g. two heavy
sciences in a row)?

> Answer:

---

## 8. How some courses are really taught

**8.1.** First-year **Chemistry**: in the system, Chemistry SL requires 4 h/week (but no student
chose SL alone) and Chemistry HL requires 2 h/week (9 students). Your plan gives the HL group
**6 hours** — three double periods. Please confirm how it actually works: do the 9 HL students
attend all 6 hours together (4 shared "SL-content" + 2 HL-only)? One teacher for all 6? *(This
matters: the generator currently can't see 4 of those hours at all.)*

> Answer:

**8.2.** Are there **other** courses where what's really taught differs from the hours recorded
per course in the system — combined groups, shared sessions, hours "borrowed" between levels?

> Answer:

---

## 9. Two plans side by side *(live session)*

With your plan and the generated plan open together:

**9.1.** Which is better — and what is the **first thing you looked at** to decide?

> Answer:

**9.2.** Walk through the generated plan and flag everything you would refuse to publish. For each
flag, we'll push to a countable rule ("no X anywhere", "at most N of Y per day").

> Notes:

**9.3.** Four "what if" edits to *your own* plan — one change each. Would you still publish it?
- (a) One subject split by a gap on one day. → 
- (b) One lesson moved onto a "prefers not to" cell. → 
- (c) Advisory moved from Wednesday P7 to another synchronized slot. → 
- (d) Friday's free tail (P9–P10) moved to Monday morning — Monday starts at P3 instead. → 

---

## 10. When would you actually use a generated plan?

**10.1.** Imagine the generator returns a plan with: all fixed points respected, everything
placed, zero splits, zero soft-blocked cells, and teacher windows within, say, twice your level.
Would you publish it after light edits? How many manual fixes make it not worth using?

> Answer:

**10.2.** Would this workflow suit you: *you place the fixed points → the generator fills the rest
→ you hand-repair the last details*? What would the tool have to show you for you to trust it?

> Answer:

**10.3.** Do timetables from previous years survive anywhere — old system, spreadsheet, paper?
Even one more year would let us check which of these patterns are permanent school rules and which
were this year's circumstances.

> Answer:

---

*Thank you! One closing catch-all: is there any rule you always enforce without thinking that
never came up above? If a plan can be "formally correct but you'd never ship it", what makes it
so?*

> Answer:
