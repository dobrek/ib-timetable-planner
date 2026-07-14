import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { expandLanes, laneStats, lanesOf } from "../analysis/lanes";
import { buildAvailabilityIndex } from "../availability-index";
import { cellKey } from "../collision/cell-key";
import { GOLDEN_BAND } from "./golden-sets";
import { countOccupiedSlots } from "./occupied-slots";
import type { CourseDeficit, GeneratedPlacement, GeneratorSnapshot } from "./types";

/**
 * The engine-agnostic definition of board quality: the lexicographic objective, its comparator, and
 * the candidate-scoring function every engine (and the benchmark) must agree on. Lives outside any
 * engine so a second engine and the bench score against the *same* tiers rather than a private copy.
 * Depends only on the snapshot + a placement set + the per-course remaining hours — no engine state.
 *
 * The tier ORDER is the expert's, elicited by forced choice, not a guess (research.md §5.x):
 * completeness first, then interior holes, then the slot count (confirmed dominant over everything
 * below it), then the people tiers — teachers above soft-availability hits (G4), both above
 * students (5.4: "I'd take the student windows", and 5.6: teacher comfort is labour-law backed).
 */

const COHORT_ORDER: Cohort[] = ["dp1", "dp2"];

/** The lexicographic objective tuple, compared tier-by-tier (smaller is better on every tier):
 *  `[unplacedTotal, holes, totalSlots, teacherHoles, softHits, studentHoles, doublesDeficit,
 *  lateStarts, fridayTail, goldenBandDistance]`. */
export type Objective = [
  unplacedTotal: number,
  holes: number,
  totalSlots: number,
  teacherHoles: number,
  softHits: number,
  studentHoles: number,
  doublesDeficit: number,
  lateStarts: number,
  fridayTail: number,
  goldenBandDistance: number,
];

/** A scored board: its placements, objective tuple, per-cohort slots/unplaced, and the per-course
 *  hours still unplaced — with `placements`, the full state an LNS round rehydrates.
 *
 *  `objective` is only meaningful up to the tier count it was scored with (see `scoreCandidate`'s
 *  `tiers`): a candidate scored for a search round carries zeros below the prefix, so comparing it
 *  against a fully-scored one on those tiers would read a board with no shape cost at all. Compare
 *  candidates at the tier count they were scored with, or re-score. */
export type Candidate = {
  placements: GeneratedPlacement[];
  objective: Objective;
  slots: Record<Cohort, number>;
  unplaced: Record<Cohort, CourseDeficit[]>;
  remaining: Map<string, number>;
};

/**
 * The tiers a *search* may steer by. The three shape tiers below them (doubles, late starts, Friday
 * tail) are polish: a search that chases them is measurably worse at the tiers the expert ranks
 * above them, because their improving moves are cheap and plentiful — a board almost always has one
 * more single to pair or one more hour to pull off Friday. Steering by them moves the incumbent
 * nearly every round, and the rare completeness/slot move never gets the repeated attempts from a
 * stable board that finding it takes. Measured on the seed catalog: searching all nine tiers dropped
 * dp1 from complete-at-50-slots to 48 slots with an hour unplaced, and dp2 from 46 slots to 47 —
 * both of which the tuple itself ranks strictly worse than the board it gave up.
 *
 * So the engine searches on the prefix and polishes on the tail (`search.ts`, phase C). The full
 * tuple stays the definition of quality — every polish move is filtered by it, so a polished board is
 * never worse on any tier — but only these six *drive* the walk.
 */
export const SEARCH_TIERS = 6;

/**
 * Lexicographic comparison of two objective tuples — the priority tiers hold at ANY magnitude
 * (the weighted scalar it replaces let a studentHoles term in the hundreds outvote a whole slot).
 * Negative ⇒ `a` is the better board (smaller-is-better on every tier); shared by cross-attempt
 * selection and the LNS acceptance test so the two never disagree.
 *
 * `tiers` truncates the comparison to the first N tiers — the caller's declaration that the tiers
 * below N must not steer this decision (see {@link SEARCH_TIERS}). It never *reorders* anything: a
 * prefix comparison and the full one always agree whenever the prefix differs.
 */
export const compareObjectives = (a: Objective, b: Objective, tiers: number = a.length): number => {
  for (let tier = 0; tier < Math.min(tiers, a.length); tier++) {
    if (a[tier] !== b[tier]) return a[tier] - b[tier];
  }
  return 0;
};

