import {
  isActiveJobStatus,
  isGenerationJobStatus,
  isStaleActiveJob,
  LADDER_TIER_COUNT,
  tierLabel,
  type GenerationJobStatus,
} from "@/entities/timetable";

/**
 * What the hub can say about a plan beyond its name, grid and counts.
 *
 * A **discriminated union with one member**, on purpose. `PlanRow`'s docstring records that derived
 * quality metrics (valid / complete / used slots) were explicitly deferred, and the reason holds:
 * each of those means computing a board per plan, per page load. The generation indicator is the one
 * candidate that is not derived — it reads a durable row through an index that guarantees at most one
 * active job per plan — which is why it is the occupant that ships.
 *
 * S-306 did NOT add the second member the union was held open for. "This plan is a generated clone"
 * turned out to be the same fact as "this job's board landed here", so it is two FIELDS on the one
 * indicator (`proposalPlanId` + `delivered`) rather than a second kind. The union stays because it
 * still costs nothing and the next candidate may genuinely be one.
 */
export type PlanIndicator = GenerationIndicator;

export type GenerationIndicator = {
  kind: "generation";
  jobId: string;
  /** The SOURCE plan the job was launched from. */
  planId: string;
  /**
   * The proposal plan the board lands on — the row this badge is really ABOUT (S-306), and the row it
   * renders on when that row is on the page. Null once a swept clone is gone.
   *
   * Both ids travel because this shape opens a discovery hole: a job started on a plan page creates a
   * proposal row an already-open hub has never loaded, so the badge must be able to fall back to the
   * source row the hub does know about. See `PlansHub.indicatorsFor`.
   */
  proposalPlanId: string | null;
  /** True once the verified board has landed. Separates "Ready — open" from "open to deliver". */
  delivered: boolean;
  status: GenerationJobStatus;
  /** The TIER now running, 1-based. Null before the solver has claimed and started a stage — and on
   *  every row written before S-303, which filled `stages` only at the end. */
  stageIndex: number | null;
  stageName: string | null;
  /** The job row's `created_at`, as an ISO instant. Formatted at the very edge — see below. */
  startedAt: string;
  /**
   * An active job that has gone quiet past `HEARTBEAT_GRACE_MS` (S-304). DISPLAY ONLY — this path
   * stays a pure read, and the reclaim happens where the failure is felt: the plan visit the stalled
   * badge links to. Computed at the mapping edge so the loader and the poll agree.
   */
  stale: boolean;
};

/** The columns every read of this indicator projects — the loader's and the poll's, identically.
 *
 *  `status` is `string` because that is what it arrives as: the column is CHECK-constrained rather
 *  than an enum, so Supabase's generated types cannot narrow it and neither may we, by hand. */
export type GenerationJobStatusRow = {
  id: string;
  plan_id: string;
  proposal_plan_id: string | null;
  delivered_plan_id: string | null;
  status: string;
  stage_index: number | null;
  stage_name: string | null;
  created_at: string;
  /** The staleness clock for a `running` row; null until the solver claims it. */
  heartbeat_at: string | null;
};

export type IndicatorTone = "active" | "done" | "failed" | "other";

export type IndicatorDescription = {
  tone: IndicatorTone;
  label: string;
  /** Where the badge points once there is something to open, else null. */
  href: string | null;
  /** The ISO instant to render as a local time, or null when the label carries no time.
   *
   *  Returned as DATA rather than pre-formatted, because formatting it here would be a hydration
   *  mismatch: the page is server-rendered on workerd (UTC) and hydrated in the reader's own zone, so
   *  `toLocaleTimeString` produces different text on the two sides. The cell puts the instant in a
   *  `<time dateTime>` and fills in the readable form only once hydrated — see `useHydrated`. */
  startedAt: string | null;
};

