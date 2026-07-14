import type { Cohort } from "@/shared/config";
import { cellKey } from "../../../collision/cell-key";
import { type Candidate, compareObjectives, scoreCandidate, SEARCH_TIERS } from "../../objective";
import { mulberry32, pickFrom, shuffled } from "../../rng";
import type {
  GeneratePlan,
  GeneratedPlacement,
  GenerationDiagnostics,
  GenerationProgress,
  GenerationResult,
} from "../../types";
import { verifyGeneration } from "../../verify";
import { createBoard } from "./board";
import { buildProblem, COHORT_ORDER, type Problem } from "./problem";
import {
  type AttemptContext,
  constructBackbone,
  descendSlots,
  migrateHolesToEdges,
  packUsedCells,
  placeFlagged,
  repairStragglers,
  spill,
} from "./stages";

/**
 * The GRASP/LNS search driver. Phase A runs a few diversified constructive attempts; Phase B is
 * large-neighborhood search (destroy a slice of the incumbent, repair it, accept only tuple
 * improvements) until the budget, the cancel signal, or a stagnation window on a converged board;
 * Phase C spends the tail of the budget polishing the shape tiers under a no-regression guard.
 * Each attempt builds a fresh `Board` and is scored by the engine-agnostic objective; the best board
 * by the objective tiers wins. The caller re-judges the result via `verifyGeneration` regardless.
 *
 * B and C differ only in which tiers *steer*: B compares the first {@link SEARCH_TIERS} (through
 * studentHoles), C the full tuple. That split is not cosmetic — see `SEARCH_TIERS` for the measured
 * completeness and slot regressions that come of letting the cheap shape moves drive the walk.
 */

/** Attempt descent share — reduced from the pre-LNS 0.4 since destroy-and-repair now owns the polish. */
const ATTEMPT_DESCENT_SHARE = 0.1;
/** Fixed seed for the LNS operator PRNG — one stream across all rounds keeps the loop deterministic. */
const LNS_SEED = 9973;
/** Two randomized restarts in three reserve a day-edge cell per cohort up front (a smaller target). */
const RESERVATION_RATE = 0.67;

/** Default constructive attempts for diversification before LNS takes over the polish (attempt 1 + 2 noisy). */
const DEFAULT_DIVERSIFY_ATTEMPTS = 3;
/** Default stagnation window: stop early once complete + hole-free and no LNS round improved for this long. */
const DEFAULT_STAGNATION_MS = 2_500;
/** Tail of the budget reserved for shape polish (phase C) — and where a converged, stagnant phase B
 *  spends what it would otherwise return unused. */
const SHAPE_POLISH_SHARE = 0.15;

/**
 * The two wall-clock search knobs, injectable so tests and the bench can shrink (or extend) the
 * solve windows without stubbing `Date.now` — the engine keeps time with the real clock throughout,
 * so tuning the windows is the only lever. Omitting a field restores the shipped default, and
 * `createGreedyEngine()` with no argument is bit-identical to the pre-factory engine.
 */
export type GreedyTuning = {
  /** Stop window once complete + hole-free (default 2_500 ms). */
  stagnationMs?: number;
  /** Constructive attempts in Phase A (default 3). */
  diversifyAttempts?: number;
};

/**
 * Build a `GeneratePlan` engine over the shipped GRASP/LNS search, with the two search windows
 * bound at construction. The returned closure is a plain port — no consumer sees the tuning.
 *
 * Precondition: the engine assumes a pins-only, conflict-free snapshot — index integrity and the
 * "constructed board is always valid" fallback floor both depend on it, and the engine does NOT
 * re-check it. Call through `runVerifiedGeneration` (which owns precondition → engine → verdict) or
 * run the same precondition first; a raw engine call on a dirty snapshot can return an invalid board.
 */
