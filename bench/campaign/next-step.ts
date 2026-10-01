import type { CampaignCell } from "./definition.ts";
import { gridFor, MAIN_CELL, RUNS_PER_CELL } from "./definition.ts";
import type { Attempt, CampaignState, JournalAction, PendingIntent } from "./journal.ts";
import { openAttempt } from "./journal.ts";

/**
 * Every decision the runner makes, as one pure function of the journal's derived state — so it is
 * unit-tested here and identical in the local rehearsal and on production.
 *
 * The order of the checks is the design:
 *
 *   1. a trailing intent is reconciled before anything else, because acting on top of an action whose
 *      outcome is unknown is how a second solve gets dispatched;
 *   2. a run in flight is finished — waited for, delivered, recorded — before the grid moves;
 *   3. a refused stop halts until a human resumes;
 *   4. then the next run slot: apply its cell if it is not the live override, stop the container and
 *      watch it go down, and only then dispatch. The stop is not optional. A secret change resets the
 *      Durable Object, whose constructor re-arms the sleep timer, so a warm container keeps solving
 *      under the OLD cell for up to a full `sleepAfter` — and `envVars` is read only at a real start.
 *
 * Failure policy, per run slot: a run that does not count is retried once (after the same stop, since
 * a stale container is one way to get a wrong-cell run); a second bad outcome halts. A human `resume`
 * forgives the failures before it.
 */
export type Step =
  | { readonly kind: "act"; readonly action: JournalAction; readonly reconcile: PendingIntent | null }
  | { readonly kind: "needs-setup" }
  | { readonly kind: "pause"; readonly reason: "choose-cell-d" }
  | { readonly kind: "halt"; readonly reason: string }
  | { readonly kind: "done" };

export const nextStep = (state: CampaignState): Step => {
  if (state.pending !== null) return { kind: "act", action: state.pending.action, reconcile: state.pending };
  if (state.setup === null) return { kind: "needs-setup" };
  const open = openAttempt(state);
  if (open !== undefined) return continueAttempt(open);
  if (state.stopRefused !== null) {
    return halt(`the container refused to stop (${state.stopRefused}) — find out what is solving, then \`resume\``);
  }
  const target = nextTarget(state, gridFor(state.setup.target, state.cellD));
  if (target.kind === "run") return prepare(state, target);
  if (target.kind === "halt") return target;
  // Production must not sit on campaign budgets while a human chooses Cell D, possibly overnight.
  if (state.override !== null) return act({ kind: "park" });
  return state.cellD === null ? { kind: "pause", reason: "choose-cell-d" } : { kind: "done" };
};

/**
 * The strict cleanup order. The ledger is extracted and copied BEFORE this runs (`cleanup` refuses
 * otherwise), because deleting the campaign plan cascades every job row the ledger was read from.
 *
 *   1. deliver every proposal, so the delete guards release the halted-but-undelivered ones;
 *   2. delete each proposal by id — they share a name, and the runner's own record is the only list;
 *   3. delete the campaign plan, taking the job rows with it;
 *   4. remove the override.
 */
export const cleanupStep = (state: CampaignState): Step => {
  if (state.pending !== null) return { kind: "act", action: state.pending.action, reconcile: state.pending };
  if (state.setup === null) return { kind: "done" };
  const inFlight = state.attempts.find((attempt) => attempt.jobId !== null && attempt.terminal === null);
  if (inFlight !== undefined) return halt(`job ${inFlight.jobId ?? "?"} is still solving — let it finish first`);

  const proposals = [
    ...new Set(state.attempts.map((attempt) => attempt.proposalPlanId).filter((id): id is string => id !== null)),
  ];
  const undelivered = proposals.find((id) => !state.cleanedUp.delivered.includes(id));
  if (undelivered !== undefined) return act({ kind: "cleanup-deliver", proposalPlanId: undelivered });
  const undeleted = proposals.find((id) => !state.cleanedUp.deleted.includes(id));
  if (undeleted !== undefined) return act({ kind: "delete-plan", planId: undeleted, role: "proposal" });
  if (!state.cleanedUp.deleted.includes(state.setup.campaignPlanId)) {
    return act({ kind: "delete-plan", planId: state.setup.campaignPlanId, role: "campaign" });
  }
  return state.override !== null ? act({ kind: "park" }) : { kind: "done" };
};

