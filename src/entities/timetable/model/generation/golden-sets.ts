/**
 * Golden slots (R19–R21): the cells whose parallel occupants together cover the WHOLE cohort — every
 * student sits in a lesson, so nobody has a window there. The expert assembles them deliberately
 * (English A beside English B; TOK; a composite of three courses) and plants them **mid-day**; at the
 * day tail a full-cohort cell buys nothing. Position, not count, was the differentiator: 15 golden
 * cells at a mean period of 4.6/5.75 (expert) against 13 at 7.5/8.0 (the pre-tuning engine).
 *
 * These constants are the one definition of "golden" that both readers share: the
 * `goldenBandDistance` tier (`objective.ts`, mirrored by the solver's `objective.py`) and the
 * analyzer's census (`analysis/slot-census.ts`). G2 holds throughout: golden slots are *found* in the
 * enrolment, never manufactured, so the tier only ever moves an existing cell inward.
 */

/** The mid-day band a golden slot belongs in (G3, verbatim: "P4–P7"). */
export const GOLDEN_BAND = { first: 4, last: 7 };

/**
 * G1, verbatim: "1–2 students, max 10%" — the elicited tolerance, and the single source for both
 * things built on it (the `goldenBandDistance` tier's bar and the analyzer's near-golden census). A
 * cell missing one or two students still leaves the day whole for everyone else. Kept as the *miss*
 * share because that is how the expert phrased it — and because `1 - 0.1` is exactly `0.9` in
 * IEEE-754 while `1 - 0.9` is not, so deriving in this direction cannot drift.
 */
export const GOLDEN_MISS_SHARE = 0.1;

/** The share of the cohort's roster a golden cell must reach. */
export const GOLDEN_COVERAGE = 1 - GOLDEN_MISS_SHARE;
