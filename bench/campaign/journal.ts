import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { CellTuning, HostFingerprint } from "../campaign-cell.ts";
import type { StopOutcome } from "../../src/solver-container-ops.ts";
import type { CampaignCellKey, CampaignTarget } from "./definition.ts";

/**
 * The campaign's write-ahead journal: an append-only JSON-lines file, and the ONLY state the runner
 * keeps. Every action writes an `intent` before it starts and an `outcome` (same `seq`) after it
 * ends; everything the runner knows is derived by replaying the file from the top.
 *
 * That is what lets it survive a closed laptop at any instant. A crash between the two entries
 * leaves a trailing intent with no outcome, which `replay` surfaces as `pending` — and the runner
 * reconciles it rather than repeating it blindly, because one action (a dispatch) is not safe to
 * repeat: a second Generate would be a second solve.
 *
 * The other entries are a human's decisions, recorded once: the Cell D choice, a request for the one
 * run under `main`'s constants, a "resume" after a policy halt, and a lifecycle observation. One is
 * the runner's own: `setup-cloned`, the id a clone came back with, written before anything else can
 * fail, so an interrupted setup knows its plan instead of asking a human to find it.
 */
export type JournalAction =
  | { readonly kind: "setup"; readonly target: CampaignTarget; readonly sourcePlanId: string; readonly name: string }
  | {
      readonly kind: "apply-cell";
      readonly cell: CampaignCellKey;
      readonly tuning: CellTuning;
      /** The drill's step 9: change the secret UNDER a running solve, to observe whether it survives. */
      readonly duringSolve?: boolean;
    }
  | { readonly kind: "park" }
  | { readonly kind: "stop-container" }
  | { readonly kind: "await-stopped" }
  | { readonly kind: "dispatch"; readonly cell: CampaignCellKey; readonly slot: number; readonly attempt: number }
  | { readonly kind: "await-terminal"; readonly jobId: string }
  | { readonly kind: "deliver"; readonly jobId: string; readonly proposalPlanId: string | null }
  | { readonly kind: "record"; readonly jobId: string }
  | { readonly kind: "cleanup-deliver"; readonly proposalPlanId: string }
  | { readonly kind: "delete-plan"; readonly planId: string; readonly role: "proposal" | "campaign" };

export type ActionResult =
  | { readonly kind: "setup"; readonly campaignPlanId: string; readonly remainingHours: number }
  /** Setup produced no campaign plan: nothing to place (the clone was deleted), or — `null` hours — an
   *  interrupted setup the operator abandoned. Either way the campaign is still not set up. */
  | { readonly kind: "setup-refused"; readonly remainingHours: number | null }
  | { readonly kind: "apply-cell" }
  | { readonly kind: "park" }
  | { readonly kind: "stop-container"; readonly outcome: StopOutcome }
  | { readonly kind: "await-stopped" }
  | {
      readonly kind: "dispatch";
      readonly jobId: string;
      readonly proposalPlanId: string | null;
      readonly liveVersion: string;
      /** True when a trailing intent was reconciled by finding the job, not by dispatching again. */
      readonly adopted: boolean;
    }
  | { readonly kind: "dispatch-failed"; readonly error: string; readonly liveVersion: string }
  | { readonly kind: "await-terminal"; readonly status: string; readonly liveVersion: string }
  | { readonly kind: "deliver"; readonly delivered: boolean; readonly status: string }
  /** The ledger row's verdict: `excluded` null when the run counts. */
  | { readonly kind: "record"; readonly excluded: string | null; readonly host: HostFingerprint | null }
  | { readonly kind: "cleanup-deliver" }
  | { readonly kind: "delete-plan" };

export type JournalEntry =
  | { readonly type: "intent"; readonly seq: number; readonly at: string; readonly action: JournalAction }
  | { readonly type: "outcome"; readonly seq: number; readonly at: string; readonly result: ActionResult }
  | { readonly type: "setup-cloned"; readonly seq: number; readonly at: string; readonly planId: string }
  | { readonly type: "set-cell"; readonly at: string; readonly cell: "D"; readonly tuning: CellTuning }
  | { readonly type: "run-one"; readonly at: string }
  | { readonly type: "resume"; readonly at: string }
  | {
      readonly type: "observation";
      readonly at: string;
      readonly key: "secret-change-during-solve";
      readonly disturbed: boolean;
    }
  | { readonly type: "drill"; readonly at: string; readonly fact: DrillFact };

/** What the attended drill established, step by step (Phase 5 §4). Ids and numbers only. */
export type DrillFact =
  /** The drill solve reached a checkpoint at this ladder position — the moment to deploy. */
  | { readonly kind: "checkpoint"; readonly position: number }
  /** The marker commit exists and its deploy is about to go out; the live Worker version before it. */
  | { readonly kind: "deploy-started"; readonly commit: string; readonly versionBefore: string }
  /** The image-changing local deploy went out, as this Worker version. */
  | { readonly kind: "deployed"; readonly commit: string; readonly version: string }
  /** The shutdown pair, read from the container's lines. */
  | { readonly kind: "shutdown"; readonly askedAt: number | null; readonly writtenSeconds: number | null }
  /** The proposal page rendered the halted-board label for this position. */
  | { readonly kind: "label"; readonly position: number; readonly found: boolean }
  | { readonly kind: "push-printed"; readonly commit: string };

