import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { cellKey } from "../../../collision/cell-key";
import { shuffled } from "../../rng";
import type { Board, Row } from "./board";
import type { Problem } from "./problem";

/**
 * The construction and descent stages of one attempt, each a pure step over `(board, problem, ctx)`.
 * Stages 1–5 build a complete, valid board; stages 6–7 polish its slot count and day-edge shape.
 * The board mutation hot path stays imperative on purpose — the declarative-pipeline lesson applies
 * to pure selection helpers (`candidatesFor`), not to the eviction-chain bookkeeping below.
 */

/** Per-attempt search state threaded through every stage (the board holds the mutable indexes). */
export type AttemptContext = {
  /** The attempt's PRNG (fresh per constructive attempt; the shared LNS stream during repair). */
  rng: () => number;
  /** Rank noise: 0 for the deterministic first attempt, 1 for restarts and LNS repair. */
  noise: number;
  /** Per cohort: the chosen backbone clique's course ids (stage 1 lays these one-per-cell). */
  backbone: Record<Cohort, Set<string>>;
  /** Per cohort: day-edge cells reserved up front so construction targets a smaller board. */
  reserved: Record<Cohort, Set<string>>;
  /** Cohort packing order (dp1-first on attempt 1, randomized otherwise). */
  cohortOrder: Cohort[];
  /** Wall-clock deadline for the descent spin (stage 6). */
  descentUntil: number;
  stopped: () => boolean;
  maybeYield: () => Promise<void>;
};

/** Candidate rank weights: remaining hours dominate, student count breaks ties, noise diversifies. */
const REMAINING_RANK_WEIGHT = 100;
const NOISE_RANK_WEIGHT = 400;
/**
 * Bonus for a course that already holds the period next door on this day — the doubles preference
 * (objective tier 7), paid for *inside* the placement heuristic rather than out of the search budget.
 * The alternative, letting the shape tiers steer LNS rounds, buys the same doubles by starving the
 * teacher and student tiers the expert ranks above them (measured on the golden catalog: teacher
 * gap-slots 231 → 278). A preference costs nothing: the round would have picked *some* fitting course
 * for this cell anyway, so it may as well pick the one that completes a pair.
 *
 * Sized to outweigh two hours of deficit but not five, and to beat the noise term outright: a
 * near-done course still yields to the course that has four hours left, and the choice stays a
 * preference the higher tiers can overrule — never a rule.
 */
const ADJACENT_RANK_BONUS = 250;
/** Per-course cap on straggler-repair attempts (stage 3) — a termination guard for a stuck chain. */
const REPAIR_ATTEMPTS_CAP = 30;
/** Ejection-chain depth: shallow for straggler repair, one deeper for slot-emptying descent. */
const EJECTION_DEPTH_REPAIR = 2;
const EJECTION_DEPTH_DESCENT = 3;
/** Per round, descent only tries to empty this many least-occupied cells (a work bound per pass). */
const DESCENT_CELL_CAP = 15;

/** Stage 1 — backbone: lay one clique-course hour per cell (construction only, never LNS). */
export const constructBackbone = (board: Board, problem: Problem, ctx: AttemptContext): void => {
  for (const cohort of ctx.cohortOrder) {
    for (const { d, p } of problem.cellOrder) {
      if (ctx.reserved[cohort].has(cellKey(d, p))) continue;
      const clique = candidatesFor(board, problem, cohort, false, ctx).filter((c) => ctx.backbone[cohort].has(c.id));
      for (const course of clique) {
        const week = board.fitsAt(cohort, course, d, p);
        if (week) {
          placeDeficit(board, cohort, course.id, d, p, week);
          break;
        }
      }
    }
  }
};

/** Stage 2 — pack the remainder into already-used cells (pairing courses up where the cell allows). */
export const packUsedCells = (board: Board, problem: Problem, ctx: AttemptContext): void => {
  for (const { d, p } of problem.cellOrder) {
    for (const cohort of ctx.cohortOrder) {
      if (board.rowsAt(cohort, d, p).length === 0) continue;
      for (const course of candidatesFor(board, problem, cohort, false, ctx, { d, p })) {
        const week = board.fitsAt(cohort, course, d, p);
        if (week) placeDeficit(board, cohort, course.id, d, p, week);
      }
    }
  }
};

/** Stage 3 — ejection-chain repair for stragglers (used cells only). */
export const repairStragglers = (board: Board, problem: Problem, ctx: AttemptContext): void => {
  for (const cohort of ctx.cohortOrder) {
    for (const course of candidatesFor(board, problem, cohort, false, ctx)) {
      let guard = 0;
      while ((board.remaining.get(course.id) ?? 0) > 0 && guard < REPAIR_ATTEMPTS_CAP) {
        guard += 1;
        if (!chainFit(board, problem, ctx, cohort, course, undefined, EJECTION_DEPTH_REPAIR, new Set([course.id]))) {
          break;
        }
        board.remaining.set(course.id, (board.remaining.get(course.id) ?? 0) - 1);
      }
    }
  }
};

