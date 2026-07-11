import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { cellKey } from "../../collision/cell-key";
import { deriveGenerationDeficits } from "../deficits";
import { countOccupiedSlots } from "../occupied-slots";
import type { CourseDeficit, GeneratePlan, GeneratedPlacement, GenerationResult, GeneratorSnapshot } from "../types";

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
export const generatePlanGreedy: GeneratePlan = async (snapshot, config, hooks = {}) => {
  const startedAt = Date.now();
  const deadline = startedAt + config.budgetMs;
  const problem = buildProblem(snapshot);
  const stopped = (): boolean => hooks.signal?.aborted === true || Date.now() >= deadline;

  // Attempt 1 is deterministic (no noise) and gets a generous descent share.
  let best = runAttempt(problem, 1, 0, descentDeadline(deadline, startedAt, 0.4), stopped);
  let seed = 1;
  while (!stopped()) {
    await yieldToEventLoop();
    hooks.onProgress?.({ elapsedMs: Date.now() - startedAt, budgetMs: config.budgetMs });
    if (stopped()) break;
    seed += 1;
    const candidate = runAttempt(problem, seed, 1, descentDeadline(deadline, Date.now(), 0.1), stopped);
    if (candidate.score < best.score) best = candidate;
  }

  return toResult(problem, best, {
    elapsedMs: Date.now() - startedAt,
    partial: hooks.signal?.aborted === true,
  });
};

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
  const nodes = courses.filter((c) => c.hours > 0 && c.weekMode !== "biweekly" && !flagged.has(c.id));
  const conflicts = (a: GroupingCourse, b: GroupingCourse): boolean =>
    a.teacherKeys.some((t) => b.teacherKeys.includes(t)) || a.studentKeys.some((s) => b.studentKeys.includes(s));
  const adjacency = new Map(
    nodes.map((c) => [c.id, new Set(nodes.filter((o) => o.id !== c.id && conflicts(c, o)).map((o) => o.id))]),
  );

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

// ---------------------------------------------------------------------------------------
// One attempt: mutable board state behind pure-feasibility checks
// ---------------------------------------------------------------------------------------

type Row = { courseId: string; week: PlacementWeek; pinned: boolean };

type Candidate = {
  placements: GeneratedPlacement[];
  score: number;
  slots: Record<Cohort, number>;
  unplaced: Record<Cohort, CourseDeficit[]>;
};

