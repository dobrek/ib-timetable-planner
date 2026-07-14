import type { Cohort } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { cellKey } from "../../../collision/cell-key";
import { deriveGenerationDeficits } from "../../deficits";
import { deriveGoldenSets } from "../../golden-sets";
import { countOccupiedSlots } from "../../occupied-slots";
import type { CourseDeficit, GeneratorSnapshot } from "../../types";

/**
 * The static problem projection built once per generate call: the two-cohort catalog indexed by id,
 * the flagged/strong-NO sets, the interior-first cell scan order, the backbone clique candidates, the
 * deficits to place, and the slot lower bounds. Everything here is derived from the snapshot and never
 * mutated during the search — the mutable working state lives in `board.ts`.
 */

/** Cohort iteration order — dp1 before dp2 (the deterministic first-attempt order). */
export const COHORT_ORDER: Cohort[] = ["dp1", "dp2"];

/** A backbone clique counts as a candidate when within this many hours of the best (breadth for
 *  diversification without straying from the near-max-weight anchor). */
const NEAR_CLIQUE_WINDOW = 2;

/** Node-expansion cap for the exact clique B&B — a safety valve for a pathological catalog; on
 *  overflow the best clique found so far is returned (any clique's weight is still a valid bound). */
const CLIQUE_NODE_CAP = 100_000;

export type Problem = {
  snapshot: GeneratorSnapshot;
  courseById: Map<string, GroupingCourse & { cohort: Cohort }>;
  flagged: Set<string>;
  /** teacherKey → cellKeys the teacher must not teach (strong severity only). */
  strongNo: Map<string, Set<string>>;
  /** Interior-first cell scan order — leftovers/free cells land at day edges. */
  cellOrder: { d: number; p: number }[];
  /** Per cohort: near-max-weight conflict cliques (backbone candidates, non-flagged). */
  backbones: Record<Cohort, Set<string>[]>;
  /** Per cohort: full-cohort cover sets, best coverage first — the golden slots to seat mid-day. */
  goldenSets: Record<Cohort, Set<string>[]>;
  /** Per cohort: deficits the attempt must place (net of pins and parked coverage). */
  deficits: Record<Cohort, CourseDeficit[]>;
  /** Per cohort: occupied slots before generation (pins only). */
  slotsBefore: Record<Cohort, number>;
  /** Per cohort: provable lower bound on occupied slots (exact max-weight conflict clique). */
  lowerBound: Record<Cohort, number>;
};

export const buildProblem = (snapshot: GeneratorSnapshot): Problem => {
  const courseById = new Map<string, GroupingCourse & { cohort: Cohort }>();
  for (const cohort of COHORT_ORDER) {
    for (const course of snapshot.cohorts[cohort].courses) courseById.set(course.id, { ...course, cohort });
  }
  const flagged = new Set(snapshot.finishesEarlyByCourseId);
  const strongNo = new Map<string, Set<string>>();
  for (const row of snapshot.availability) {
    if (row.severity !== "strong") continue;
    const cells = strongNo.get(row.teacherKey) ?? new Set<string>();
    if (!strongNo.has(row.teacherKey)) strongNo.set(row.teacherKey, cells);
    cells.add(cellKey(row.day, row.period));
  }
  return {
    snapshot,
    courseById,
    flagged,
    strongNo,
    cellOrder: interiorFirstCellOrder(snapshot.days, snapshot.periods),
    backbones: {
      dp1: backboneCliques(snapshot.cohorts.dp1.courses, flagged),
      dp2: backboneCliques(snapshot.cohorts.dp2.courses, flagged),
    },
    // The WHOLE catalog goes in, flagged ids alongside it: the detector drops flagged courses from
    // its candidates (they live under the day-edge rule, so one can never anchor a mid-day band) but
    // still counts their students in the roster — the same roster the `goldenBandDistance` tier uses.
    goldenSets: {
      dp1: deriveGoldenSets(snapshot.cohorts.dp1.courses, flagged),
      dp2: deriveGoldenSets(snapshot.cohorts.dp2.courses, flagged),
    },
    deficits: {
      dp1: cohortDeficits(snapshot, "dp1"),
      dp2: cohortDeficits(snapshot, "dp2"),
    },
    slotsBefore: {
      dp1: countOccupiedSlots(snapshot.cohorts.dp1.pins),
      dp2: countOccupiedSlots(snapshot.cohorts.dp2.pins),
    },
    lowerBound: {
      dp1: maxWeightCliqueWeight(snapshot.cohorts.dp1.courses, flagged),
      dp2: maxWeightCliqueWeight(snapshot.cohorts.dp2.courses, flagged),
    },
  };
};