/** Stage 4 — flagged courses: edge of every enrolled student's day, or left unplaced. */
export const placeFlagged = (board: Board, problem: Problem, ctx: AttemptContext): void => {
  for (const cohort of ctx.cohortOrder) {
    for (const course of candidatesFor(board, problem, cohort, true, ctx).filter((c) => problem.flagged.has(c.id))) {
      while ((board.remaining.get(course.id) ?? 0) > 0) {
        const spot = [...board.usedCells(cohort), ...problem.cellOrder].find(
          ({ d, p }) => board.fitsAt(cohort, course, d, p) !== null,
        );
        if (!spot) break;
        const week = board.fitsAt(cohort, course, spot.d, spot.p);
        if (!week) break;
        placeDeficit(board, cohort, course.id, spot.d, spot.p, week);
      }
    }
  }
};

/** Stage 5 — spill: completeness beats the reservation (second pass ignores reserved cells). */
export const spill = (board: Board, problem: Problem, ctx: AttemptContext): void => {
  for (const pass of [false, true]) {
    for (const { d, p } of problem.cellOrder) {
      for (const cohort of ctx.cohortOrder) {
        if (!pass && ctx.reserved[cohort].has(cellKey(d, p))) continue;
        for (const course of candidatesFor(board, problem, cohort, false, ctx, { d, p })) {
          const week = board.fitsAt(cohort, course, d, p);
          if (week) placeDeficit(board, cohort, course.id, d, p, week);
        }
      }
    }
  }
};

/** Stage 6 — slot-count descent: empty the least-occupied cells via ejection chains. */
export const descendSlots = async (board: Board, problem: Problem, ctx: AttemptContext): Promise<void> => {
  // Descent keeps spinning while a pass still empties a cell; once a pass empties nothing it runs only
  // until the wall-clock budget is spent. The two budget checks are irreducible, not a triplicate: the
  // loop guard, and a re-check after `maybeYield` (which awaits, so time can pass mid-iteration).
  const outOfTime = (): boolean => Date.now() >= ctx.descentUntil;
  for (const cohort of ctx.cohortOrder) {
    let emptied = true;
    while ((emptied || !outOfTime()) && !ctx.stopped()) {
      await ctx.maybeYield(); // once per descent outer iteration — the cancel/progress observation point
      if (ctx.stopped() || (!emptied && outOfTime())) break; // the yield may have consumed the budget
      emptied = false;
      const candidates = board
        .usedCells(cohort)
        // A cell with a pinned OR flagged (immovable-in-descent) row can never be fully emptied —
        // its first such member breaks the inner loop — so admitting it just wastes a cap slot.
        .filter(({ d, p }) => board.rowsAt(cohort, d, p).every((r) => !r.pinned && !problem.flagged.has(r.courseId)))
        .sort((a, b) => board.rowsAt(cohort, a.d, a.p).length - board.rowsAt(cohort, b.d, b.p).length)
        .slice(0, DESCENT_CELL_CAP);
      for (const { d, p } of candidates) {
        if (ctx.stopped()) break;
        let stuck = false;
        while (!stuck && board.rowsAt(cohort, d, p).length > 0) {
          const member = board.rowsAt(cohort, d, p)[0];
          const memberCourse = problem.courseById.get(member.courseId);
          if (!memberCourse || member.pinned || problem.flagged.has(member.courseId)) break;
          board.evict(cohort, member.courseId, d, p, member.week);
          const excludeKey = cellKey(d, p);
          if (
            !chainFit(
              board,
              problem,
              ctx,
              cohort,
              memberCourse,
              excludeKey,
              EJECTION_DEPTH_DESCENT,
              new Set([member.courseId]),
            )
          ) {
            board.place(cohort, member.courseId, d, p, member.week);
            stuck = true;
          }
        }
        if (board.rowsAt(cohort, d, p).length === 0) {
          emptied = true;
          break;
        }
      }
    }
  }
};

/** Stage 7 — migrate interior free cells to day edges (whole-cell, same-day) per cohort. */
export const migrateHolesToEdges = (board: Board, problem: Problem, ctx: AttemptContext): void => {
  for (const cohort of ctx.cohortOrder) migrateCohortHoles(board, problem, cohort);
};

/**
 * Rank the cohort's still-unplaced courses: most-remaining first, ties by enrollment, plus noise —
 * and, when the caller names the cell it is filling, a bonus for the courses that would form a double
 * there (see {@link ADJACENT_RANK_BONUS}).
 */
