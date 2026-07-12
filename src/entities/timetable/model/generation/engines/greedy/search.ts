import type { Cohort } from "@/shared/config";
import { cellKey } from "../../../collision/cell-key";
import { type Candidate, compareObjectives, scoreCandidate } from "../../objective";
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
 * improvements) until the budget, the cancel signal, or a stagnation window on a converged board.
 * Each attempt builds a fresh `Board` and is scored by the engine-agnostic objective; the best board
 * by the objective tiers wins. The caller re-judges the result via `verifyGeneration` regardless.
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
      if (isConverged(best) && Date.now() - lastImproveAt >= stagnationMs) break;
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
};

/** The shipped default-tuned engine — the instance every app consumer uses. */
export const generatePlanGreedy: GeneratePlan = createGreedyEngine();

/** A board LNS can stop polishing: complete (nothing unplaced) and free of interior holes. */
const isConverged = (candidate: Candidate): boolean => candidate.objective[0] === 0 && candidate.objective[1] === 0;

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

/**
 * One attempt: seed the per-attempt context, build a fresh board (loading pins + deficits, or
 * rehydrating and partially destroying the LNS incumbent), run construction, score it, then run
 * descent + migration and return whichever board scores better (and is valid). Construction is
 * scored against a COPY so the pre-descent board survives the comparison — an attempt is
 * improve-or-neutral, never worse than its own constructive checkpoint.
 */
const runAttempt = async (problem: Problem, opts: AttemptOptions): Promise<Candidate> => {
  const { seed, noise, descentUntil, stopped, maybeYield, lns } = opts;
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
    for (const row of destroyTargets(lns.destroy, board.placements, rng)) {
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
  const preferDescended = compareObjectives(descended.objective, constructed.objective) <= 0;
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
