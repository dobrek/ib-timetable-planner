import { z } from "zod";
import type { JobEmailKind } from "./job-email";
import { HEARTBEAT_GRACE_MS } from "./job-staleness";
import { parseStoredPolicy, policyLabel } from "./policy";

/**
 * What a job email says (S-310, FR-309): subject, plain text and HTML, from the job row's facts.
 *
 * **A pure function of the row.** Resend refuses a retry that reuses an `Idempotency-Key` with a
 * different body, so a retry must send identical bytes: the duration comes from row timestamps,
 * never from the clock, and nothing here reads one.
 *
 * **Honest wording** (research C3). The solver's terminal write comes before the server-side check,
 * which runs only at an editor's visit and can still reject a board, so a finished job is "finished:
 * open it to review", never "ready" or "verified".
 *
 * **No student data, and the structural contract every product email keeps:**
 * - never the job's `error` text, which holds ids and the solver's HTTP body: the facts below have no
 *   field for it;
 * - counts only, never a course or student name;
 * - exactly one link, on our origin, to the plan to open;
 * - no image, tracking, form or script; plain text beside the HTML.
 *
 * The plan name is author-written free text. It is escaped in the HTML, stripped of control
 * characters (CR/LF included) everywhere, and never put in a URL.
 */
export type JobEmailContentFacts = {
  /** The name of the plan Generate was pressed on: `plans.name` of the job's `plan_id`. */
  planName: string;
  planId: string;
  /** Null when the proposal was deleted, or never cloned. */
  proposalPlanId: string | null;
  /** The stored `policy` column, in whatever shape it was written. */
  policy: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  /** Non-null when a halted job kept a board in `checkpoint`. */
  checkpointStageIndex: number | null;
  /** `result -> diagnostics`, as stored. */
  resultDiagnostics: unknown;
  /** `checkpoint -> diagnostics`, as stored. */
  checkpointDiagnostics: unknown;
};

export type JobEmail = { subject: string; text: string; html: string; link: string };

/**
 * Build the email for a send decision. `origin` is the configured `APP_ORIGIN` (scheme, host and
 * port, no trailing slash), which the config reader has already checked is http(s).
 */
export function buildJobEmail(kind: JobEmailKind, facts: JobEmailContentFacts, origin: string): JobEmail {
  const name = cleanPlanName(facts.planName);
  const board = hasBoard(kind, facts);
  const targetPlanId = board && facts.proposalPlanId !== null ? facts.proposalPlanId : facts.planId;
  const link = `${origin}/plans/${targetPlanId}`;
  const details = [
    durationLine(kind, facts),
    `Policy: ${policyLabel(parseStoredPolicy(facts.policy).preset)}`,
    board ? countsLine(kind === "finished" ? facts.resultDiagnostics : facts.checkpointDiagnostics) : null,
  ].filter((line): line is string => line !== null);
  const headline = HEADLINE[kind](name);
  const next = nextStep(kind, board, targetPlanId === facts.planId ? "Open the plan" : "Open the proposal");

  return {
    subject: `IB Planner: ${SUBJECT[kind]} for “${name}”`,
    text:
      [headline, details.join("\n"), `${next.lead}${next.open}${next.rest}:\n${link}`, FOOTER, SIGNATURE].join("\n\n") +
      "\n",
    html: html({ headline, details, next, link }),
    link,
  };
}

const SUBJECT: Record<JobEmailKind, string> = {
  finished: "generation finished",
  failed: "generation failed",
  interrupted: "generation interrupted",
  stopped: "generation stopped",
  stalled: "generation stopped responding",
};

const GRACE_MINUTES = HEARTBEAT_GRACE_MS / 60_000;

const HEADLINE: Record<JobEmailKind, (name: string) => string> = {
  finished: (name) => `The generation for “${name}” has finished.`,
  failed: (name) => `The generation for “${name}” failed before it finished.`,
  interrupted: (name) => `The generation for “${name}” was interrupted before it finished.`,
  stopped: (name) => `The generation for “${name}” was stopped before it finished.`,
  stalled: (name) =>
    `The generation for “${name}” has stopped responding: it has not reported progress for over ${String(GRACE_MINUTES)} minutes.`,
};

