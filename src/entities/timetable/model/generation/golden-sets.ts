import type { GroupingCourse } from "@/shared/lib/catalog-hash";

/**
 * Golden slots (R19–R21): the cells whose parallel occupants together cover the WHOLE cohort — every
 * student sits in a lesson, so nobody has a window there. The expert assembles them deliberately
 * (English A beside English B; TOK; a composite of three courses) and plants them **mid-day**; the
 * pre-tuning engine produced nearly as many by accident and parked them at the day tail, where a
 * full-cohort cell buys nothing. Position, not count, was the differentiator: 15 golden cells at a
 * mean period of 4.6/5.75 (expert) against 13 at 7.5/8.0 (engine).
 *
 * The detection here is the "found, never manufactured" half of G2: a cover set is a property of the
 * *enrolment*, discovered from the catalog. Nothing in the engine forces a course into a set, and the
 * anchor stage that seats them is best-effort — a set that will not fit the band is simply dropped.
 */

/** The mid-day band a golden slot belongs in (G3, verbatim: "P4–P7"). */
export const GOLDEN_BAND = { first: 4, last: 7 };

/**
 * G1, verbatim: "1–2 students, max 10%" — the elicited tolerance, and the single source for all three
 * things built on it (the detector's bar, the `goldenBandDistance` tier's, and the analyzer's
 * near-golden census). A cell missing one or two students still leaves the day whole for everyone
 * else. Kept as the *miss* share because that is how the expert phrased it — and because `1 - 0.1` is
 * exactly `0.9` in IEEE-754 while `1 - 0.9` is not, so deriving in this direction cannot drift.
 */
export const GOLDEN_MISS_SHARE = 0.1;

/** The share of the cohort's roster a cover set — or a golden cell — must reach. */
export const GOLDEN_COVERAGE = 1 - GOLDEN_MISS_SHARE;

/**
 * The cohort's golden cover sets — course-id sets that can share ONE cell (pairwise student-disjoint
 * and teacher-disjoint, or they could never run in parallel) and together reach {@link
 * GOLDEN_COVERAGE} of the roster. Best coverage first; empty when the enrolment admits none.
 *
 * Greedy, seeded from every course in turn and grown by whichever candidate adds the most uncovered
 * students: the exact problem is set-cover-hard, but the instance is tiny (≈40 courses) and the
 * answer is a *hint* to construction, not a constraint — an imperfect set costs nothing, since the
 * anchor drops any set that will not seat.
 *
 * Callers pass the cohort's WHOLE catalog plus its flagged ids. The roster — the bar coverage is
 * measured against — is every student in the cohort, so it agrees with the `goldenBandDistance` tier
 * that later judges the cells; handing this function a pre-filtered slice would quietly lower the bar
 * under the tier. Flagged (finishes-early) courses are dropped from the *candidates* only: they live
 * under the day-edge rule and can never anchor a mid-day band, but their students still count.
 */
export const deriveGoldenSets = (courses: GroupingCourse[], flagged: ReadonlySet<string>): Set<string>[] => {
  const roster = new Set(courses.flatMap((course) => course.studentKeys));
  if (roster.size === 0) return [];
  const target = roster.size * GOLDEN_COVERAGE;
  // Biweekly courses run in one week lane only, so a set built on one could cover the cohort in week
  // A and leave half of it idle in week B — a golden cell must be golden in both lanes.
  const candidates = courses.filter(
    (course) => !flagged.has(course.id) && course.hours > 0 && course.weekMode !== "biweekly",
  );

  const sets = candidates
    .map((seed) => growFrom(seed, candidates))
    .filter((set) => set.covered.size >= target)
    .sort((a, b) => b.covered.size - a.covered.size);

  return dedupe(sets).map((set) => new Set(set.courseIds));
};

type CoverSet = { courseIds: string[]; covered: Set<string> };

/** Grow one cover set from a seed: repeatedly take the compatible course adding the most uncovered
 *  students, until nothing can be added. Ties break on the larger roster, then on course id, so the
 *  result is deterministic — the engine's diversification comes from its own PRNG, not from here. */
const growFrom = (seed: GroupingCourse, candidates: GroupingCourse[]): CoverSet => {
  const chosen = [seed];
  const covered = new Set(seed.studentKeys);
  for (;;) {
    const next = candidates
      .filter((course) => chosen.every((taken) => taken.id !== course.id && canShareCell(taken, course)))
      .map((course) => ({ course, gain: course.studentKeys.filter((student) => !covered.has(student)).length }))
      .filter(({ gain }) => gain > 0)
      .sort(
        (a, b) =>
          b.gain - a.gain ||
          b.course.studentKeys.length - a.course.studentKeys.length ||
          a.course.id.localeCompare(b.course.id),
      )
      .at(0);
    if (!next) break;
    chosen.push(next.course);
    for (const student of next.course.studentKeys) covered.add(student);
  }
  return { courseIds: chosen.map((course) => course.id), covered };
};

/** Two courses can occupy one cell only if they share no student and no teacher — the same predicate
 *  the collision core enforces, restated here because a cover set is a *pre*-placement claim. */
const canShareCell = (a: GroupingCourse, b: GroupingCourse): boolean =>
  !a.studentKeys.some((student) => b.studentKeys.includes(student)) &&
  !a.teacherKeys.some((teacher) => b.teacherKeys.includes(teacher));

/** One entry per distinct course set — every seed in a set tends to grow the same set back. */
const dedupe = (sets: CoverSet[]): CoverSet[] => [
  ...new Map(sets.map((set) => [[...set.courseIds].sort().join(","), set])).values(),
];
