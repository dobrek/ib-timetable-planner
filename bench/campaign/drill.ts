import type { CellTuning } from "../campaign-cell.ts";
import type { CampaignCell } from "./definition.ts";
import type { Attempt, CampaignState, DrillFact, JournalAction, PendingIntent } from "./journal.ts";

/**
 * The attended deploy-during-solve drill (S-308 Phase 3), as one pure function of the journal: what
 * the drill does next. `main.ts` performs each step; nothing here touches the network.
 *
 *   1. apply the 240 s cell — apply, stop, watch it stop — and dispatch the drill solve
 *   2. wait for a checkpoint at ladder position 3 or later
 *   3. an image-changing commit, built and deployed from this machine (`wrangler deploy`)
 *   4. wait for the row: it must end `interrupted`, its checkpoint intact
 *   5. read the shutdown pair from the container's lines
 *   6. deliver the proposal — the checkpoint board lands
 *   7. the proposal page renders the halted-board label for that position
 *   8. dispatch again, still under the 240 s cell: the self-heal, which IS Cell C run 1
 *   9. while it runs, switch the secret to Cell A — the secret only, no stop — and record whether the
 *      solve survives it; the stop behaviour reads that observation
 *  10. print the push command for the drill commit — pushing is the human's, once nothing solves
 *
 * The drill uses the 240 s cell because at 120 s the ladder ends before a CI deploy plus the 1200 s
 * rollout grace would land (research §7); deploying from this machine also takes CI out of the timing.
 */
export type DrillStep =
  | { readonly kind: "act"; readonly action: JournalAction; readonly reconcile: PendingIntent | null }
  | { readonly kind: "await-checkpoint"; readonly jobId: string }
  | { readonly kind: "deploy"; readonly jobId: string }
  | { readonly kind: "resume-deploy"; readonly jobId: string; readonly commit: string; readonly versionBefore: string }
  | { readonly kind: "read-shutdown"; readonly jobId: string }
  | { readonly kind: "check-label"; readonly jobId: string; readonly proposalPlanId: string }
  | { readonly kind: "observe-secret-change"; readonly jobId: string; readonly disturbed: boolean }
  | { readonly kind: "print-push" }
  | { readonly kind: "halt"; readonly reason: string }
  | { readonly kind: "done" };

/** The ladder position a checkpoint must reach before the deploy is worth sending. */
export const DRILL_MIN_CHECKPOINT = 3;

export const nextDrillStep = (state: CampaignState, cellC: CampaignCell, cellA: CellTuning): DrillStep => {
  if (state.pending !== null) return { kind: "act", action: state.pending.action, reconcile: state.pending };
  const drill = state.attempts.find((attempt) => attempt.cell === "drill");
  if (drill === undefined) return prepareDrill(state, cellC);
  if (drill.jobId === null) return halt(`the drill dispatch failed: ${drill.verdict?.reason ?? "?"}`);

  const checkpoint = fact(state, "checkpoint");
  const deployed = fact(state, "deployed");
  if (deployed === undefined) {
    // A deploy interrupted after its commit is settled from the live version — never with a second
    // marker, which would roll the container again. Before the row's end, too: it may be what ended it.
    const started = fact(state, "deploy-started");
    if (started !== undefined) {
      return {
        kind: "resume-deploy",
        jobId: drill.jobId,
        commit: started.commit,
        versionBefore: started.versionBefore,
      };
    }
    if (drill.terminal !== null) {
      return halt(
        `the drill solve ended ${drill.terminal.status} before the deploy — nothing was interrupted; dispatch a new drill`,
      );
    }
    return checkpoint === undefined
      ? { kind: "await-checkpoint", jobId: drill.jobId }
      : { kind: "deploy", jobId: drill.jobId };
  }
  if (drill.terminal === null) return act({ kind: "await-terminal", jobId: drill.jobId });
  if (drill.terminal.status !== "interrupted") {
    return halt(`the deploy did not interrupt the drill solve: it ended ${drill.terminal.status}`);
  }
  if (fact(state, "shutdown") === undefined) return { kind: "read-shutdown", jobId: drill.jobId };
  if (drill.delivered === null)
    return act({ kind: "deliver", jobId: drill.jobId, proposalPlanId: drill.proposalPlanId });
  const label = fact(state, "label");
  if (label === undefined) {
    if (drill.proposalPlanId === null) return halt("the drill's proposal is gone, so its label cannot be checked");
    return { kind: "check-label", jobId: drill.jobId, proposalPlanId: drill.proposalPlanId };
  }
  if (!label.found) return halt(`the proposal page did not render "kept the board from stage ${label.position} of 10"`);
  if (drill.verdict === null) return act({ kind: "record", jobId: drill.jobId });

  return selfHealStep(state, cellA);
};

