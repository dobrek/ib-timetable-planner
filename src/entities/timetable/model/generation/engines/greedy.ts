import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { cellKey } from "../../collision/cell-key";
import { deriveGenerationDeficits } from "../deficits";
import { countOccupiedSlots } from "../occupied-slots";
import type {
  CourseDeficit,
  GeneratePlan,
  GeneratedPlacement,
  GenerationDiagnostics,
  GenerationProgress,
  GenerationResult,
  GeneratorSnapshot,
} from "../types";

/**
 * The shipped engine (Phase 2 verdict — see change.md): GRASP over a clique backbone.
 *
 * Each seeded attempt (1) lays a *backbone* — a near-max-weight clique of the cohort's
 * conflict graph, whose total hours lower-bound the cohort's occupied slots — one hour
 * per cell; (2) packs the remaining deficits into already-used cells most-remaining-first;
 * (3) repairs stragglers with depth-bounded ejection chains; (4) places `finishes_early`
 * courses edge-or-unplaced; (5) spills any residue (completeness first); then (6) descends
 * on slot count by emptying cells via randomized ejection chains and (7) migrates interior
 * free cells to day edges. Attempts restart with fresh randomization until the budget or
 * cancel signal; the best board by the objective tiers (completeness > day-edge quality >
 * slot count > student compactness) wins. All hard rules — the five core constraints plus
 * the generator-hard 2/day cap and the flagged edge rule — are enforced per candidate cell;
 * pins are never moved. The caller re-judges the result via `verifyGeneration` regardless.
 */
/** Constructive attempts for diversification before LNS takes over the polish (attempt 1 + 2 noisy). */
const DIVERSIFY_ATTEMPTS = 3;
/** Attempt descent share — reduced from the pre-LNS 0.4 since destroy-and-repair now owns the polish. */
const ATTEMPT_DESCENT_SHARE = 0.1;
/** Stop early once the incumbent is complete + hole-free and no LNS round has improved it for this long. */
const STAGNATION_MS = 2_500;
/** Fixed seed for the LNS operator PRNG — one stream across all rounds keeps the loop deterministic. */
const LNS_SEED = 9973;

export const generatePlanGreedy: GeneratePlan = async (snapshot, config, hooks = {}) => {
  const startedAt = Date.now();
  const deadline = startedAt + config.budgetMs;
  const problem = buildProblem(snapshot);
  const stopped = (): boolean => hooks.signal?.aborted === true || Date.now() >= deadline;
  // Shared time-sliced yield: hands control back to the event loop (so the worker's cancel
  // message can be observed and progress ticks can flow) only when a slice has elapsed since the
  // last yield — per-iteration awaits would drown the descent budget in timer-clamp overhead.
  const maybeYield = createYielder(startedAt, config.budgetMs, hooks.onProgress);

  // Phase A — diversification: attempt 1 is deterministic; 2..K are seeded noisy restarts that
  // escape a bad backbone. Each keeps only a small descent share; LNS does the real polishing.
  let best = await runAttempt(problem, {
    seed: 1,
    noise: 0,
    descentUntil: descentDeadline(deadline, startedAt, ATTEMPT_DESCENT_SHARE),
    stopped,
    maybeYield,
  });
  for (let seed = 2; seed <= DIVERSIFY_ATTEMPTS && !stopped(); seed++) {
    await maybeYield();
    if (stopped()) break;
    const candidate = await runAttempt(problem, {
      seed,
      noise: 1,
      descentUntil: descentDeadline(deadline, Date.now(), ATTEMPT_DESCENT_SHARE),
      stopped,
      maybeYield,
    });
    if (compareObjectives(candidate.objective, best.objective) < 0) best = candidate;
  }

  // Phase B — LNS: destroy a slice of the incumbent and repair it, accepting only tuple
  // improvements; alternate the destroy operator each round. Stop early once the board is complete
  // and hole-free and no round has improved it for the stagnation window (easy instances finish fast).
  const lnsRng = mulberry32(LNS_SEED);
  let lastImproveAt = Date.now();
  for (let round = 1; !stopped(); round++) {
    await maybeYield();
    if (stopped()) break;
    if (isConverged(best) && Date.now() - lastImproveAt >= STAGNATION_MS) break;
    const candidate = await runAttempt(problem, {
      seed: 0,
      noise: 1,
      descentUntil: Date.now(), // no spin — one productive descent pass per LNS round
      stopped,
      maybeYield,
      lns: { incumbent: best, destroy: round % 2 === 0 ? "day" : "random", rng: lnsRng },
    });
    if (compareObjectives(candidate.objective, best.objective) < 0) {
      best = candidate;
      lastImproveAt = Date.now();
    }
  }

  const stopReason: GenerationDiagnostics["stopReason"] =
    hooks.signal?.aborted === true ? "cancelled" : Date.now() >= deadline ? "budget" : "stagnation";

  return toResult(problem, best, {
    elapsedMs: Date.now() - startedAt,
    partial: hooks.signal?.aborted === true,
    stopReason,
  });
};

