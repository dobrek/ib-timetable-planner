import type { Cohort, PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { BoardAvailabilityCell } from "../availability-index";
import type { PlannerPlacement } from "../placement";

/**
 * Engine-agnostic contract for automatic plan generation. Every engine implements the
 * `GeneratePlan` port over these shapes; everything downstream (dispatch, apply, review UX)
 * builds against the port, never an engine. Modeled on the app's own domain types
 * (`GroupingCourse`, `PlannerPlacement`) — no parallel shapes (lessons: port the mechanism).
 * All fields are plain, serializable data with no class instances or cycles, so a snapshot
 * crosses a process boundary as-is — today the JSON/HTTP hop to the solver service
 * (`dispatchSolveJob`).
 *
 * These are the IN-APP types. The frozen TS↔Python wire contract is
 * `contracts/generation-wire.schema.json`, and it is deliberately NARROWER in several places
 * (const `engine`, four-field pins, no `stagnation`, no nulls) — see the per-field notes below and
 * `contracts/README.md`. `model/generation/wire.ts` is the projection between the two; changing a
 * shape here without the artifact turns both suites' golden tests red, which is the point.
 */

/** One cohort's generation input: its validation catalog, its board as pins, and parked coverage. */
export type GeneratorCohortSnapshot = {
  courses: GroupingCourse[];
  /** Existing placements — always pins (fill-the-gaps): the generator never moves or removes them.
   *  **Narrower on the wire**: the contract's pin is `{courseId, day, period, week}` only; `id`,
   *  `isOptional` and `bundleId` are caller-local and are dropped by `canonicalizeSnapshot`. */
  pins: PlannerPlacement[];
  /** One entry per parked (shelved) bundle member — a multiset; each entry covers one required
   *  hour of its course, so parked-covered deficits are skipped (author decision). */
  parkedCourseIds: string[];
};

/** The full two-cohort problem snapshot — the generator's only view of the world. */
export type GeneratorSnapshot = {
  days: number;
  periods: number;
  /** Plan-scoped teacher availability, raw cells (engines/verify index them as needed). */
  availability: BoardAvailabilityCell[];
  /** Ids of every course flagged `finishes_early` across BOTH cohorts (side-set, never a
   *  `GroupingCourse` field — mirrors `SharedBoardProps.finishesEarlyByCourseId`). */
  finishesEarlyByCourseId: string[];
  cohorts: Record<Cohort, GeneratorCohortSnapshot>;
};

export type GeneratorConfig = {
  /** Wall-clock solve budget; engines return best-so-far when it elapses. */
  budgetMs: number;
};

/** One generated course-hour — the engine's output unit, pre-persistence (no ids yet). */
export type GeneratedPlacement = {
  cohort: Cohort;
  courseId: string;
  day: number;
  period: number;
  week: PlacementWeek;
};

/** A course's remaining hours the generator must place (already net of pins and parked coverage). */
export type CourseDeficit = {
  courseId: string;
  missing: number;
};

export type GenerationCohortDiagnostics = {
  /** Distinct occupied `(day, period)` cells before generation (pins only). */
  occupiedSlotsBefore: number;
  /** Distinct occupied cells after merging the generated placements. */
  occupiedSlotsAfter: number;
  /** Deficits the engine could not place — the review panel's unplaced list. */
  unplaced: CourseDeficit[];
  /** Provable lower bound on this cohort's occupied slots (max-weight conflict clique, in hours).
   *  Additive/optional: consumers that predate it ignore it. `occupiedSlotsAfter ≥ lowerBound`
   *  holds only when the cohort is fully placed (`unplaced` empty); on an infeasible instance the
   *  engine may seat fewer hours than the clique bound, so a consumer must clamp before rendering.
   *  On the wire it is an integer, OMITTED when absent — `"lowerBound": null` is not legal. */
  lowerBound?: number;
};

export type GenerationDiagnostics = {
  /** Engine identifier (e.g. `cp-sat`, `greedy`) for the summary panel and benchmark reports.
   *  **Wider than the wire**: `contracts/generation-wire.schema.json` pins `engine` to the constant
   *  `"cp-sat"`, the sole producer that crosses the TS↔Python boundary. `"greedy"` is in-app only,
   *  and disappears with the engine itself (S-309). */
  engine: string;
  elapsedMs: number;
  /** True when the result is not a full-budget, proven-optimal solve.
   *  **On the wire this is exact**: `partial === !provenOptimal` (CP-SAT's reading, frozen in the
   *  contract). In-app, greedy sets it from `signal.aborted` instead — a second meaning that leaves
   *  with greedy (S-309). Never read it as "was cancelled" without checking `stopReason`. */
  partial: boolean;
  /** Set only by engines that prove optimality (CP-SAT); absent means unknown.
   *  **Required on the wire** — CP-SAT always emits it. */
  provenOptimal?: boolean;
  /** Why the solve ended: `budget` (full budget spent), `stagnation` (complete zero-hole board,
   *  no improvement window), or `cancelled` (Stop & keep). Additive/optional; UI may ignore it.
   *  **Narrower on the wire**: the contract allows `budget | cancelled` only — `stagnation` is a
   *  greedy-only reason and greedy never crosses the wire. */
  stopReason?: "budget" | "stagnation" | "cancelled";
  cohorts: Record<Cohort, GenerationCohortDiagnostics>;
};

export type GenerationResult = {
  placements: GeneratedPlacement[];
  diagnostics: GenerationDiagnostics;
};

export type GenerationProgress = {
  elapsedMs: number;
  budgetMs: number;
};

export type GenerationHooks = {
  /** Throttled progress reporting for the running-state UI. */
  onProgress?: (progress: GenerationProgress) => void;
  /** Cancellation: when aborted the engine resolves (never rejects) with its best-so-far
   *  solution, marked `partial: true` — "Stop & keep" semantics. */
  signal?: AbortSignal;
};

/** The port every engine implements. */
export type GeneratePlan = (
  snapshot: GeneratorSnapshot,
  config: GeneratorConfig,
  hooks?: GenerationHooks,
) => Promise<GenerationResult>;