/**
 * Score a placement set against the snapshot into a `Candidate`. Reads only the snapshot (catalog,
 * pins, days) plus the caller's `remaining` map — no engine internals — so any engine can call it.
 *
 * This is the LNS hot loop (twice per round). Everything derived from the *snapshot alone* — the
 * teacher map, the soft-availability index, each cohort's student rosters — is memoized per snapshot
 * rather than rebuilt per call; only the row fold is per-candidate work. Rebuilding them per call
 * cost enough LNS rounds to lose a whole occupied slot on the real dp2 catalog (bench, 2026-07-14),
 * and a slot outranks every tier these structures feed.
 */
export const scoreCandidate = (
  snapshot: GeneratorSnapshot,
  generated: GeneratedPlacement[],
  remaining: Map<string, number>,
  tiers: number = Number.POSITIVE_INFINITY,
): Candidate => {
  const { teacherKeysOf, studentsOf, softCells, rosterOf } = derivationsOf(snapshot);
  // The tiers below the search prefix are computed only when the caller will actually compare them
  // (`SEARCH_TIERS`): they cost real time in the LNS hot loop — golden coverage unions a roster per
  // cell — and a round that cannot be steered by them has no use for the number.
  const polish = tiers > SEARCH_TIERS;
  const slots = {} as Record<Cohort, number>;
  const unplaced = {} as Record<Cohort, CourseDeficit[]>;
  let holes = 0;
  let studentHoles = 0;
  let lateStarts = 0;
  let fridayTail = 0;
  let goldenBandDistance = 0;
  /** Every row of BOTH cohorts (pins + generated) — the teacher tiers span cohorts, because a
   *  teacher's working day does (16 of the 17 teach in both). */
  const boardRows: BoardRow[] = [];

  for (const cohort of COHORT_ORDER) {
    const rows = [...snapshot.cohorts[cohort].pins, ...generated.filter((x) => x.cohort === cohort)];
    slots[cohort] = countOccupiedSlots(rows);
    unplaced[cohort] = snapshot.cohorts[cohort].courses
      .filter((c) => (remaining.get(c.id) ?? 0) > 0)
      .map((c) => ({ courseId: c.id, missing: remaining.get(c.id) ?? 0 }));
    holes += countInteriorHoles(rows, snapshot.days);
    studentHoles += laneHoles(rows, (row) => studentsOf.get(row.courseId) ?? []);
    if (polish) {
      lateStarts += countLateStarts(rows);
      fridayTail += countFridayTail(rows, snapshot.days);
      goldenBandDistance += countGoldenBandDistance(studentsOf, rosterOf[cohort], rows);
    }
    boardRows.push(...rows);
  }

  const unplacedTotal = COHORT_ORDER.reduce(
    (sum, cohort) => sum + unplaced[cohort].reduce((s, d) => s + d.missing, 0),
    0,
  );
  const totalSlots = COHORT_ORDER.reduce((sum, cohort) => sum + slots[cohort], 0);
  const objective: Objective = [
    unplacedTotal,
    holes,
    totalSlots,
    laneHoles(boardRows, (row) => teacherKeysOf.get(row.courseId) ?? []),
    softHitsOf(teacherKeysOf, boardRows, softCells),
    studentHoles,
    polish ? countDoublesDeficit(boardRows) : 0,
    lateStarts,
    fridayTail,
    goldenBandDistance,
  ];
  return { placements: generated, objective, slots, unplaced, remaining: new Map(remaining) };
};

/** Snapshot-derived scoring structures, memoized per snapshot (the LNS loop rescores the SAME
 *  snapshot thousands of times; a snapshot is immutable plain data, so this is a pure cache). */
type Derivations = {
  teacherKeysOf: Map<string, string[]>;
  studentsOf: Map<string, string[]>;
  softCells: Map<string, Set<string>>;
  /** Each cohort's whole roster size — the bar a cell's coverage must reach to be golden. */
  rosterOf: Record<Cohort, number>;
};

const derivationCache = new WeakMap<GeneratorSnapshot, Derivations>();

const derivationsOf = (snapshot: GeneratorSnapshot): Derivations => {
  const cached = derivationCache.get(snapshot);
  if (cached) return cached;
  const courses = COHORT_ORDER.flatMap((cohort) => snapshot.cohorts[cohort].courses);
  const rosterSize = (cohort: Cohort): number =>
    new Set(snapshot.cohorts[cohort].courses.flatMap((course) => course.studentKeys)).size;
  const derivations: Derivations = {
    teacherKeysOf: new Map(courses.map((course) => [course.id, course.teacherKeys])),
    studentsOf: new Map(courses.map((course) => [course.id, course.studentKeys])),
    softCells: buildAvailabilityIndex(snapshot.availability).softUnavailableByTeacher,
    rosterOf: { dp1: rosterSize("dp1"), dp2: rosterSize("dp2") },
  };
  derivationCache.set(snapshot, derivations);
  return derivations;
};