/** One dispatched run (or one failed attempt to dispatch it), as the journal tells it. */
export type Attempt = {
  readonly cell: CampaignCellKey;
  readonly slot: number;
  readonly attempt: number;
  readonly dispatchedAt: string;
  readonly jobId: string | null;
  readonly proposalPlanId: string | null;
  readonly dispatchVersion: string;
  readonly terminal: { readonly status: string; readonly version: string } | null;
  readonly delivered: boolean | null;
  /** Null until recorded; then whether the run counts, and why not when it does not. */
  readonly verdict: { readonly counts: boolean; readonly reason: string | null } | null;
};

export type PendingIntent = { readonly seq: number; readonly at: string; readonly action: JournalAction };

export type CampaignState = {
  readonly setup: {
    readonly target: CampaignTarget;
    readonly sourcePlanId: string;
    readonly name: string;
    readonly campaignPlanId: string;
    readonly remainingHours: number;
    readonly at: string;
  } | null;
  readonly cellD: CellTuning | null;
  /** The override the journal says is live; null when parked or never applied. */
  readonly override: { readonly cell: CampaignCellKey; readonly since: string } | null;
  /** A stop under the current override has been asked for and answered (stop / not-running). */
  readonly stopIssued: boolean;
  /** …and `running: false` has been observed since, so the next dispatch is a cold start. */
  readonly containerReady: boolean;
  /** The last stop was refused (`busy` / `unknown`) — a halt until a human resumes. */
  readonly stopRefused: StopOutcome | null;
  readonly attempts: readonly Attempt[];
  readonly pending: PendingIntent | null;
  /** The plan the pending setup's clone created, once its id came back; null while it is unknown. */
  readonly clonedPlanId: string | null;
  readonly lastSeq: number;
  /** The last human `resume`: failures before it no longer count toward a halt. */
  readonly resumedAt: string | null;
  readonly runOneRequests: number;
  /** Phase 5's drill answers this; until then the runner assumes a secret change may disturb a solve. */
  readonly secretChangeDisturbsSolve: boolean | null;
  /** The first host a recorded production row reported — what later runs must match. */
  readonly firstHost: HostFingerprint | null;
  readonly cleanedUp: { readonly delivered: readonly string[]; readonly deleted: readonly string[] };
  readonly drillFacts: readonly DrillFact[];
};

export const EMPTY_STATE: CampaignState = {
  setup: null,
  cellD: null,
  override: null,
  stopIssued: false,
  containerReady: false,
  stopRefused: null,
  attempts: [],
  pending: null,
  clonedPlanId: null,
  lastSeq: 0,
  resumedAt: null,
  runOneRequests: 0,
  secretChangeDisturbsSolve: null,
  firstHost: null,
  cleanedUp: { delivered: [], deleted: [] },
  drillFacts: [],
};

/** Everything the runner knows, from the journal alone. Pure. */
export const replay = (entries: readonly JournalEntry[]): CampaignState => entries.reduce(apply, EMPTY_STATE);

/**
 * The journal's entries. A crash mid-append can leave a truncated LAST line, which is dropped: the
 * intent it began was never acted on. Any other unreadable line is corruption and stops the runner.
 */
export const parseJournal = (text: string): JournalEntry[] => {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return lines.flatMap((line, index) => {
    try {
      return [JSON.parse(line) as JournalEntry];
    } catch (error) {
      if (index === lines.length - 1) return [];
      throw new Error(`journal line ${index + 1} is unreadable: ${String(error)}`, { cause: error });
    }
  });
};

export const readJournal = (path: string): JournalEntry[] =>
  existsSync(path) ? parseJournal(readFileSync(path, "utf8")) : [];