/** Whether every grid cell, including a chosen Cell D, has its three counted runs. */
export const gridComplete = (state: CampaignState): boolean =>
  state.setup !== null &&
  state.cellD !== null &&
  nextTarget({ ...state, runOneRequests: 0 }, gridFor(state.setup.target, state.cellD)).kind === "grid-done";

// --- the next run slot ----------------------------------------------------------------------------

type Target =
  | { readonly kind: "run"; readonly cell: CampaignCell; readonly slot: number; readonly attempt: number }
  | { readonly kind: "halt"; readonly reason: string }
  | { readonly kind: "grid-done" };

/** The grid's slots in order, then one `main` slot per `run-one` request. */
const nextTarget = (state: CampaignState, grid: readonly CampaignCell[]): Target => {
  const slots = [
    ...grid.flatMap((cell) => Array.from({ length: RUNS_PER_CELL }, (_, index) => ({ cell, slot: index + 1 }))),
    ...Array.from({ length: state.runOneRequests }, (_, index) => ({ cell: MAIN_CELL, slot: index + 1 })),
  ];
  return (
    slots.map(({ cell, slot }) => slotTarget(state, cell, slot)).find((target) => target !== null) ?? {
      kind: "grid-done",
    }
  );
};

/** Null when the slot already has a run that counts. */
const slotTarget = (state: CampaignState, cell: CampaignCell, slot: number): Target | null => {
  const attempts = state.attempts.filter((attempt) => attempt.cell === cell.key && attempt.slot === slot);
  if (attempts.some((attempt) => attempt.verdict?.counts === true)) return null;
  const failures = attempts.filter(
    (attempt) =>
      attempt.verdict?.counts === false && (state.resumedAt === null || attempt.dispatchedAt > state.resumedAt),
  );
  if (failures.length >= 2) {
    return halt(
      `cell ${cell.key} run ${slot} failed twice — ${failures.map((attempt) => attempt.verdict?.reason ?? "?").join("; ")}`,
    );
  }
  return { kind: "run", cell, slot, attempt: attempts.length + 1 };
};

/** Override → stop → watch it go down → dispatch, each its own step so each is journaled. */
const prepare = (state: CampaignState, target: Extract<Target, { kind: "run" }>): Step => {
  const { cell } = target;
  if (cell.key === "main" ? state.override !== null : state.override?.cell !== cell.key) {
    return act(cell.key === "main" ? { kind: "park" } : { kind: "apply-cell", cell: cell.key, tuning: cell.tuning });
  }
  if (!state.stopIssued) return act({ kind: "stop-container" });
  if (!state.containerReady) return act({ kind: "await-stopped" });
  return act({ kind: "dispatch", cell: cell.key, slot: target.slot, attempt: target.attempt });
};

/** Wait for it, deliver it, record it — in that order, and the next run only after. */
const continueAttempt = (attempt: Attempt): Step => {
  if (attempt.jobId === null) return halt("the journal holds an open attempt with no job id");
  if (attempt.terminal === null) return act({ kind: "await-terminal", jobId: attempt.jobId });
  if (attempt.delivered === null) {
    return act({ kind: "deliver", jobId: attempt.jobId, proposalPlanId: attempt.proposalPlanId });
  }
  return act({ kind: "record", jobId: attempt.jobId });
};

const act = (action: JournalAction): Step => ({ kind: "act", action, reconcile: null });

const halt = (reason: string): Extract<Step, { kind: "halt" }> => ({ kind: "halt", reason });