/** The row shape every counting function below folds over. */
type BoardRow = { courseId: string; day: number; period: number; week: PlacementWeek };

/** Interior free slots per day across `rows` (objective tier 2): for each day's used span, the
 *  count of periods strictly between the first and last used period that hold nothing. */
export const countInteriorHoles = (rows: { day: number; period: number }[], days: number): number => {
  let holes = 0;
  for (let d = 1; d <= days; d++) {
    const used = new Set(rows.filter((x) => x.day === d).map((x) => x.period));
    if (used.size === 0) continue;
    for (let p = Math.min(...used) + 1; p < Math.max(...used); p++) if (!used.has(p)) holes += 1;
  }
  return holes;
};

/**
 * Week-aware per-teacher day gaps (objective tier 4 — the expert's highest people term): (span −
 * occupied) summed over teacher-day-week lanes, across BOTH cohorts' rows. This is the term that
 * was entirely missing: the engine scored 345 teacher gap-slots to the expert's 74 on the same
 * catalog, and the mechanism is the cohort switch taken across an idle hour rather than back to back.
 * A `both`-week row expands to both concrete lanes (the `lanes.ts` convention).
 */
export const countTeacherHoles = (teacherKeysOf: Map<string, string[]>, rows: BoardRow[]): number =>
  laneHoles(rows, (row) => teacherKeysOf.get(row.courseId) ?? []);

/**
 * Placements landing on a teacher's soft-`no` cell (objective tier 5). Soft availability is a
 * "polite wish, often negotiated personally" — acceptable as a compensated last resort, so it is a
 * high SOFT tier, never a hard rule (the measurement's "inviolable" reading was over-strong). Until
 * now it was invisible to the search entirely: only `strong` rows reach the engine's feasibility
 * index, so the objective could not even see the 3 hits the expert never takes.
 *
 * One hit per (row, teacher) — week-agnostic, matching the teacher-lens census: a teacher's soft
 * preference is about the hour of the week, not about which fortnightly lane runs in it.
 */
export const countSoftHits = (
  teacherKeysOf: Map<string, string[]>,
  rows: BoardRow[],
  availability: GeneratorSnapshot["availability"],
): number => softHitsOf(teacherKeysOf, rows, buildAvailabilityIndex(availability).softUnavailableByTeacher);

/** Week-aware per-student day holes (objective tier 6): (span − occupied) summed over
 *  student-day-week lanes. A `both`-week row expands to both concrete lanes. */
export const countStudentHoles = (courses: GroupingCourse[], rows: BoardRow[]): number => {
  const studentsOf = new Map(courses.map((c) => [c.id, c.studentKeys]));
  return laneHoles(rows, (row) => studentsOf.get(row.courseId) ?? []);
};

/**
 * Avoidable singles (objective tier 7). The expert seeks doubles *deliberately* — "because that's
 * what the teachers prefer" (1.3) — and her board carries 226 same-course adjacent pairs to the
 * engine's 26. A "single" is a day-lane holding exactly one hour of the course; per (course, week
 * lane), one single is unavoidable when the lane's hours are odd, so the deficit is
 * `singles − (hours mod 2)`, clamped at 0.
 *
 * That formula is why the expert's no-doubles exceptions need no flags: a 1-hour biweekly CAS/EE
 * lane has one hour, one single, and `1 mod 2 = 1` — its deficit is 0, so the tier never pushes a
 * course that *cannot* pair. The odd TOK hour is free for the same reason, and a language course
 * the school does split into singles simply pays a cost the higher tiers can outbid.
 */
export const countDoublesDeficit = (rows: BoardRow[]): number => {
  const byCourseWeek = new Map<string, { hours: number; singles: number }>();
  for (const lane of expandLanes(rows, (row) => [row.courseId])) {
    const key = `${lane.entityKey}|${lane.weekLane}`;
    const tally = byCourseWeek.get(key) ?? { hours: 0, singles: 0 };
    byCourseWeek.set(key, {
      hours: tally.hours + lane.periods.length,
      singles: tally.singles + (lane.periods.length === 1 ? 1 : 0),
    });
  }
  return [...byCourseWeek.values()].reduce(
    (total, { hours, singles }) => total + Math.max(0, singles - (hours % 2)),
    0,
  );
};