/** A board LNS can stop polishing: complete (nothing unplaced) and free of interior holes. */
const isConverged = (candidate: Candidate): boolean => candidate.objective[0] === 0 && candidate.objective[1] === 0;

// ---------------------------------------------------------------------------------------
// Problem projection (static per generate call)
// ---------------------------------------------------------------------------------------

const COHORT_ORDER: Cohort[] = ["dp1", "dp2"];

type Problem = {
  snapshot: GeneratorSnapshot;
  courseById: Map<string, GroupingCourse & { cohort: Cohort }>;
  flagged: Set<string>;
  /** teacherKey → cellKeys the teacher must not teach (strong severity only). */
  strongNo: Map<string, Set<string>>;
  /** Interior-first cell scan order — leftovers/free cells land at day edges. */
  cellOrder: { d: number; p: number }[];
  /** Per cohort: near-max-weight conflict cliques (backbone candidates, non-flagged). */
  backbones: Record<Cohort, Set<string>[]>;
  /** Per cohort: deficits the attempt must place (net of pins and parked coverage). */
  deficits: Record<Cohort, CourseDeficit[]>;
  /** Per cohort: occupied slots before generation (pins only). */
  slotsBefore: Record<Cohort, number>;
  /** Per cohort: provable lower bound on occupied slots (exact max-weight conflict clique). */
  lowerBound: Record<Cohort, number>;
};