export const createGreedyEngine = (tuning: GreedyTuning = {}): GeneratePlan => {
  const stagnationMs = tuning.stagnationMs ?? DEFAULT_STAGNATION_MS;
  const diversifyAttempts = tuning.diversifyAttempts ?? DEFAULT_DIVERSIFY_ATTEMPTS;

  return async (snapshot, config, hooks = {}) => {
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
      tiers: SEARCH_TIERS,
    });
    for (let seed = 2; seed <= diversifyAttempts && !stopped(); seed++) {
      await maybeYield();
      if (stopped()) break;
      const candidate = await runAttempt(problem, {
        seed,
        noise: 1,
        descentUntil: descentDeadline(deadline, Date.now(), ATTEMPT_DESCENT_SHARE),
        stopped,
        maybeYield,
        tiers: SEARCH_TIERS,
      });
      if (compareObjectives(candidate.objective, best.objective, SEARCH_TIERS) < 0) best = candidate;
    }

    // Phases B and C — LNS: destroy a slice of the incumbent and repair it, accepting only tuple
    // improvements; alternate the destroy operator each round. B steers by the search tiers alone; the
    // budget's tail (C) opens the shape tiers, and a converged, stagnant B hands its leftover time
    // straight over rather than returning it unspent. C stops on its own stagnation window, so an easy
    // instance still finishes early.
    const lnsRng = mulberry32(LNS_SEED);
    let lastImproveAt = Date.now();
    let polishFrom = deadline - config.budgetMs * SHAPE_POLISH_SHARE;
    for (let round = 1; !stopped(); round++) {
      await maybeYield();
      if (stopped()) break;
      const polishing = Date.now() >= polishFrom;
      if (isConverged(best) && Date.now() - lastImproveAt >= stagnationMs) {
        if (polishing) break;
        polishFrom = Date.now(); // converged early — spend the rest of the budget on shape
        lastImproveAt = Date.now();
      }
      const candidate = await runAttempt(problem, {
        seed: 0,
        noise: 1,
        descentUntil: Date.now(), // no spin — one productive descent pass per LNS round
        stopped,
        maybeYield,
        tiers: polishing ? FULL_TIERS : SEARCH_TIERS,
        lns: { incumbent: best, destroy: destroyFor(round, best), rng: lnsRng },
      });
      if (compareObjectives(candidate.objective, best.objective, polishing ? FULL_TIERS : SEARCH_TIERS) < 0) {
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
};

/** The shipped default-tuned engine — the instance every app consumer uses. */
export const generatePlanGreedy: GeneratePlan = createGreedyEngine();

/** A board LNS can stop polishing: complete (nothing unplaced) and free of interior holes. */
const isConverged = (candidate: Candidate): boolean => candidate.objective[0] === 0 && candidate.objective[1] === 0;

/** One LNS round's inputs: the incumbent to repair, which destroy operator to apply, and the
 *  shared operator PRNG (so successive rounds diverge deterministically). */
type LnsRound = { incumbent: Candidate; destroy: DestroyOperator; rng: () => number };

/**
 * The destroy operators, cycled round-robin. **An objective tier can only *filter* the boards the
 * neighbourhood produces** — a tier whose improving moves the neighbourhood never generates is close
 * to inert. So the tiers that need their own moves have an operator aimed at them: `teacher` frees
 * one teacher's day across BOTH cohorts so the repair can re-seat it compactly (tiers 4–5 — and with
 * them the soft-availability hits hiding in the same rows), while `day` and `random` are the coarse
 * and fine general moves everything else rides on. Without the teacher operator the teacher tier
 * barely moved the real board (246 gap-slots): the rows it wanted relocated were never the ones
 * destroy happened to pick.
 *
 * The cycle is deliberately 4 cell-shaped rounds to 1 people-shaped one, mirroring the tuple's own
 * priorities: completeness and the slot count outrank teacher compactness, so the neighbourhood must
 * not spend its budget on a tier that can never outbid them. A flat 1-in-3 teacher cadence measurably
 * cost slots and completeness on the seed catalog for teacher gains the tuple ranks below both — and
 * so, later, did merely *lengthening* this cycle (dp2 46 → 47 slots). The cadence is load-bearing.
 */
const DESTROY_OPERATORS = ["random", "day", "random", "day", "teacher"] as const;

/** Rounds between deficit-shaped destroys, while (and only while) the incumbent owes hours. */
const DEFICIT_EVERY = 3;

/**
 * The round's destroy operator: the cycle above, except that every {@link DEFICIT_EVERY}-th round of
 * an *incomplete* incumbent goes to `deficit`, which clears what blocks one unplaced course out of one
 * cell (tier 1). It is the completing move's operator, and the shape tiers made it necessary: they
 * pack the board tighter — doubles, P1 starts, a short Friday — until a blind repair can no longer
 * find room for the hour the board still owes, which cost the seed catalog's dp1 a whole hour it had
 * been placing before. Aiming a destroy at the unplaced course keeps that hour reachable.
 *
 * It substitutes rather than joining the cycle, and only under a deficit, because the cadence is
 * load-bearing: simply making the cycle one round longer cost dp2 a slot — a tier the completing move
 * ranks above, but which a complete board never needs this operator to defend.
 */
const destroyFor = (round: number, incumbent: Candidate): DestroyOperator =>
  incumbent.objective[0] > 0 && round % DEFICIT_EVERY === 0
    ? "deficit"
    : DESTROY_OPERATORS[round % DESTROY_OPERATORS.length];

type DestroyOperator = (typeof DESTROY_OPERATORS)[number] | "deficit";

/** Every tier — phase C's acceptance. `compareObjectives` clamps to the tuple's own length. */
const FULL_TIERS = Number.POSITIVE_INFINITY;

type AttemptOptions = {
  /** Attempt seed (1 = deterministic first board); ignored in LNS mode. */
  seed: number;
  /** Rank noise: 0 for the deterministic first attempt, 1 for restarts and LNS repair. */
  noise: number;
  descentUntil: number;
  stopped: () => boolean;
  maybeYield: () => Promise<void>;
  /** Tiers this round steers by — {@link SEARCH_TIERS} while searching, {@link FULL_TIERS} while
   *  polishing. The attempt's own construction-vs-descent choice reads the same tiers as the
   *  acceptance test that will judge its output, so the two can never pull in opposite directions. */
  tiers: number;
  /** When set, rebuild-and-repair this incumbent instead of constructing from scratch (skips the backbone). */
  lns?: LnsRound;
};

/**
 * One attempt: seed the per-attempt context, build a fresh board (loading pins + deficits, or
 * rehydrating and partially destroying the LNS incumbent), run construction, score it, then run
 * descent + migration and return whichever board scores better (and is valid). Construction is
 * scored against a COPY so the pre-descent board survives the comparison — an attempt is
 * improve-or-neutral, never worse than its own constructive checkpoint.
 */
const runAttempt = async (problem: Problem, opts: AttemptOptions): Promise<Candidate> => {
  const { seed, noise, descentUntil, stopped, maybeYield, tiers, lns } = opts;
  const { snapshot, backbones } = problem;
  const { days, periods } = snapshot;
  const rng = lns ? lns.rng : mulberry32(seed);
  const backbone: Record<Cohort, Set<string>> = {
    dp1: pickFrom(backbones.dp1, rng),
    dp2: pickFrom(backbones.dp2, rng),
  };
  // Two randomized restarts in three reserve a day-edge cell per cohort up front, so the constructive
  // pass targets a smaller board instead of relying on descent alone. LNS repairs an existing board,
  // so it never reserves.
  const reserved: Record<Cohort, Set<string>> = {
    dp1: !lns && seed > 1 && rng() < RESERVATION_RATE ? sampleEdgeCell(days, periods, rng) : new Set(),
    dp2: !lns && seed > 1 && rng() < RESERVATION_RATE ? sampleEdgeCell(days, periods, rng) : new Set(),
  };
  // Attempt 1 keeps the deterministic dp1-first order; every other attempt and all LNS rounds
  // randomize which cohort is packed first (a cheap diversification the old loop lacked).
  const cohortOrder: Cohort[] = !lns && seed === 1 ? [...COHORT_ORDER] : shuffled(COHORT_ORDER, rng);
  const ctx: AttemptContext = { rng, noise, backbone, reserved, cohortOrder, descentUntil, stopped, maybeYield };

  const board = createBoard(problem);
  for (const cohort of COHORT_ORDER) {
    for (const deficit of problem.deficits[cohort]) board.remaining.set(deficit.courseId, deficit.missing);
    for (const pin of snapshot.cohorts[cohort].pins) {
      board.place(cohort, pin.courseId, pin.day, pin.period, pin.week, true);
    }
  }

  // LNS rebuild: re-index the incumbent's generated rows (pins are already indexed above), adopt its
  // `remaining`, then destroy a slice — the removed hours flow back into `remaining` for the repair
  // stages (2–5) to re-place. The whole round runs on this working copy; a reject just discards it.
  if (lns) {
    board.remaining.clear();
    for (const [courseId, missing] of lns.incumbent.remaining) board.remaining.set(courseId, missing);
    for (const row of lns.incumbent.placements) board.place(row.cohort, row.courseId, row.day, row.period, row.week);
    for (const row of destroyTargets(lns, problem, board.placements, rng)) {
      board.evict(row.cohort, row.courseId, row.day, row.period, row.week);
      board.remaining.set(row.courseId, (board.remaining.get(row.courseId) ?? 0) + 1);
    }
  }

  if (!lns) constructBackbone(board, problem, ctx); // stage 1 (construction only)
  packUsedCells(board, problem, ctx); // stage 2
  repairStragglers(board, problem, ctx); // stage 3
  placeFlagged(board, problem, ctx); // stage 4
  spill(board, problem, ctx); // stage 5

  // Checkpoint: construction (stages 1–5) is complete and valid. Score against a COPY (stages 6–7
  // mutate the placements in place; `remaining` is untouched by them) so it survives the comparison.
  const constructed = scoreCandidate(snapshot, board.placements.slice(), board.remaining);

  await descendSlots(board, problem, ctx); // stage 6
  migrateHolesToEdges(board, problem, ctx); // stage 7

  // Accept the descended board only when it beats construction AND is itself valid. Descent's
  // ejection-chain rollback is not re-validated, so a chain that fails after relocating a slice can
  // (in rare configurations) leave a flagged course boxed; re-judging here upholds the engine's hard
  // invariant — never emit a board the oracle rejects — with construction as the always-valid floor.
  // A no-op on any valid descended board, so default-tuned output is unchanged.
  const descended = scoreCandidate(snapshot, board.placements, board.remaining);
  const preferDescended = compareObjectives(descended.objective, constructed.objective, tiers) <= 0;
  if (preferDescended && verifyGeneration(snapshot, descended.placements).ok) return descended;
  return constructed;
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

/** One randomly chosen day-edge cell (period 1 or last of some day), as a singleton set. */
const sampleEdgeCell = (days: number, periods: number, rng: () => number): Set<string> => {
  const edges: string[] = [];
  for (let d = 1; d <= days; d++) edges.push(cellKey(d, 1), cellKey(d, periods));
  return new Set([pickFrom(edges, rng)]);
};

/**
 * The generated rows an LNS destroy operator removes (references into `generated`): a whole random
 * `(cohort, day)` for `"day"`, one random teacher's whole day across BOTH cohorts for `"teacher"`,
 * everything standing between an unplaced course and one random cell for `"deficit"`, or a random
 * ~15% slice for `"random"`. Pins are never generated rows, so they are inherently untouched. Cycling
 * the four mixes coarse, people-shaped, deficit-shaped, and fine moves.
 */
const destroyTargets = (
  lns: LnsRound,
  problem: Problem,
  generated: GeneratedPlacement[],
  rng: () => number,
): GeneratedPlacement[] => {
  const { destroy, incumbent } = lns;
  if (destroy === "day") {
    const cohort = pickFrom(COHORT_ORDER, rng);
    const days = [...new Set(generated.filter((row) => row.cohort === cohort).map((row) => row.day))];
    if (days.length === 0) return [];
    const day = pickFrom(days, rng);
    return generated.filter((row) => row.cohort === cohort && row.day === day);
  }
  if (destroy === "teacher") {
    // A teacher's day is one day across both cohorts — destroying it per cohort would leave the
    // sibling half pinning the very gaps the repair is trying to close.
    const teaches = (row: GeneratedPlacement, teacherKey: string): boolean =>
      problem.courseById.get(row.courseId)?.teacherKeys.includes(teacherKey) ?? false;
    const teachers = [...new Set(generated.flatMap((row) => problem.courseById.get(row.courseId)?.teacherKeys ?? []))];
    if (teachers.length === 0) return [];
    const teacher = pickFrom(teachers, rng);
    const days = [...new Set(generated.filter((row) => teaches(row, teacher)).map((row) => row.day))];
    if (days.length === 0) return [];
    const day = pickFrom(days, rng);
    return generated.filter((row) => row.day === day && teaches(row, teacher));
  }
  if (destroy === "deficit") {
    // One unplaced course, one random cell: evict whatever conflicts with it there (the rows sharing
    // a student or a teacher — legitimately in that cell, but not with this course beside them) plus
    // its own hours that day (so the day-split rule cannot veto the fresh, adjacent placement). The
    // freed hours flow back into `remaining` with the missing one, and the repair re-seats them all.
    const deficits = COHORT_ORDER.flatMap((cohort) => incumbent.unplaced[cohort]);
    const course = deficits.length > 0 ? problem.courseById.get(pickFrom(deficits, rng).courseId) : undefined;
    if (!course) return randomSlice(generated, rng); // a complete board — nothing to aim at
    const conflicts = (row: GeneratedPlacement): boolean => {
      const other = problem.courseById.get(row.courseId);
      if (!other) return false;
      return (
        other.teacherKeys.some((t) => course.teacherKeys.includes(t)) ||
        other.studentKeys.some((s) => course.studentKeys.includes(s))
      );
    };
    const { d, p } = pickFrom(problem.cellOrder, rng);
    return generated.filter((row) =>
      row.courseId === course.id ? row.day === d : row.day === d && row.period === p && conflicts(row),
    );
  }
  return randomSlice(generated, rng);
};

/** A random ~15% of the generated rows (at least one) — the fine-grained default neighbourhood. */
const randomSlice = (generated: GeneratedPlacement[], rng: () => number): GeneratedPlacement[] =>
  shuffled(generated, rng).slice(0, Math.max(1, Math.round(generated.length * 0.15)));

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