/** Interior periods first (centre-out), day edges last — so unfilled cells sit at day edges. */
export const interiorFirstCellOrder = (days: number, periods: number): { d: number; p: number }[] => {
  const middle = [];
  for (let p = 2; p <= periods - 1; p++) middle.push(p);
  middle.sort((a, b) => Math.abs(a - (periods + 1) / 2) - Math.abs(b - (periods + 1) / 2));
  const periodOrder = periods >= 2 ? [...middle, 1, periods] : [1];
  const order: { d: number; p: number }[] = [];
  for (const p of periodOrder) for (let d = 1; d <= days; d++) order.push({ d, p });
  return order;
};

/**
 * Greedy near-max-weight cliques of the cohort's conflict graph (weight = hours), one per
 * seed course, deduped, within `NEAR_CLIQUE_WINDOW` hours of the best. A clique's total hours is a
 * hard lower bound on the cohort's occupied slots, so laying it one-hour-per-cell first anchors the
 * slot-count objective. Biweekly and flagged courses stay out (opposite-week pairs relax
 * conflicts; flagged courses go through the edge-rule pass).
 */
export const backboneCliques = (courses: GroupingCourse[], flagged: Set<string>): Set<string>[] => {
  const { nodes, adjacency } = conflictGraph(courses, flagged);

  const cliques = nodes.map((seedCourse) => {
    const clique = [seedCourse];
    let candidates = nodes.filter((c) => adjacency.get(seedCourse.id)?.has(c.id));
    while (candidates.length > 0) {
      const pick = candidates.reduce((a, b) => (b.hours > a.hours ? b : a));
      clique.push(pick);
      candidates = candidates.filter((c) => c.id !== pick.id && adjacency.get(pick.id)?.has(c.id));
    }
    return { weight: clique.reduce((sum, c) => sum + c.hours, 0), ids: clique.map((c) => c.id) };
  });
  if (cliques.length === 0) return [new Set()];
  const max = Math.max(...cliques.map((c) => c.weight));
  const near = cliques.filter((c) => c.weight >= max - NEAR_CLIQUE_WINDOW);
  const deduped = [...new Map(near.map((c) => [[...c.ids].sort().join(","), c])).values()];
  return deduped.map((c) => new Set(c.ids));
};

/**
 * Exact max-weight clique weight (in hours) of the cohort's conflict graph — a *provable* lower
 * bound on occupied slots, since every course in a mutual-conflict clique needs its own cell.
 * Branch-and-bound: candidates ordered hours-descending to tighten `best` early, pruned by an
 * hours-sum upper bound, bounded by `CLIQUE_NODE_CAP`. Run once per generate call (n ≈ 40).
 */
export const maxWeightCliqueWeight = (courses: GroupingCourse[], flagged: Set<string>): number => {
  const { nodes, adjacency } = conflictGraph(courses, flagged);
  const ordered = [...nodes].sort((a, b) => b.hours - a.hours);
  const sumHours = (cs: GroupingCourse[]): number => cs.reduce((sum, c) => sum + c.hours, 0);
  let best = 0;
  let expansions = 0;

  const search = (weight: number, candidates: GroupingCourse[]): void => {
    if (expansions >= CLIQUE_NODE_CAP) return;
    expansions += 1;
    if (weight > best) best = weight;
    for (let i = 0; i < candidates.length; i++) {
      if (weight + sumHours(candidates.slice(i)) <= best) return; // can't beat best even taking all
      const c = candidates[i];
      const next = candidates.slice(i + 1).filter((o) => adjacency.get(c.id)?.has(o.id));
      search(weight + c.hours, next);
    }
  };
  search(0, ordered);
  return best;
};

const cohortDeficits = (snapshot: GeneratorSnapshot, cohort: Cohort): CourseDeficit[] => {
  const { pins, courses, parkedCourseIds } = snapshot.cohorts[cohort];
  return deriveGenerationDeficits(pins, courses, parkedCourseIds);
};

/** The cohort's conflict graph over placeable (non-flagged, non-biweekly, positive-hour) courses:
 *  two courses share an edge iff they share a teacher or a student, so they can never share a cell. */
const conflictGraph = (
  courses: GroupingCourse[],
  flagged: Set<string>,
): { nodes: GroupingCourse[]; adjacency: Map<string, Set<string>> } => {
  const nodes = courses.filter((c) => c.hours > 0 && c.weekMode !== "biweekly" && !flagged.has(c.id));
  const conflicts = (a: GroupingCourse, b: GroupingCourse): boolean =>
    a.teacherKeys.some((t) => b.teacherKeys.includes(t)) || a.studentKeys.some((s) => b.studentKeys.includes(s));
  const adjacency = new Map(
    nodes.map((c) => [c.id, new Set(nodes.filter((o) => o.id !== c.id && conflicts(c, o)).map((o) => o.id))]),
  );
  return { nodes, adjacency };
};