const FOOTER =
  "You are receiving this because you ticked “Email me when it finishes” when you started this generation.";
const SIGNATURE = "IB Planner";

/**
 * Whether a board is on its way to the proposal: a succeeded job's is its `result`, and a halted job
 * keeps one in its `checkpoint` exactly when `checkpoint_stage_index` is set (`isDeliverableJob`).
 * The link goes to the proposal then, and to the plan Generate was pressed on otherwise.
 */
const hasBoard = (kind: JobEmailKind, facts: JobEmailContentFacts): boolean =>
  kind === "finished" || ((kind === "interrupted" || kind === "stopped") && facts.checkpointStageIndex !== null);

/** The call to action, split so the HTML can make `open` the email's one anchor. */
type NextStep = { lead: string; open: string; rest: string };

const nextStep = (kind: JobEmailKind, board: boolean, open: string): NextStep => {
  if (kind === "finished") return { lead: "", open, rest: " to review it" };
  if (kind === "stalled") return { lead: "", open, rest: " to see where it stands" };
  if (kind === "failed") return { lead: "", open, rest: " to see what happened and try again" };
  return board
    ? { lead: "The best board found so far was kept. ", open, rest: " to review it" }
    : { lead: "Nothing was kept. ", open, rest: " to try again" };
};

/** How long it ran: to the terminal write, or, when it went quiet, to its last heartbeat. */
const durationLine = (kind: JobEmailKind, facts: JobEmailContentFacts): string | null => {
  const end = kind === "stalled" ? facts.heartbeatAt : facts.finishedAt;
  if (facts.startedAt === null || end === null) return null;
  const ms = Date.parse(end) - Date.parse(facts.startedAt);
  if (Number.isNaN(ms) || ms < 0) return null;
  return kind === "stalled" ? `Ran for ${formatDuration(ms)} before it went quiet` : `Ran for ${formatDuration(ms)}`;
};

const formatDuration = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours > 0 ? plural(hours, "hour") : null, rest > 0 ? plural(rest, "minute") : null]
    .filter((part) => part !== null)
    .join(" ");
};

/** What the board leaves to place, counted across both cohorts, in the board's own vocabulary. */
const countsLine = (diagnostics: unknown): string | null => {
  const parsed = DIAGNOSTICS.safeParse(diagnostics);
  if (!parsed.success) return null;
  const unplaced = Object.values(parsed.data.cohorts).flatMap((cohort) => cohort.unplaced);
  if (unplaced.length === 0) return "All courses were placed.";
  const hours = unplaced.reduce((sum, deficit) => sum + deficit.missing, 0);
  return `${plural(unplaced.length, "course")} could not be fully placed (${plural(hours, "hour")} left to place).`;
};

/** Only the counts are read: course ids never leave this function. */
const DIAGNOSTICS = z.object({
  cohorts: z.record(z.string(), z.object({ unplaced: z.array(z.object({ missing: z.number() })) })),
});

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? "" : "s"}`;

/** Control characters (CR/LF among them) become spaces, so a name can never break a header line. */
const cleanPlanName = (raw: string): string =>
  raw
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() || "Untitled plan";

const html = ({
  headline,
  details,
  next,
  link,
}: {
  headline: string;
  details: string[];
  next: NextStep;
  link: string;
}): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>IB Planner</title></head>',
    '<body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 15px; line-height: 1.5;">',
    `<p>${escapeHtml(headline)}</p>`,
    `<p>${details.map(escapeHtml).join("<br>")}</p>`,
    `<p>${escapeHtml(next.lead)}<a href="${escapeHtml(link)}">${escapeHtml(next.open)}</a>${escapeHtml(next.rest)}.</p>`,
    `<p style="font-size: 13px;">${escapeHtml(FOOTER)}</p>`,
    `<p>${escapeHtml(SIGNATURE)}</p>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");

const HTML_ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