/**
 * What the badge says, and where it points.
 *
 * **S-306 inverted the destination.** The href used to be the SOURCE plan for every terminal state,
 * because delivery only happened on a visit there — sending the author to the clone would have shown
 * them an empty board nothing had landed on. Both halves of that changed: `checkPlan` is dual-keyed,
 * so a visit to the proposal delivers, and the proposal is openable from its first second (while
 * pending it shows progress instead of a board). So the badge now points at the plan it is ABOUT.
 *
 * Two exceptions, both pointing at the source. A **stalled** active row, because opening the source
 * is what reclaims it — reclaim keys off the plan whose Generate the wedged row is blocking. And a
 * **failed** job, because its clone has been swept and the source's strip is where the diagnostic
 * lives (FR-308).
 */
export const describeGenerationIndicator = (indicator: GenerationIndicator): IndicatorDescription => {
  const openSource = `/plans/${indicator.planId}`;
  const openProposal = indicator.proposalPlanId === null ? openSource : `/plans/${indicator.proposalPlanId}`;
  switch (indicator.status) {
    case "queued":
      return indicator.stale
        ? // Tone `other`, not `failed`: the row still says `queued` and nothing here has written to it.
          { tone: "other", label: "Queued — stalled, open plan", href: openSource, startedAt: indicator.startedAt }
        : { tone: "active", label: "Queued — started", href: openProposal, startedAt: indicator.startedAt };
    case "running":
      return indicator.stale
        ? { tone: "other", label: "Generating — stalled, open plan", href: openSource, startedAt: indicator.startedAt }
        : { tone: "active", label: stageLabel(indicator), href: openProposal, startedAt: indicator.startedAt };
    case "succeeded":
    case "stopped":
    case "interrupted":
      // Three statuses, one question: has the board landed? A delivered proposal is an ordinary plan
      // and the badge is an invitation to open it; an undelivered one needs a visit to complete, and
      // says so in the same words the delete guard's refusal uses.
      return indicator.delivered
        ? { tone: "done", label: "Ready — open", href: openProposal, startedAt: null }
        : { tone: "done", label: "Finished — open to deliver", href: openProposal, startedAt: null };
    case "failed":
      return { tone: "failed", label: "Failed — open plan", href: openSource, startedAt: null };
  }
};

/**
 * Map projected rows onto indicators — the SHARED entry point, used by the SSR loader and by the
 * poll alike so the two cannot come to disagree about what a row means.
 *
 * A row whose status this build does not recognise is dropped rather than cast. That can only happen
 * if the CHECK constraint gains a value ahead of the client, and when it does, omitting one badge is
 * a better answer than rendering an empty cell from a `switch` with no matching branch.
 */
export const toGenerationIndicators = (
  rows: readonly GenerationJobStatusRow[],
  nowMs: number = Date.now(),
): GenerationIndicator[] =>
  rows.flatMap((row) => {
    const indicator = toGenerationIndicator(row, nowMs);
    return indicator === null ? [] : [indicator];
  });

/** `now` is injected so staleness stays a pure function of the row plus a clock the test controls. */
export const toGenerationIndicator = (
  row: GenerationJobStatusRow,
  nowMs: number = Date.now(),
): GenerationIndicator | null =>
  isGenerationJobStatus(row.status)
    ? {
        kind: "generation",
        jobId: row.id,
        planId: row.plan_id,
        proposalPlanId: row.proposal_plan_id,
        delivered: row.delivered_plan_id !== null,
        status: row.status,
        stageIndex: row.stage_index,
        stageName: row.stage_name,
        startedAt: row.created_at,
        stale: isStaleActiveJob({ ...row, status: row.status }, nowMs),
      }
    : null;

export const isActiveIndicator = (indicator: PlanIndicator): boolean => isActiveJobStatus(indicator.status);

/**
 * "Generating — stage 4 of 10 · teacher holes", or "Generating — starting" before the first stage.
 *
 * A claimed job has written `stage_index` within a fraction of a second, so the second form is a
 * genuine early moment rather than a fallback — and it is also what a pre-S-303 row shows forever,
 * which is the honest answer for a run that never reported stages.
 */
const stageLabel = (indicator: GenerationIndicator): string => {
  if (indicator.stageIndex === null) return "Generating — starting";
  const named = indicator.stageName === null ? "" : ` · ${tierLabel(indicator.stageName)}`;
  return `Generating — stage ${String(indicator.stageIndex)} of ${String(LADDER_TIER_COUNT)}${named}`;
};