const candidatesFor = (
  board: Board,
  problem: Problem,
  cohort: Cohort,
  includeFlagged: boolean,
  ctx: AttemptContext,
  at?: { d: number; p: number },
): (GroupingCourse & { cohort: Cohort })[] =>
  problem.snapshot.cohorts[cohort].courses
    .filter((c) => (board.remaining.get(c.id) ?? 0) > 0 && (includeFlagged || !problem.flagged.has(c.id)))
    .map((c) => ({
      course: c,
      rank:
        (board.remaining.get(c.id) ?? 0) * REMAINING_RANK_WEIGHT +
        c.studentKeys.length +
        ctx.noise * ctx.rng() * NOISE_RANK_WEIGHT +
        (at && wouldPair(board, cohort, c.id, at) ? ADJACENT_RANK_BONUS : 0),
    }))
    .sort((a, b) => b.rank - a.rank)
    .map(({ course }) => ({ ...course, cohort }));

/** Does the course already hold the period next door on this day — i.e. would this cell pair up? */
const wouldPair = (board: Board, cohort: Cohort, courseId: string, at: { d: number; p: number }): boolean =>
  [at.p - 1, at.p + 1].some((p) => p >= 1 && board.rowsAt(cohort, at.d, p).some((row) => row.courseId === courseId));

/** Place one in-hand hour of a course and decrement its deficit. */
const placeDeficit = (
  board: Board,
  cohort: Cohort,
  courseId: string,
  d: number,
  p: number,
  week: PlacementWeek,
): void => {
  board.place(cohort, courseId, d, p, week);
  board.remaining.set(courseId, (board.remaining.get(courseId) ?? 0) - 1);
};

/**
 * Fit one in-hand hour of `course` into a used cell (≠ `excludeKey`) — first any directly-feasible
 * cell, then by evicting a non-pinned, non-flagged, unvisited member along a depth-bounded chain and
 * re-homing it recursively. Never touches `remaining` (the caller owns the deficit bookkeeping).
 *
 * Reshuffle-on-failure contract: after a recursive `chainFit` succeeds the board may have moved, so
 * the fit is re-checked before placing `course`; on a mismatch the loop `continue`s (the evicted
 * member stays where the recursion put it) rather than rolling it back. Only a member whose recursion
 * FAILED is rolled back to its original cell, leaving the board exactly as it was before the attempt.
 */
const chainFit = (
  board: Board,
  problem: Problem,
  ctx: AttemptContext,
  cohort: Cohort,
  course: GroupingCourse,
  excludeKey: string | undefined,
  depth: number,
  visited: Set<string>,
): boolean => {
  for (const { d, p } of shuffled(board.usedCells(cohort, excludeKey), ctx.rng)) {
    const week = board.fitsAt(cohort, course, d, p);
    if (week) {
      board.place(cohort, course.id, d, p, week);
      return true;
    }
  }
  if (depth === 0) return false;
  for (const { d, p } of shuffled(board.usedCells(cohort, excludeKey), ctx.rng)) {
    for (const member of shuffled(board.rowsAt(cohort, d, p), ctx.rng)) {
      if (member.pinned || problem.flagged.has(member.courseId) || visited.has(member.courseId)) continue;
      const memberCourse = problem.courseById.get(member.courseId);
      if (!memberCourse) continue;
      board.evict(cohort, member.courseId, d, p, member.week);
      if (board.fitsAt(cohort, course, d, p)) {
        visited.add(member.courseId);
        if (chainFit(board, problem, ctx, cohort, memberCourse, excludeKey, depth - 1, visited)) {
          const week = board.fitsAt(cohort, course, d, p); // the chain may have shuffled the board
          if (week) {
            board.place(cohort, course.id, d, p, week);
            return true;
          }
          continue; // shuffled but valid — keep scanning
        }
        visited.delete(member.courseId);
      }
      board.place(cohort, member.courseId, d, p, member.week);
    }
  }
  return false;
};

const migrateCohortHoles = (board: Board, problem: Problem, cohort: Cohort): void => {
  const { days } = problem.snapshot;
  for (let d = 1; d <= days; d++) {
    for (;;) {
      let moved = false;
      const used = board
        .usedCells(cohort)
        .filter((c) => c.d === d)
        .map((c) => c.p);
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
          const members = [...board.rowsAt(cohort, d, edgeP)];
          if (members.length === 0 || members.some((r) => r.pinned)) continue;
          const relocated: Row[] = [];
          let ok = true;
          for (const member of members) {
            const course = problem.courseById.get(member.courseId);
            board.evict(cohort, member.courseId, d, edgeP, member.week);
            if (!course || board.fitsAt(cohort, course, d, freeP) === null) {
              // a member cannot make the move (infeasible OR would box a flagged row) — roll back
              board.place(cohort, member.courseId, d, edgeP, member.week);
              ok = false;
              break;
            }
            board.place(cohort, member.courseId, d, freeP, member.week);
            relocated.push(member);
          }
          if (ok) {
            moved = true;
            break;
          }
          // Exact inverse of the relocation above — undo every member already moved to `freeP`.
          for (const member of relocated) {
            board.evict(cohort, member.courseId, d, freeP, member.week);
            board.place(cohort, member.courseId, d, edgeP, member.week);
          }
        }
        if (moved) break;
      }
      if (!moved) break;
    }
  }
};