const buildProblem = (snapshot: GeneratorSnapshot): Problem => {
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

const cohortDeficits = (snapshot: GeneratorSnapshot, cohort: Cohort): CourseDeficit[] => {
  const { pins, courses, parkedCourseIds } = snapshot.cohorts[cohort];
  return deriveGenerationDeficits(pins, courses, parkedCourseIds);
};

/** Interior periods first (centre-out), day edges last — so unfilled cells sit at day edges. */
const interiorFirstCellOrder = (days: number, periods: number): { d: number; p: number }[] => {
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
 * seed course, deduped, within 2 hours of the best. A clique's total hours is a hard lower
 * bound on the cohort's occupied slots, so laying it one-hour-per-cell first anchors the
 * slot-count objective. Biweekly and flagged courses stay out (opposite-week pairs relax
 * conflicts; flagged courses go through the edge-rule pass).
 */
const backboneCliques = (courses: GroupingCourse[], flagged: Set<string>): Set<string>[] => {
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
  const near = cliques.filter((c) => c.weight >= max - 2);
  const deduped = [...new Map(near.map((c) => [[...c.ids].sort().join(","), c])).values()];
  return deduped.map((c) => new Set(c.ids));
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

/** Node-expansion cap for the exact clique B&B — a safety valve for a pathological catalog; on
 *  overflow the best clique found so far is returned (any clique's weight is still a valid bound). */
const CLIQUE_NODE_CAP = 100_000;

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

// ---------------------------------------------------------------------------------------
// One attempt: mutable board state behind pure-feasibility checks
// ---------------------------------------------------------------------------------------

type Row = { courseId: string; week: PlacementWeek; pinned: boolean };

/** The lexicographic objective tuple: `[unplacedTotal, holes, totalSlots, studentHoles]` —
 *  completeness > interior holes > slot count > student compactness, compared tier-by-tier. */
export type Objective = [unplacedTotal: number, holes: number, totalSlots: number, studentHoles: number];

type Candidate = {
  placements: GeneratedPlacement[];
  objective: Objective;
  slots: Record<Cohort, number>;
  unplaced: Record<Cohort, CourseDeficit[]>;
  /** Per-course hours still unplaced — with `placements`, the full state an LNS round rehydrates. */
  remaining: Map<string, number>;
};

/**
 * Lexicographic comparison of two objective tuples — the priority tiers hold at ANY magnitude
 * (the weighted scalar it replaces let a studentHoles term in the hundreds outvote a whole slot).
 * Negative ⇒ `a` is the better board (smaller-is-better on every tier); shared by cross-attempt
 * selection and Phase 4's LNS acceptance so the two never disagree.
 */
export const compareObjectives = (a: Objective, b: Objective): number => {
  for (let tier = 0; tier < a.length; tier++) {
    if (a[tier] !== b[tier]) return a[tier] - b[tier];
  }
  return 0;
};

/** One LNS round's inputs: the incumbent to repair, which destroy operator to apply, and the
 *  shared operator PRNG (so successive rounds diverge deterministically). */
type LnsRound = { incumbent: Candidate; destroy: "day" | "random"; rng: () => number };

type AttemptOptions = {
  /** Attempt seed (1 = deterministic first board); ignored in LNS mode. */
  seed: number;
  /** Rank noise: 0 for the deterministic first attempt, 1 for restarts and LNS repair. */
  noise: number;
  descentUntil: number;
  stopped: () => boolean;
  maybeYield: () => Promise<void>;
  /** When set, rebuild-and-repair this incumbent instead of constructing from scratch (skips the backbone). */
  lns?: LnsRound;
};

const runAttempt = async (problem: Problem, opts: AttemptOptions): Promise<Candidate> => {
  const { seed, noise, descentUntil, stopped, maybeYield, lns } = opts;
  const { snapshot, courseById, flagged, strongNo, cellOrder, backbones } = problem;
  const { days, periods } = snapshot;
  const rng = lns ? lns.rng : mulberry32(seed);
  const backbone: Record<Cohort, Set<string>> = {
    dp1: pickFrom(backbones.dp1, rng),
    dp2: pickFrom(backbones.dp2, rng),
  };
  // Two randomized restarts in three (rng < 0.67) reserve a day-edge cell per cohort up front, so
  // the constructive pass targets a smaller board instead of relying on descent alone. LNS repairs
  // an existing board, so it never reserves.
  const reserved: Record<Cohort, Set<string>> = {
    dp1: !lns && seed > 1 && rng() < 0.67 ? sampleEdgeCell(days, periods, rng) : new Set(),
    dp2: !lns && seed > 1 && rng() < 0.67 ? sampleEdgeCell(days, periods, rng) : new Set(),
  };
  // Attempt 1 keeps the deterministic dp1-first order; every other attempt and all LNS rounds
  // randomize which cohort is packed first (a cheap diversification the old loop lacked).
  const cohortOrder: Cohort[] = !lns && seed === 1 ? [...COHORT_ORDER] : shuffled(COHORT_ORDER, rng);

  // --- mutable indexes -------------------------------------------------------------
  const remaining = new Map<string, number>();
  const generated: GeneratedPlacement[] = [];
  /** teacherKey|cellKey|week → courseId (global across cohorts = cross-cohort rule). */
  const teacherAt = new Map<string, string>();
  /** cohort|student|day|week → period → courseId (single owner per lane by construction). */
  const studentAt = new Map<string, Map<number, string>>();
  /** cohort|cellKey → occupant rows (pins + generated). */
  const cellRows = new Map<string, Row[]>();
  /** courseId|day|week → same-day count (the hard 2/day cap). */
  const dayCount = new Map<string, number>();

  const weeksOf = (week: PlacementWeek): ("a" | "b")[] => (week === "both" ? ["a", "b"] : [week]);
  const studentKeyOf = (cohort: Cohort, student: string, d: number, w: string): string =>
    `${cohort}|${student}|${d}|${w}`;

  const index = (
    cohort: Cohort,
    courseId: string,
    d: number,
    p: number,
    week: PlacementWeek,
    pinned: boolean,
  ): void => {
    const course = courseById.get(courseId);
    if (!course) return; // catalog-missing pin — nothing to attribute (mirrors bucketByCell)
    const ck = cellKey(d, p);
    for (const w of weeksOf(week)) {
      for (const t of course.teacherKeys) teacherAt.set(`${t}|${ck}|${w}`, courseId);
      for (const s of course.studentKeys) {
        const sdKey = studentKeyOf(cohort, s, d, w);
        const byPeriod = studentAt.get(sdKey) ?? new Map<number, string>();
        if (!studentAt.has(sdKey)) studentAt.set(sdKey, byPeriod);
        byPeriod.set(p, courseId);
      }
      dayCount.set(`${courseId}|${d}|${w}`, (dayCount.get(`${courseId}|${d}|${w}`) ?? 0) + 1);
    }
    const rowsKey = `${cohort}|${ck}`;
    const rows = cellRows.get(rowsKey) ?? [];
    if (!cellRows.has(rowsKey)) cellRows.set(rowsKey, rows);
    rows.push({ courseId, week, pinned });
  };

  const unindex = (cohort: Cohort, courseId: string, d: number, p: number, week: PlacementWeek): void => {
    const course = courseById.get(courseId);
    if (!course) return;
    const ck = cellKey(d, p);
    for (const w of weeksOf(week)) {
      for (const t of course.teacherKeys) teacherAt.delete(`${t}|${ck}|${w}`);
      for (const s of course.studentKeys) studentAt.get(studentKeyOf(cohort, s, d, w))?.delete(p);
      const dk = `${courseId}|${d}|${w}`;
      dayCount.set(dk, (dayCount.get(dk) ?? 0) - 1);
    }
    const rows = cellRows.get(`${cohort}|${ck}`);
    if (rows) removeWhere(rows, (r) => r.courseId === courseId, `cell row ${cohort} ${courseId} @ ${ck}`);
  };

  for (const cohort of COHORT_ORDER) {
    for (const deficit of problem.deficits[cohort]) remaining.set(deficit.courseId, deficit.missing);
    for (const pin of snapshot.cohorts[cohort].pins) index(cohort, pin.courseId, pin.day, pin.period, pin.week, true);
  }

  // LNS rebuild: re-index the incumbent's generated rows (pins are already indexed above), adopt its
  // `remaining`, then destroy a slice — the removed hours flow back into `remaining` for the repair
  // stages (2–5) to re-place. The whole round runs on this working copy; a reject just discards it.
  if (lns) {
    remaining.clear();
    for (const [courseId, missing] of lns.incumbent.remaining) remaining.set(courseId, missing);
    for (const row of lns.incumbent.placements) {
      generated.push({ ...row });
      index(row.cohort, row.courseId, row.day, row.period, row.week, false);
    }
    for (const row of destroyTargets(lns.destroy, generated, rng)) {
      unindex(row.cohort, row.courseId, row.day, row.period, row.week);
      removeWhere(generated, (x) => x === row, `lns destroy row ${row.courseId}`);
      remaining.set(row.courseId, (remaining.get(row.courseId) ?? 0) + 1);
    }
  }

  // --- feasibility -----------------------------------------------------------------
  const feasibleWeek = (cohort: Cohort, course: GroupingCourse, d: number, p: number): PlacementWeek | null => {
    const ck = cellKey(d, p);
    if (cellRows.get(`${cohort}|${ck}`)?.some((r) => r.courseId === course.id)) return null;
    const options: PlacementWeek[] = course.weekMode === "biweekly" ? ["a", "b"] : ["both"];
    outer: for (const week of options) {
      for (const w of weeksOf(week)) {
        if ((dayCount.get(`${course.id}|${d}|${w}`) ?? 0) >= 2) continue outer;
        for (const t of course.teacherKeys) {
          if (strongNo.get(t)?.has(ck)) continue outer;
          if (teacherAt.has(`${t}|${ck}|${w}`)) continue outer;
        }
        for (const s of course.studentKeys) {
          if (studentAt.get(studentKeyOf(cohort, s, d, w))?.has(p)) continue outer;
        }
      }
      return week;
    }
    return null;
  };

  /**
   * The flagged-edge invariant at a single placement site, delta-aware — the one predicate that
   * closes the boxing bug across every stage (pins included). Placing `course` at (d, p, week)
   * must not push a flagged row that shares a student — the candidate itself, a pin, or a
   * generated row — from a day edge into the strict interior. Per enrolled student's day-week lane:
   *   1. if the candidate is flagged, it must land at an edge among the lane's *other* courses
   *      (the core's `early-finish-edge` rule for the placed row);
   *   2. every flagged occupant already in the lane that was at an edge must stay at an edge once
   *      the candidate joins at period `p`.
   * A flagged row already interior *before* the placement (a dirty board that slipped past the
   * worker precondition) is left untouched rather than poisoning every placement for that
   * student-day (Critical Implementation Details: delta semantics — reject only newly-boxed rows).
   */
  const flaggedEdgeOk = (
    cohort: Cohort,
    course: GroupingCourse,
    d: number,
    p: number,
    week: PlacementWeek,
  ): boolean => {
    for (const w of weeksOf(week)) {
      for (const s of course.studentKeys) {
        const lane = studentAt.get(studentKeyOf(cohort, s, d, w));
        if (!lane) continue;
        const occupants = [...lane]; // [period, courseId] — single owner per period
        if (flagged.has(course.id) && strictlyInterior(p, othersOf(occupants, course.id))) return false;
        for (const [q, owner] of occupants) {
          if (owner === course.id || !flagged.has(owner)) continue;
          const others = othersOf(occupants, owner);
          if (!strictlyInterior(q, others) && strictlyInterior(q, [...others, p])) return false;
        }
      }
    }
    return true;
  };

  const fitsAt = (cohort: Cohort, course: GroupingCourse, d: number, p: number): PlacementWeek | null => {
    const week = feasibleWeek(cohort, course, d, p);
    if (!week) return null;
    return flaggedEdgeOk(cohort, course, d, p, week) ? week : null;
  };

  const placeDeficit = (cohort: Cohort, courseId: string, d: number, p: number, week: PlacementWeek): void => {
    generated.push({ cohort, courseId, day: d, period: p, week });
    remaining.set(courseId, (remaining.get(courseId) ?? 0) - 1);
    index(cohort, courseId, d, p, week, false);
  };

  const candidatesFor = (cohort: Cohort, includeFlagged: boolean): (GroupingCourse & { cohort: Cohort })[] =>
    snapshot.cohorts[cohort].courses
      .filter((c) => (remaining.get(c.id) ?? 0) > 0 && (includeFlagged || !flagged.has(c.id)))
      .map((c) => ({ course: c, rank: (remaining.get(c.id) ?? 0) * 100 + c.studentKeys.length + noise * rng() * 400 }))
      .sort((a, b) => b.rank - a.rank)
      .map(({ course }) => ({ ...course, cohort }));

  const usedCells = (cohort: Cohort, excludeKey?: string): { d: number; p: number }[] =>
    cellOrder.filter(({ d, p }) => {
      const ck = cellKey(d, p);
      return ck !== excludeKey && (cellRows.get(`${cohort}|${ck}`)?.length ?? 0) > 0;
    });

  // --- stage 1: backbone — one clique-course hour per cell (construction only, not LNS) -----
  if (!lns) {
    for (const cohort of cohortOrder) {
      for (const { d, p } of cellOrder) {
        if (reserved[cohort].has(cellKey(d, p))) continue;
        const clique = candidatesFor(cohort, false).filter((c) => backbone[cohort].has(c.id));
        for (const course of clique) {
          const week = fitsAt(cohort, course, d, p);
          if (week) {
            placeDeficit(cohort, course.id, d, p, week);
            break;
          }
        }
      }
    }
  }

  // --- stage 2: pack the remainder into already-used cells --------------------------
  for (const { d, p } of cellOrder) {
    for (const cohort of cohortOrder) {
      if ((cellRows.get(`${cohort}|${cellKey(d, p)}`)?.length ?? 0) === 0) continue;
      for (const course of candidatesFor(cohort, false)) {
        const week = fitsAt(cohort, course, d, p);
        if (week) placeDeficit(cohort, course.id, d, p, week);
      }
    }
  }

  // --- stage 3: ejection-chain repair for stragglers (used cells only) ---------------
  /** Fit one in-hand hour of `course` into a used cell (≠ exclude), evicting non-pinned,
   *  non-flagged, unvisited members along a bounded chain. Never touches `remaining`. */
  const chainFit = (
    cohort: Cohort,
    course: GroupingCourse,
    excludeKey: string | undefined,
    depth: number,
    visited: Set<string>,
  ): boolean => {
    for (const { d, p } of shuffled(usedCells(cohort, excludeKey), rng)) {
      const week = fitsAt(cohort, course, d, p);
      if (week) {
        generated.push({ cohort, courseId: course.id, day: d, period: p, week });
        index(cohort, course.id, d, p, week, false);
        return true;
      }
    }
    if (depth === 0) return false;
    for (const { d, p } of shuffled(usedCells(cohort, excludeKey), rng)) {
      for (const member of shuffled(cellRows.get(`${cohort}|${cellKey(d, p)}`) ?? [], rng)) {
        if (member.pinned || flagged.has(member.courseId) || visited.has(member.courseId)) continue;
        const memberCourse = courseById.get(member.courseId);
        if (!memberCourse) continue;
        unindex(cohort, member.courseId, d, p, member.week);
        const evictedRow = removeWhere(
          generated,
          (x) => x.cohort === cohort && x.courseId === member.courseId && x.day === d && x.period === p,
          `generated row ${member.courseId} @ ${cellKey(d, p)}`,
        );
        if (fitsAt(cohort, course, d, p)) {
          visited.add(member.courseId);
          if (chainFit(cohort, memberCourse, excludeKey, depth - 1, visited)) {
            const week = fitsAt(cohort, course, d, p); // the chain may have shuffled the board
            if (week) {
              generated.push({ cohort, courseId: course.id, day: d, period: p, week });
              index(cohort, course.id, d, p, week, false);
              return true;
            }
            continue; // shuffled but valid — keep scanning
          }
          visited.delete(member.courseId);
        }
        index(cohort, member.courseId, d, p, member.week, false);
        generated.push(evictedRow);
      }
    }
    return false;
  };

  for (const cohort of cohortOrder) {
    for (const course of candidatesFor(cohort, false)) {
      let guard = 0;
      while ((remaining.get(course.id) ?? 0) > 0 && guard < 30) {
        guard += 1;
        if (!chainFit(cohort, course, undefined, 2, new Set([course.id]))) break;
        remaining.set(course.id, (remaining.get(course.id) ?? 0) - 1);
      }
    }
  }

  // --- stage 4: flagged courses — edge of every enrolled student's day, or unplaced ---
  for (const cohort of cohortOrder) {
    for (const course of candidatesFor(cohort, true).filter((c) => flagged.has(c.id))) {
      while ((remaining.get(course.id) ?? 0) > 0) {
        const spot = [...usedCells(cohort), ...cellOrder].find(({ d, p }) => fitsAt(cohort, course, d, p) !== null);
        if (!spot) break;
        const week = fitsAt(cohort, course, spot.d, spot.p);
        if (!week) break;
        placeDeficit(cohort, course.id, spot.d, spot.p, week);
      }
    }
  }

  // --- stage 5: spill — completeness beats the reservation ---------------------------
  for (const pass of [false, true]) {
    for (const { d, p } of cellOrder) {
      for (const cohort of cohortOrder) {
        if (!pass && reserved[cohort].has(cellKey(d, p))) continue;
        for (const course of candidatesFor(cohort, false)) {
          const week = fitsAt(cohort, course, d, p);
          if (week) placeDeficit(cohort, course.id, d, p, week);
        }
      }
    }
  }

  // --- checkpoint: construction (stages 1–5) is complete and valid; descent must beat or tie
  // it, never regress. Score against a COPY (stages 6–7 mutate `generated` in place; `remaining`
  // is untouched by them) so the pre-descent board survives for the final comparison.
  const constructed = scoreCandidate(problem, generated.slice(), remaining);

  // --- stage 6: slot-count descent — empty cells via ejection chains ------------------
  for (const cohort of cohortOrder) {
    let emptied = true;
    while ((emptied || Date.now() < descentUntil) && !stopped()) {
      await maybeYield(); // once per descent outer iteration — the cancel/progress observation point
      if (stopped()) break;
      if (!emptied && Date.now() >= descentUntil) break;
      emptied = false;
      const candidates = usedCells(cohort)
        // A cell with a pinned OR flagged (immovable-in-descent) row can never be fully emptied —
        // its first such member breaks the inner loop — so admitting it just wastes a 15-cap slot.
        .filter(({ d, p }) =>
          (cellRows.get(`${cohort}|${cellKey(d, p)}`) ?? []).every((r) => !r.pinned && !flagged.has(r.courseId)),
        )
        .sort(
          (a, b) =>
            (cellRows.get(`${cohort}|${cellKey(a.d, a.p)}`)?.length ?? 0) -
            (cellRows.get(`${cohort}|${cellKey(b.d, b.p)}`)?.length ?? 0),
        )
        .slice(0, 15);
      for (const { d, p } of candidates) {
        if (stopped()) break;
        const ck = cellKey(d, p);
        let stuck = false;
        while (!stuck && (cellRows.get(`${cohort}|${ck}`)?.length ?? 0) > 0) {
          const member = (cellRows.get(`${cohort}|${ck}`) ?? [])[0];
          const memberCourse = courseById.get(member.courseId);
          if (!memberCourse || member.pinned || flagged.has(member.courseId)) break;
          unindex(cohort, member.courseId, d, p, member.week);
          const row = removeWhere(
            generated,
            (x) => x.cohort === cohort && x.courseId === member.courseId && x.day === d && x.period === p,
            `generated row ${member.courseId} @ ${ck}`,
          );
          if (!chainFit(cohort, memberCourse, ck, 3, new Set([member.courseId]))) {
            index(cohort, member.courseId, d, p, member.week, false);
            generated.push(row);
            stuck = true;
          }
        }
        if ((cellRows.get(`${cohort}|${ck}`)?.length ?? 0) === 0) {
          emptied = true;
          break;
        }
      }
      if (!emptied && Date.now() >= descentUntil) break;
    }
  }

  // --- stage 7: migrate interior free cells to day edges (whole-cell, same-day) -------
  for (const cohort of cohortOrder) {
    migrateHolesToEdges(cohort);
  }

  function migrateHolesToEdges(cohort: Cohort): void {
    for (let d = 1; d <= days; d++) {
      for (;;) {
        let moved = false;
        const used = [
          ...new Set(
            [...cellRows]
              .filter(([k, rows]) => k.startsWith(`${cohort}|${d}:`) && rows.length > 0)
              .map(([k]) => Number(k.split(":")[1])),
          ),
        ];
        if (used.length === 0) break;
        const lo = Math.min(...used);
        const hi = Math.max(...used);
        const freeInterior = [];
        for (let q = lo + 1; q < hi; q++) if (!used.includes(q)) freeInterior.push(q);
        if (freeInterior.length === 0) break;
        // Try every interior free period as a migration target (not only the first) so a day with
        // several holes keeps collapsing instead of stalling on the first unfillable one.
        for (const freeP of freeInterior) {
          for (const edgeP of [lo, hi]) {
            const members = [...(cellRows.get(`${cohort}|${cellKey(d, edgeP)}`) ?? [])];
            if (members.length === 0 || members.some((r) => r.pinned)) continue;
            const relocated: Row[] = [];
            let ok = true;
            for (const member of members) {
              const course = courseById.get(member.courseId);
              unindex(cohort, member.courseId, d, edgeP, member.week);
              if (!course || fitsAt(cohort, course, d, freeP) === null) {
                // a member cannot make the move (infeasible OR would box a flagged row) — roll back
                index(cohort, member.courseId, d, edgeP, member.week, false);
                ok = false;
                break;
              }
              removeWhere(
                generated,
                (x) => x.cohort === cohort && x.courseId === member.courseId && x.day === d && x.period === edgeP,
                `generated row ${member.courseId} @ ${cellKey(d, edgeP)}`,
              );
              generated.push({ cohort, courseId: member.courseId, day: d, period: freeP, week: member.week });
              index(cohort, member.courseId, d, freeP, member.week, false);
              relocated.push(member);
            }
            if (ok) {
              moved = true;
              break;
            }
            for (const member of relocated) {
              const at = generated.findIndex(
                (x) => x.cohort === cohort && x.courseId === member.courseId && x.day === d && x.period === freeP,
              );
              if (at !== -1) {
                unindex(cohort, member.courseId, d, freeP, member.week);
                generated.splice(at, 1);
              }
              index(cohort, member.courseId, d, edgeP, member.week, false);
              generated.push({ cohort, courseId: member.courseId, day: d, period: edgeP, week: member.week });
            }
          }
          if (moved) break;
        }
        if (!moved) break;
      }
    }
  }

  // --- score: return the better of construction vs. descent+migration ------------------
  // Descent trades slots for a possible new interior hole and migration can fail; scoring both
  // and keeping the winner makes an attempt improve-or-neutral by construction (never worse).
  const descended = scoreCandidate(problem, generated, remaining);
  return compareObjectives(descended.objective, constructed.objective) <= 0 ? descended : constructed;
};

const scoreCandidate = (
  problem: Problem,
  generated: GeneratedPlacement[],
  remaining: Map<string, number>,
): Candidate => {
  const { snapshot } = problem;
  const slots = {} as Record<Cohort, number>;
  const unplaced = {} as Record<Cohort, CourseDeficit[]>;
  let holes = 0;
  let studentHoles = 0;
  for (const cohort of COHORT_ORDER) {
    const rows = [...snapshot.cohorts[cohort].pins, ...generated.filter((x) => x.cohort === cohort)];
    slots[cohort] = countOccupiedSlots(rows);
    unplaced[cohort] = snapshot.cohorts[cohort].courses
      .filter((c) => (remaining.get(c.id) ?? 0) > 0)
      .map((c) => ({ courseId: c.id, missing: remaining.get(c.id) ?? 0 }));
    for (let d = 1; d <= snapshot.days; d++) {
      const used = new Set(rows.filter((x) => x.day === d).map((x) => x.period));
      if (used.size === 0) continue;
      for (let p = Math.min(...used) + 1; p < Math.max(...used); p++) if (!used.has(p)) holes += 1;
    }
    studentHoles += countStudentHoles(snapshot.cohorts[cohort].courses, rows);
  }
  const unplacedTotal = COHORT_ORDER.reduce(
    (sum, cohort) => sum + unplaced[cohort].reduce((s, d) => s + d.missing, 0),
    0,
  );
  const totalSlots = COHORT_ORDER.reduce((sum, cohort) => sum + slots[cohort], 0);
  const objective: Objective = [unplacedTotal, holes, totalSlots, studentHoles];
  return { placements: generated, objective, slots, unplaced, remaining: new Map(remaining) };
};

/** Week-aware per-student day holes: (span − occupied) summed over student-day-week lanes. */
const countStudentHoles = (
  courses: GroupingCourse[],
  rows: { courseId: string; day: number; period: number; week: PlacementWeek }[],
): number => {
  const byStudentDay = new Map<string, Set<number>>();
  const studentsOf = new Map(courses.map((c) => [c.id, c.studentKeys]));
  for (const row of rows) {
    const weeks = row.week === "both" ? ["a", "b"] : [row.week];
    for (const s of studentsOf.get(row.courseId) ?? []) {
      for (const w of weeks) {
        const k = `${s}|${row.day}|${w}`;
        const set = byStudentDay.get(k) ?? new Set<number>();
        if (!byStudentDay.has(k)) byStudentDay.set(k, set);
        set.add(row.period);
      }
    }
  }
  let total = 0;
  for (const periods of byStudentDay.values()) {
    if (periods.size === 0) continue;
    total += Math.max(...periods) - Math.min(...periods) + 1 - periods.size;
  }
  return total;
};

const toResult = (
  problem: Problem,
  best: Candidate,
  meta: { elapsedMs: number; partial: boolean; stopReason: GenerationDiagnostics["stopReason"] },
): GenerationResult => ({
  placements: best.placements,
  diagnostics: {
    engine: "greedy",
    elapsedMs: meta.elapsedMs,
    partial: meta.partial,
    stopReason: meta.stopReason,
    cohorts: {
      dp1: {
        occupiedSlotsBefore: problem.slotsBefore.dp1,
        occupiedSlotsAfter: best.slots.dp1,
        unplaced: best.unplaced.dp1,
        lowerBound: problem.lowerBound.dp1,
      },
      dp2: {
        occupiedSlotsBefore: problem.slotsBefore.dp2,
        occupiedSlotsAfter: best.slots.dp2,
        unplaced: best.unplaced.dp2,
        lowerBound: problem.lowerBound.dp2,
      },
    },
  },
});

// ---------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------

/** Periods a student's day-week lane holds via courses *other than* `courseId` (≤2/day each). */
const othersOf = (occupants: [number, string][], courseId: string): number[] =>
  occupants.filter(([, owner]) => owner !== courseId).map(([period]) => period);

/** True when `period` sits strictly between the min and max of `others` (empty ⇒ not interior). */
const strictlyInterior = (period: number, others: number[]): boolean =>
  others.length > 0 && period > Math.min(...others) && period < Math.max(...others);

/**
 * Remove and return the first element matching `match`, throwing on not-found — the eviction
 * sites rely on the row existing (an invariant that spans a stale shuffled copy plus a `visited`
 * set), and a silent `splice(findIndex → -1)` drops the LAST element instead, corrupting the
 * board. The worker's catch turns the throw into a clean failure rather than corrupt output.
 */
const removeWhere = <T>(items: T[], match: (item: T) => boolean, label: string): T => {
  const at = items.findIndex(match);
  if (at === -1) throw new Error(`generation invariant violated: ${label} not found for removal`);
  return items.splice(at, 1)[0];
};

/** Deterministic PRNG so a given (snapshot, seed) always replays the same search. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffled = <T>(items: readonly T[], rng: () => number): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const pickFrom = <T>(items: T[], rng: () => number): T => items[Math.floor(rng() * items.length)];

/** One randomly chosen day-edge cell (period 1 or last of some day), as a singleton set. */
const sampleEdgeCell = (days: number, periods: number, rng: () => number): Set<string> => {
  const edges: string[] = [];
  for (let d = 1; d <= days; d++) edges.push(cellKey(d, 1), cellKey(d, periods));
  return new Set([pickFrom(edges, rng)]);
};

/**
 * The generated rows an LNS destroy operator removes (references into `generated`): a whole random
 * `(cohort, day)` for `"day"`, or a random ~15% slice for `"random"`. Pins are never generated
 * rows, so they are inherently untouched. Alternating the two operators mixes coarse and fine moves.
 */
const destroyTargets = (
  destroy: "day" | "random",
  generated: GeneratedPlacement[],
  rng: () => number,
): GeneratedPlacement[] => {
  if (destroy === "day") {
    const cohort = pickFrom(COHORT_ORDER, rng);
    const days = [...new Set(generated.filter((row) => row.cohort === cohort).map((row) => row.day))];
    if (days.length === 0) return [];
    const day = pickFrom(days, rng);
    return generated.filter((row) => row.cohort === cohort && row.day === day);
  }
  const count = Math.max(1, Math.round(generated.length * 0.15));
  return shuffled(generated, rng).slice(0, count);
};

const descentDeadline = (deadline: number, from: number, share: number): number =>
  Math.min(deadline, from + Math.max(0, (deadline - from) * share));

/** Timer-clamp overhead (~1–4 ms per turn) means yielding per iteration would evaporate the
 *  descent budget; a 25 ms slice keeps cancel latency ≲ 100 ms while costing well under 1%. */
const YIELD_SLICE_MS = 25;

/**
 * A shared, time-sliced yield point: hands control back to the event loop (so a pending cancel
 * message is observed and a throttled progress tick fires) only when a slice has elapsed since
 * the previous yield. Created once per generate call and threaded through every attempt so the
 * cadence is global, not per-attempt.
 */
const createYielder = (
  startedAt: number,
  budgetMs: number,
  onProgress?: (progress: GenerationProgress) => void,
): (() => Promise<void>) => {
  let lastYieldAt = startedAt;
  return async (): Promise<void> => {
    const now = Date.now();
    if (now - lastYieldAt < YIELD_SLICE_MS) return;
    lastYieldAt = now;
    onProgress?.({ elapsedMs: now - startedAt, budgetMs });
    await yieldToEventLoop();
  };
};

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