/**
 * What the drill must have before it starts: Docker for the local build, a clean tree AT origin/main
 * so the deploy ships exactly what `main` holds plus the marker, the image pre-built so the deploy is
 * minutes rather than a cold build, and no job solving anywhere.
 */
export type DrillPreconditions = {
  readonly dockerRunning: boolean;
  readonly treeClean: boolean;
  readonly atOriginMain: boolean;
  readonly imagePrebuilt: boolean;
  readonly activeJobs: number;
};

export const drillProblems = (checks: DrillPreconditions): string[] =>
  [
    checks.dockerRunning ? null : "Docker is not running — `wrangler deploy` builds the image locally",
    checks.treeClean ? null : "the working tree is not clean",
    checks.atOriginMain ? null : "HEAD is not origin/main — the deploy must ship exactly main plus the drill marker",
    checks.imagePrebuilt ? null : "the image is not pre-built — run `mise run solver:image:build` first",
    checks.activeJobs === 0 ? null : `${checks.activeJobs} job(s) are solving — the drill deploys`,
  ].filter((problem): problem is string => problem !== null);

/**
 * The halted-board label the proposal page server-renders (`GenerationStatusStrip.tsx` `haltedSummary`):
 * "Interrupted — kept the board from stage N of 10." Matched on the position, not copied whole, so a
 * rewording elsewhere in the sentence does not fail the drill.
 */
export const haltedLabelPattern = (position: number): RegExp =>
  new RegExp(`Interrupted\\s+—\\s+kept the board from stage ${position} of \\d+`);

// --- steps ----------------------------------------------------------------------------------------

/** Step 1: the cell's full sequence — apply, stop, watch it stop — then the drill's own dispatch. */
const prepareDrill = (state: CampaignState, cellC: CampaignCell): DrillStep => {
  if (state.override?.cell !== "C") return act({ kind: "apply-cell", cell: "C", tuning: cellC.tuning });
  if (!state.stopIssued) return act({ kind: "stop-container" });
  if (!state.containerReady) return act({ kind: "await-stopped" });
  return act({ kind: "dispatch", cell: "drill", slot: 1, attempt: 1 });
};

/** Steps 8–10: the self-heal run (Cell C run 1), the secret change under it, and the push. */
const selfHealStep = (state: CampaignState, cellA: CellTuning): DrillStep => {
  const selfHeal = state.attempts.find((attempt) => attempt.cell === "C" && attempt.slot === 1);
  // No stop first: the deploy replaced the container, so this dispatch is a cold start under Cell C.
  if (selfHeal === undefined) return act({ kind: "dispatch", cell: "C", slot: 1, attempt: 1 });
  if (selfHeal.jobId === null) return halt(`the self-heal dispatch failed: ${selfHeal.verdict?.reason ?? "?"}`);
  if (selfHeal.terminal === null) {
    return secretChanged(state)
      ? act({ kind: "await-terminal", jobId: selfHeal.jobId })
      : act({ kind: "apply-cell", cell: "A", tuning: cellA, duringSolve: true });
  }
  if (selfHeal.delivered === null)
    return act({ kind: "deliver", jobId: selfHeal.jobId, proposalPlanId: selfHeal.proposalPlanId });
  if (selfHeal.verdict === null) return act({ kind: "record", jobId: selfHeal.jobId });
  if (state.secretChangeDisturbsSolve === null) {
    return { kind: "observe-secret-change", jobId: selfHeal.jobId, disturbed: disturbed(selfHeal) };
  }
  return fact(state, "push-printed") === undefined ? { kind: "print-push" } : { kind: "done" };
};

/** Whether Cell A's secret went out while the self-heal ran — the journal's override says so. */
const secretChanged = (state: CampaignState): boolean => state.override?.cell === "A";

/** A solve the secret change left alone ends `succeeded`; anything else counts as disturbed. */
const disturbed = (attempt: Attempt): boolean => attempt.terminal?.status !== "succeeded";

const fact = <K extends DrillFact["kind"]>(
  state: CampaignState,
  kind: K,
): Extract<DrillFact, { kind: K }> | undefined =>
  state.drillFacts.find((candidate): candidate is Extract<DrillFact, { kind: K }> => candidate.kind === kind);

const act = (action: JournalAction): DrillStep => ({ kind: "act", action, reconcile: null });

const halt = (reason: string): DrillStep => ({ kind: "halt", reason });