/**
 * Free periods before a cohort's first lesson of the day (objective tier 8), summed over
 * `(day, week-lane)`. The expert starts every day at P1 — her board scores 0, the engine's 3 — and
 * the reason is that students prefer finishing earlier over starting later (3.1): a late start
 * spends the day's free capacity at the wrong end. A strong soft preference, not a hard rule.
 */
export const countLateStarts = (rows: BoardRow[]): number =>
  cohortLanes(rows).reduce((total, lane) => total + (laneStats(lane.periods).first - 1), 0);

/**
 * How late the last day of the week runs (objective tier 9), summed over its `(week-lane)`s. Short
 * Friday is explicit school policy, born of complaints (Friday-till-17:00, commuting students):
 * free space belongs "at the end of the day, and as much as possible on Friday" (3.2/3.3), and
 * moving that free tail to Monday morning is "worse — everyone wants to start the weekend earlier"
 * (9.3d). Minimizing the last occupied period pulls the week's spare capacity onto Friday's end;
 * the moves are slot-neutral, so tier 3 never resists them.
 */
export const countFridayTail = (rows: BoardRow[], days: number): number =>
  cohortLanes(rows.filter((row) => row.day === days)).reduce((total, lane) => total + laneStats(lane.periods).last, 0);

/**
 * How far the cohort's golden cells sit from the mid-day band (objective tier 10, the last one). A
 * golden cell is one whose parallel occupants cover the WHOLE roster in that week lane — nobody has a
 * window in it. The expert assembles ~15 of them and plants them mid-day (mean period 4.6/5.75); the
 * pre-tuning engine assembled 13 by accident and left them at the day tail (7.5/8.0), where covering
 * the cohort buys nothing, because the hour is the last one regardless.
 *
 * **Count-neutral, by construction**: the tier sums the band distance of the golden cells that exist
 * and never rewards making more of them. That is G2 — golden slots are *found* in the enrolment, not
 * manufactured — and it is also what keeps the tier free: assembling a cell to score here would cost
 * a slot, and a slot outranks it six tiers up. It only ever moves an existing cell inward.
 */
export const countGoldenBandDistance = (
  studentsOf: Map<string, string[]>,
  roster: number,
  rows: BoardRow[],
): number => {
  if (roster === 0) return 0;
  const coverage = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const weekLane of lanesOf(row.week)) {
      const key = `${row.day}|${row.period}|${weekLane}`;
      const students = coverage.get(key) ?? new Set<string>();
      for (const student of studentsOf.get(row.courseId) ?? []) students.add(student);
      coverage.set(key, students);
    }
  }
  let distance = 0;
  for (const [key, students] of coverage) {
    if (students.size < roster) continue; // not a golden cell — the tier has no opinion on it
    distance += bandDistance(Number(key.split("|")[1]));
  }
  return distance;
};

/** Periods between the cell and the mid-day band — 0 anywhere inside it. */
const bandDistance = (period: number): number => Math.max(0, GOLDEN_BAND.first - period, period - GOLDEN_BAND.last);

/** The cohort's own `(day, week-lane)` lanes: one constant entity key, so `expandLanes` groups by
 *  day and week alone (the caller already scopes `rows` to one cohort). */
const cohortLanes = (rows: BoardRow[]) => expandLanes(rows, () => COHORT_LANE_KEY);

const COHORT_LANE_KEY = ["cohort"] as const;

/** The shared fold behind every gap tier: expand rows into `(entity, day, week-lane)` lanes and sum
 *  each lane's `span − occupied`. One convention (`lanes.ts`), so teachers and students can never
 *  drift apart on what a "week" is. */
const laneHoles = (rows: BoardRow[], keyFn: (row: BoardRow) => readonly string[]): number =>
  expandLanes(rows, keyFn).reduce((total, lane) => total + laneStats(lane.periods).holes, 0);

const softHitsOf = (
  teacherKeysOf: Map<string, string[]>,
  rows: BoardRow[],
  softCells: Map<string, Set<string>>,
): number => {
  if (softCells.size === 0) return 0;
  let hits = 0;
  for (const row of rows) {
    const key = cellKey(row.day, row.period);
    for (const teacherKey of teacherKeysOf.get(row.courseId) ?? []) {
      if (softCells.get(teacherKey)?.has(key)) hits += 1;
    }
  }
  return hits;
};