/** One entry, flushed to disk before returning — a write-ahead log is only as good as its fsync. */
export const appendEntry = (path: string, entry: JournalEntry): void => {
  mkdirSync(dirname(path), { recursive: true });
  dropTornTail(path);
  const fd = openSync(path, "a");
  try {
    writeSync(fd, `${JSON.stringify(entry)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

/**
 * A crash mid-append leaves a last line with no newline. Replay already ignores it; the next entry must
 * not be written onto it, or that entry is lost too and the line after it reads as corruption.
 */
const dropTornTail = (path: string): void => {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  if (text === "" || text.endsWith("\n")) return;
  truncateSync(path, Buffer.byteLength(text.slice(0, text.lastIndexOf("\n") + 1)));
};

/** The deployed Worker version moved between this attempt's dispatch and its terminal state. */
export const workerVersionChanged = (attempt: Attempt): boolean =>
  attempt.terminal !== null && attempt.terminal.version !== attempt.dispatchVersion;

/** The one in-flight attempt: dispatched and not yet recorded. At most one exists at a time. */
export const openAttempt = (state: CampaignState): Attempt | undefined =>
  state.attempts.find((attempt) => attempt.verdict === null);

// --- replay ---------------------------------------------------------------------------------------

const apply = (state: CampaignState, entry: JournalEntry): CampaignState => {
  switch (entry.type) {
    case "intent":
      return { ...state, pending: { seq: entry.seq, at: entry.at, action: entry.action }, lastSeq: entry.seq };
    case "outcome":
      return state.pending?.seq === entry.seq
        ? { ...settle(state, state.pending, entry.result, entry.at), pending: null, clonedPlanId: null }
        : state;
    case "setup-cloned":
      return state.pending?.seq === entry.seq && state.pending.action.kind === "setup"
        ? { ...state, clonedPlanId: entry.planId }
        : state;
    case "set-cell":
      return { ...state, cellD: entry.tuning };
    case "run-one":
      return { ...state, runOneRequests: state.runOneRequests + 1 };
    case "resume":
      return { ...state, resumedAt: entry.at, stopRefused: null };
    case "observation":
      return { ...state, secretChangeDisturbsSolve: entry.disturbed };
    case "drill":
      return { ...state, drillFacts: [...state.drillFacts, entry.fact] };
  }
};

/** What an action's outcome changes. Each branch is the one fact that action establishes. */
const settle = (state: CampaignState, intent: PendingIntent, result: ActionResult, at: string): CampaignState => {
  const { action } = intent;
  switch (result.kind) {
    case "setup":
      return action.kind === "setup"
        ? {
            ...state,
            setup: { ...action, campaignPlanId: result.campaignPlanId, remainingHours: result.remainingHours, at },
          }
        : state;
    case "setup-refused":
      return state;
    case "apply-cell":
      return action.kind === "apply-cell"
        ? { ...state, override: { cell: action.cell, since: at }, ...coldStartNeeded }
        : state;
    case "park":
      return { ...state, override: null, ...coldStartNeeded };
    case "stop-container":
      return result.outcome === "stop" || result.outcome === "not-running"
        ? { ...state, stopIssued: true, stopRefused: null }
        : { ...state, stopRefused: result.outcome };
    case "await-stopped":
      return { ...state, containerReady: true };
    case "dispatch":
      return action.kind === "dispatch"
        ? { ...state, attempts: [...state.attempts, attemptOf(action, intent.at, result)] }
        : state;
    case "dispatch-failed":
      // Recorded as a failed run at once, and retried after a stop like any other: a cold start that
      // timed out is one of the ways a dispatch fails.
      return action.kind === "dispatch"
        ? { ...state, attempts: [...state.attempts, attemptOf(action, intent.at, result)], ...coldStartNeeded }
        : state;
    case "await-terminal":
      return updateAttempt(state, action, (attempt) => ({
        ...attempt,
        terminal: { status: result.status, version: result.liveVersion },
      }));
    case "deliver":
      return updateAttempt(state, action, (attempt) => ({ ...attempt, delivered: result.delivered }));
    case "record":
      return {
        ...updateAttempt(state, action, (attempt) => ({
          ...attempt,
          verdict: { counts: result.excluded === null, reason: result.excluded },
        })),
        // A run that does not count is retried, and the retry must not land on the container that just
        // produced it: a stale container is exactly one way a run comes back on the wrong cell.
        ...(result.excluded === null ? {} : coldStartNeeded),
        firstHost: state.firstHost ?? (result.excluded === null ? result.host : null),
      };
    case "cleanup-deliver":
      return action.kind === "cleanup-deliver"
        ? {
            ...state,
            cleanedUp: { ...state.cleanedUp, delivered: [...state.cleanedUp.delivered, action.proposalPlanId] },
          }
        : state;
    case "delete-plan":
      return action.kind === "delete-plan"
        ? { ...state, cleanedUp: { ...state.cleanedUp, deleted: [...state.cleanedUp.deleted, action.planId] } }
        : state;
  }
};

const coldStartNeeded = { stopIssued: false, containerReady: false } as const;

const attemptOf = (
  action: Extract<JournalAction, { kind: "dispatch" }>,
  at: string,
  result: Extract<ActionResult, { kind: "dispatch" | "dispatch-failed" }>,
): Attempt => ({
  cell: action.cell,
  slot: action.slot,
  attempt: action.attempt,
  dispatchedAt: at,
  jobId: result.kind === "dispatch" ? result.jobId : null,
  proposalPlanId: result.kind === "dispatch" ? result.proposalPlanId : null,
  dispatchVersion: result.liveVersion,
  terminal: null,
  delivered: null,
  // A dispatch that never produced a job is a run that cannot count — recorded as such at once, so the
  // failure policy sees it like any other bad outcome.
  verdict: result.kind === "dispatch-failed" ? { counts: false, reason: `dispatch failed: ${result.error}` } : null,
});

const updateAttempt = (
  state: CampaignState,
  action: JournalAction,
  change: (attempt: Attempt) => Attempt,
): CampaignState =>
  "jobId" in action
    ? {
        ...state,
        attempts: state.attempts.map((attempt) => (attempt.jobId === action.jobId ? change(attempt) : attempt)),
      }
    : state;
