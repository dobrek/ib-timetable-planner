import { describe, expect, it } from "vitest";
import type { Cohort } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { placement } from "../__fixtures__/builders";
import { generatePlanGreedy } from "./engines/greedy";
import type { GeneratedPlacement, GeneratorSnapshot } from "./types";
import { verifyGeneration } from "./verify";

/**
 * Property-based fuzz harness with `verifyGeneration` as the oracle. The engine's core invariant —
 * "it never emits a board verify rejects" — is asserted over a fixed list of seeded random-but-
 * plausible snapshots, on BOTH the empty board and a partially-pinned re-solve (pinning a subset of
 * a verified board reproduces the exact flagged-boxing class Phase 1 fixed). Completeness is NOT
 * asserted: random instances may be infeasible, so unplaced residue is legal — an invalid board is
 * never legal. Fixed seeds + a local `mulberry32` (no `Math.random`) keep every run reproducible;
 * to isolate a failing seed, change its `it(` to `it.only(` — the seed is printed in the message.
 */

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34];
const FUZZ_BUDGET = { budgetMs: 150 };

describe("engine fuzz — verify is the oracle", () => {
  for (const seed of SEEDS) {
    it(`emits verify-clean boards (empty + partially-pinned) for seed ${seed}`, async () => {
      const empty = randomSnapshot(seed);

      const first = await generatePlanGreedy(empty, FUZZ_BUDGET);
      const firstVerdict = verifyGeneration(empty, first.placements);
      expect(firstVerdict.ok, `seed ${seed} empty-board solve invalid: ${firstVerdict.reasons.join("; ")}`).toBe(true);

      const pinned = withPins(empty, first.placements, seed);
      const second = await generatePlanGreedy(pinned, FUZZ_BUDGET);
      const secondVerdict = verifyGeneration(pinned, second.placements);
      expect(secondVerdict.ok, `seed ${seed} re-solve invalid: ${secondVerdict.reasons.join("; ")}`).toBe(true);
    });
  }
});

/** A random-but-plausible empty-board snapshot: 2–5 days × 4–8 periods, 4–10 courses per cohort
 *  (1–4 hours, shared teacher/student pools), ~15% biweekly, ~15% flagged, a few strong-NO cells. */
const randomSnapshot = (seed: number): GeneratorSnapshot => {
  const rng = mulberry32(seed);
  const between = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
  const days = between(2, 5);
  const periods = between(4, 8);
  const teachers = Array.from({ length: between(4, 8) }, (_, i) => `t${i}`);
  const students = Array.from({ length: between(6, 12) }, (_, i) => `s${i}`);
  const flagged: string[] = [];

  const makeCourses = (cohort: Cohort): GroupingCourse[] =>
    Array.from({ length: between(4, 10) }, (_, i): GroupingCourse => {
      const id = `${cohort}-c${i}`;
      if (rng() < 0.15) flagged.push(id);
      return {
        id,
        teacherKeys: [teachers[Math.floor(rng() * teachers.length)]],
        studentKeys: sample(students, between(1, 3), rng),
        hours: between(1, 4),
        weekMode: rng() < 0.15 ? "biweekly" : "agnostic",
      };
    });

  const cohorts = { dp1: makeCourses("dp1"), dp2: makeCourses("dp2") };
  const availability = Array.from({ length: between(0, 3) }, () => ({
    teacherKey: teachers[Math.floor(rng() * teachers.length)],
    day: between(1, days),
    period: between(1, periods),
    severity: "strong" as const,
  }));

  return {
    days,
    periods,
    availability,
    finishesEarlyByCourseId: flagged,
    cohorts: {
      dp1: { courses: cohorts.dp1, pins: [], parkedCourseIds: [] },
      dp2: { courses: cohorts.dp2, pins: [], parkedCourseIds: [] },
    },
  };
};

/** Pin a random ~30% subset (flagged rows included) of a verified solve back onto the snapshot —
 *  a subset of a valid board carries no blocking violations, so the re-solve starts from valid pins. */
const withPins = (snapshot: GeneratorSnapshot, placements: GeneratedPlacement[], seed: number): GeneratorSnapshot => {
  const rng = mulberry32(seed * 7 + 1);
  const pinsByCohort: Record<Cohort, GeneratorSnapshot["cohorts"]["dp1"]["pins"]> = { dp1: [], dp2: [] };
  placements.forEach((row, i) => {
    if (rng() < 0.3) {
      pinsByCohort[row.cohort].push(placement(`fuzz-pin-${seed}-${i}`, row.courseId, row.day, row.period, row.week));
    }
  });
  return {
    ...snapshot,
    cohorts: {
      dp1: { ...snapshot.cohorts.dp1, pins: pinsByCohort.dp1 },
      dp2: { ...snapshot.cohorts.dp2, pins: pinsByCohort.dp2 },
    },
  };
};

/** `count` distinct elements of `items`, drawn deterministically from `rng`. */
const sample = <T>(items: readonly T[], count: number, rng: () => number): T[] => {
  const pool = [...items];
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
};

/** Deterministic PRNG (matches the engine's private copy) — fixed seeds ⇒ reproducible fuzz cases. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
