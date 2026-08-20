import {
  isActiveJobStatus,
  isGenerationJobStatus,
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
 * active job per plan — which is why it is the occupant that ships. The union exists so S-306's
 * `{ kind: "proposal" }` (this plan is a generated clone, from the same query's
 * `proposal_plan_id`/`delivered_plan_id`) joins without a retrofit, not because a framework was wanted.
 */
export type PlanIndicator = GenerationIndicator;

export type GenerationIndicator = {
  kind: "generation";
  jobId: string;
  planId: string;
  status: GenerationJobStatus;
  /** The TIER now running, 1-based. Null before the solver has claimed and started a stage — and on
   *  every row written before S-303, which filled `stages` only at the end. */
  stageIndex: number | null;
  stageName: string | null;
  /** The job row's `created_at`, as an ISO instant. Formatted at the very edge — see below. */
  startedAt: string;
};

/** The columns every read of this indicator projects — the loader's and the poll's, identically.
 *
 *  `status` is `string` because that is what it arrives as: the column is CHECK-constrained rather
 *  than an enum, so Supabase's generated types cannot narrow it and neither may we, by hand. */
export type GenerationJobStatusRow = {
  id: string;
  plan_id: string;
  status: string;
  stage_index: number | null;
  stage_name: string | null;
  created_at: string;
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

export const describeGenerationIndicator = (indicator: GenerationIndicator): IndicatorDescription => {
  const openPlan = `/plans/${indicator.planId}`;
  switch (indicator.status) {
    case "queued":
      return { tone: "active", label: "Queued — started", href: null, startedAt: indicator.startedAt };
    case "running":
      return {
        tone: "active",
        label: stageLabel(indicator),
        href: null,
        startedAt: indicator.startedAt,
      };
    case "succeeded":
      // The href is the SOURCE plan, never the proposal: delivery happens on a visit to the source
      // (`checkGeneration` verifies, translates and applies there), so sending the author straight to
      // the clone would show them an empty board that nothing has landed on yet.
      return { tone: "done", label: "Finished — open plan", href: openPlan, startedAt: null };
    case "failed":
      return { tone: "failed", label: "Failed — open plan", href: openPlan, startedAt: null };
    case "stopped":
      return { tone: "other", label: "Stopped", href: openPlan, startedAt: null };
    case "interrupted":
      return { tone: "other", label: "Interrupted", href: openPlan, startedAt: null };
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
export const toGenerationIndicators = (rows: readonly GenerationJobStatusRow[]): GenerationIndicator[] =>
  rows.flatMap((row) => {
    const indicator = toGenerationIndicator(row);
    return indicator === null ? [] : [indicator];
  });

export const toGenerationIndicator = (row: GenerationJobStatusRow): GenerationIndicator | null =>
  isGenerationJobStatus(row.status)
    ? {
        kind: "generation",
        jobId: row.id,
        planId: row.plan_id,
        status: row.status,
        stageIndex: row.stage_index,
        stageName: row.stage_name,
        startedAt: row.created_at,
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