const runAttempt = (
  problem: Problem,
  seed: number,
  noise: number,
  descentUntil: number,
  stopped: () => boolean,
): Candidate => {
  const { snapshot, courseById, flagged, strongNo, cellOrder, backbones } = problem;
  const { days, periods } = snapshot;
  const rng = mulberry32(seed);
  const backbone: Record<Cohort, Set<string>> = {
    dp1: pickFrom(backbones.dp1, rng),
    dp2: pickFrom(backbones.dp2, rng),
  };
  // One randomized restart in three reserves a day-edge cell per cohort up front, so the
  // constructive pass targets a smaller board instead of relying on descent alone.
  const reserved: Record<Cohort, Set<string>> = {
    dp1: seed > 1 && rng() < 0.67 ? sampleEdgeCells(days, periods, rng) : new Set(),
    dp2: seed > 1 && rng() < 0.67 ? sampleEdgeCells(days, periods, rng) : new Set(),
  };

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
    if (rows)
      rows.splice(
        rows.findIndex((r) => r.courseId === courseId),
        1,
      );
  };

  for (const cohort of COHORT_ORDER) {
    for (const deficit of problem.deficits[cohort]) remaining.set(deficit.courseId, deficit.missing);
    for (const pin of snapshot.cohorts[cohort].pins) index(cohort, pin.courseId, pin.day, pin.period, pin.week, true);
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

  /** The core's edge rule: strictly interior among *other* courses' periods offends. */
  const edgeOk = (cohort: Cohort, course: GroupingCourse, d: number, p: number, week: PlacementWeek): boolean => {
    for (const w of weeksOf(week)) {
      for (const s of course.studentKeys) {
        const byPeriod = studentAt.get(studentKeyOf(cohort, s, d, w));
        if (!byPeriod) continue;
        const others = [...byPeriod].filter(([, owner]) => owner !== course.id).map(([q]) => q);
        if (others.length === 0) continue;
        if (p > Math.min(...others) && p < Math.max(...others)) return false;
      }
    }
    return true;
  };

  const fitsAt = (cohort: Cohort, course: GroupingCourse, d: number, p: number): PlacementWeek | null => {
    const week = feasibleWeek(cohort, course, d, p);
    if (!week) return null;
    return !flagged.has(course.id) || edgeOk(cohort, course, d, p, week) ? week : null;
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

  // --- stage 1: backbone — one clique-course hour per cell ---------------------------
  for (const cohort of COHORT_ORDER) {
    for (const { d, p } of cellOrder) {
      if (reserved[cohort].has(cellKey(d, p))) continue;
      const clique = candidatesFor(cohort, false).filter((c) => backbone[cohort].has(c.id));
      for (const course of clique) {
        const week = feasibleWeek(cohort, course, d, p);
        if (week) {
          placeDeficit(cohort, course.id, d, p, week);
          break;
        }
      }
    }
  }

  // --- stage 2: pack the remainder into already-used cells --------------------------
  for (const { d, p } of cellOrder) {
    for (const cohort of COHORT_ORDER) {
      if ((cellRows.get(`${cohort}|${cellKey(d, p)}`)?.length ?? 0) === 0) continue;
      for (const course of candidatesFor(cohort, false)) {
        const week = feasibleWeek(cohort, course, d, p);
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
        const evictedAt = generated.findIndex(
          (x) => x.cohort === cohort && x.courseId === member.courseId && x.day === d && x.period === p,
        );
        const evictedRow = generated[evictedAt];
        generated.splice(evictedAt, 1);
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

  for (const cohort of COHORT_ORDER) {
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
  for (const cohort of COHORT_ORDER) {
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
      for (const cohort of COHORT_ORDER) {
        if (!pass && reserved[cohort].has(cellKey(d, p))) continue;
        for (const course of candidatesFor(cohort, false)) {
          const week = feasibleWeek(cohort, course, d, p);
          if (week) placeDeficit(cohort, course.id, d, p, week);
        }
      }
    }
  }

  // --- stage 6: slot-count descent — empty cells via ejection chains ------------------
  for (const cohort of COHORT_ORDER) {
    let emptied = true;
    while ((emptied || Date.now() < descentUntil) && !stopped()) {
      if (!emptied && Date.now() >= descentUntil) break;
      emptied = false;
      const candidates = usedCells(cohort)
        .filter(({ d, p }) => (cellRows.get(`${cohort}|${cellKey(d, p)}`) ?? []).every((r) => !r.pinned))
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
          const at = generated.findIndex(
            (x) => x.cohort === cohort && x.courseId === member.courseId && x.day === d && x.period === p,
          );
          const row = generated[at];
          generated.splice(at, 1);
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
  for (const cohort of COHORT_ORDER) {
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
        const freeP = freeInterior[0];
        for (const edgeP of [lo, hi]) {
          const members = [...(cellRows.get(`${cohort}|${cellKey(d, edgeP)}`) ?? [])];
          if (members.length === 0 || members.some((r) => r.pinned)) continue;
          const relocated: Row[] = [];
          let ok = true;
          for (const member of members) {
            const course = courseById.get(member.courseId);
            unindex(cohort, member.courseId, d, edgeP, member.week);
            if (!course || feasibleWeek(cohort, course, d, freeP) === null) {
              // a member cannot make the move — roll everything back
              index(cohort, member.courseId, d, edgeP, member.week, false);
              ok = false;
              break;
            }
            const at = generated.findIndex(
              (x) => x.cohort === cohort && x.courseId === member.courseId && x.day === d && x.period === edgeP,
            );
            generated.splice(at, 1);
            generated.push({ cohort, courseId: member.courseId, day: d, period: freeP, week: member.week });
            index(cohort, member.courseId, d, freeP, member.week, false);
            relocated.push(member);
          }
          if (ok && !flaggedEdgesHold(cohort)) ok = false;
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
        if (!moved) break;
      }
    }
  }

  function flaggedEdgesHold(cohort: Cohort): boolean {
    return generated.every((x) => {
      if (x.cohort !== cohort || !flagged.has(x.courseId)) return true;
      const course = courseById.get(x.courseId);
      return !course || edgeOk(cohort, course, x.day, x.period, x.week);
    });
  }

  // --- score ---------------------------------------------------------------------------
  return scoreCandidate(problem, generated, remaining);
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
  const score = unplacedTotal * 1_000_000 + holes * 10_000 + totalSlots * 100 + studentHoles;
  return { placements: generated, score, slots, unplaced };
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
  meta: { elapsedMs: number; partial: boolean },
): GenerationResult => ({
  placements: best.placements,
  diagnostics: {
    engine: "greedy",
    elapsedMs: meta.elapsedMs,
    partial: meta.partial,
    cohorts: {
      dp1: {
        occupiedSlotsBefore: problem.slotsBefore.dp1,
        occupiedSlotsAfter: best.slots.dp1,
        unplaced: best.unplaced.dp1,
      },
      dp2: {
        occupiedSlotsBefore: problem.slotsBefore.dp2,
        occupiedSlotsAfter: best.slots.dp2,
        unplaced: best.unplaced.dp2,
      },
    },
  },
});

// ---------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------

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

const sampleEdgeCells = (days: number, periods: number, rng: () => number): Set<string> => {
  const edges: string[] = [];
  for (let d = 1; d <= days; d++) edges.push(cellKey(d, 1), cellKey(d, periods));
  return new Set([pickFrom(edges, rng)]);
};

const descentDeadline = (deadline: number, from: number, share: number): number =>
  Math.min(deadline, from + Math.max(0, (deadline - from) * share));

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
