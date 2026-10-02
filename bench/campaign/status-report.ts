import { cellKeyOf } from "../campaign-cell.ts";
import type { CampaignCell, CampaignTarget } from "./definition.ts";
import { estimateRunSeconds, gridFor, MAIN_CELL, RUNS_PER_CELL } from "./definition.ts";
import type { Attempt, CampaignState, JournalAction } from "./journal.ts";
import { workerVersionChanged } from "./journal.ts";
import type { Step } from "./next-step.ts";
import { nextStep } from "./next-step.ts";

/**
 * `status`: where the campaign stands, from the journal alone — no network, no credentials, so it is
 * safe to run at any moment (above all while the renewal observation is measuring the idle-sleep
 * boundary, which a call to the control route would disturb).
 */
export const formatStatus = (state: CampaignState, fallbackTarget: CampaignTarget, nowMs: number): string => {
  const target = state.setup?.target ?? fallbackTarget;
  const grid = [...gridFor(target, state.cellD), ...(state.runOneRequests > 0 ? [MAIN_CELL] : [])];
  return [
    `target   ${target}${state.setup === null ? " (not set up — run `setup`)" : ""}`,
    ...(state.setup === null
      ? []
      : [
          `plan     ${state.setup.campaignPlanId} "${state.setup.name}", cloned from ${state.setup.sourcePlanId} with ${state.setup.remainingHours} h to place`,
        ]),
    `override ${overrideLabel(state, nowMs)}`,
    ...(state.pending === null
      ? []
      : [
          `pending  "${describeAction(state.pending.action)}" was interrupted at ${state.pending.at}; \`run\` reconciles it`,
        ]),
    `next     ${describeStep(nextStep(state))}`,
    "",
    ...gridLines(state, grid),
    ...(state.cellD === null
      ? ["D       (not chosen yet — `set-cell D <workers> <stageS> <modeAS>` after the pause)"]
      : []),
    "",
    ...excludedLines(state.attempts),
    ...versionChangedLines(state.attempts),
    remainingLine(state, grid),
  ].join("\n");
};

export const describeStep = (step: Step): string => {
  switch (step.kind) {
    case "act":
      return `${step.reconcile === null ? "" : "reconcile: "}${describeAction(step.action)}`;
    case "needs-setup":
      return "setup";
    case "pause":
      return "pause — choose Cell D from the matrix, then `set-cell D …` and `run`";
    case "halt":
      return `HALT — ${step.reason}`;
    case "done":
      return "done";
  }
};

export const describeAction = (action: JournalAction): string => {
  switch (action.kind) {
    case "setup":
      return `set up "${action.name}" from ${action.sourcePlanId}`;
    case "apply-cell":
      return `apply cell ${action.cell} (${cellKeyOf(action.tuning)})${action.duringSolve === true ? " under the running solve" : ""}`;
    case "park":
      return "park the override";
    case "stop-container":
      return "stop the container if idle";
    case "await-stopped":
      return "wait for the container to stop";
    case "dispatch":
      return `dispatch cell ${action.cell} run ${action.slot}${action.attempt > 1 ? ` (attempt ${action.attempt})` : ""}`;
    case "await-terminal":
      return `wait for job ${action.jobId}`;
    case "deliver":
      return `deliver job ${action.jobId}`;
    case "record":
      return `record job ${action.jobId} in the ledger`;
    case "cleanup-deliver":
      return `deliver proposal ${action.proposalPlanId}`;
    case "delete-plan":
      return `delete ${action.role} plan ${action.planId}`;
  }
};

// --- lines ----------------------------------------------------------------------------------------

/** The journal's override — or, while an apply is open, the one its `secret bulk` may already have set. */
const overrideLabel = (state: CampaignState, nowMs: number): string => {
  const open = state.pending?.action;
  if (open?.kind === "apply-cell")
    return `POSSIBLY cell ${open.cell} — its apply was interrupted; \`run\` reconciles it`;
  return state.override === null
    ? "none (the next cold start gets main's constants)"
    : `cell ${state.override.cell} since ${state.override.since} (${elapsed(state.override.since, nowMs)} ago)`;
};

const gridLines = (state: CampaignState, grid: readonly CampaignCell[]): string[] =>
  grid.map((cell) => {
    const slots = Array.from({ length: cell.key === "main" ? state.runOneRequests : RUNS_PER_CELL }, (_, index) =>
      slotLabel(state.attempts.filter((attempt) => attempt.cell === cell.key && attempt.slot === index + 1)),
    );
    return `${cell.key.padEnd(7)} ${cellKeyOf(cell.tuning).padEnd(16)} ${slots.map((slot) => slot.padEnd(28)).join("")}`.trimEnd();
  });

const slotLabel = (attempts: readonly Attempt[]): string => {
  const counted = attempts.find((attempt) => attempt.verdict?.counts === true);
  const failed = attempts.filter((attempt) => attempt.verdict?.counts === false).length;
  const retried = failed > 0 ? ` (${failed} excluded)` : "";
  if (counted !== undefined) return `valid ${shortId(counted.jobId)}${retried}`;
  const open = attempts.find((attempt) => attempt.verdict === null);
  if (open !== undefined) return `${open.terminal === null ? "solving" : "finishing"} ${shortId(open.jobId)}${retried}`;
  return `pending${retried}`;
};

const excludedLines = (attempts: readonly Attempt[]): string[] => {
  const excluded = attempts.filter((attempt) => attempt.verdict?.counts === false);
  return excluded.length === 0
    ? []
    : [
        "excluded runs:",
        ...excluded.map(
          (attempt) =>
            `  ${attempt.cell} run ${attempt.slot} attempt ${attempt.attempt} (${attempt.jobId ?? "no job"}): ${attempt.verdict?.reason ?? "?"}`,
        ),
        "",
      ];
};

/** A secret change explains a version change (the drill's step 9 is one); anything else is a stray deploy. */
const versionChangedLines = (attempts: readonly Attempt[]): string[] => {
  const changed = attempts.filter(workerVersionChanged);
  return changed.length === 0
    ? []
    : [
        "Worker version changed during:",
        ...changed.map(
          (attempt) =>
            `  ${attempt.cell} run ${attempt.slot} attempt ${attempt.attempt} (${attempt.jobId ?? "no job"}): ${attempt.dispatchVersion} → ${attempt.terminal?.version ?? "?"}`,
        ),
        "",
      ];
};

/** Runs still owed, and what they should cost — Cell D only once it has been chosen. */
const remainingLine = (state: CampaignState, grid: readonly CampaignCell[]): string => {
  const owed = grid.flatMap((cell) =>
    Array.from({ length: cell.key === "main" ? state.runOneRequests : RUNS_PER_CELL }, (_, index) => index + 1)
      .filter(
        (slot) =>
          !state.attempts.some(
            (attempt) => attempt.cell === cell.key && attempt.slot === slot && attempt.verdict?.counts === true,
          ),
      )
      .map(() => estimateRunSeconds(cell.tuning)),
  );
  const expected = owed.reduce((total, run) => total + run.expected, 0);
  const worst = owed.reduce((total, run) => total + run.worst, 0);
  const pendingD = state.cellD === null ? " + Cell D's three runs" : "";
  return `remaining ${owed.length} run(s): expected ${duration(expected)}, worst ${duration(worst)}${pendingD}`;
};

const shortId = (jobId: string | null): string => (jobId === null ? "—" : jobId.slice(0, 8));

const elapsed = (since: string, nowMs: number): string => duration(Math.max(0, (nowMs - Date.parse(since)) / 1000));

const duration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
};
