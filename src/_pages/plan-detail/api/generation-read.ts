import { z } from "zod";
import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import {
  computePinnedSoftFloor,
  deriveCleanLabel,
  parseStoredPolicy,
  parseStoredStages,
  isActiveJobStatus,
  isDeliverableJob,
  isStaleActiveJob,
  softHitsAchieved,
  type CleanLabel,
  type GenerationJobStatus,
  type GeneratorSnapshot,
  type SolvePolicy,
  type StoredStageReport,
} from "@/entities/timetable";

/**
 * The read half of a plan visit: find the plan's job and describe it. **Nothing in this file writes.**
 *
 * It was the first half of `checkPlan` (`generation-delivery.ts`) until S-405, which split the visit
 * by capability. An editor's visit still settles the job it reads — reclaim, deliver, sweep, stamp
 * `notified_at` — because those writes are author behaviour, and the visit is where they are felt.
 * A viewer's visit cannot make them: RLS refuses every one, and each refusal used to surface as an
 * error, a silent no-op, or a view that lied about the row. So a non-editor reads through
 * `readPlanJob` below, and the delivery file imports these same helpers for its own first half.
 * Keeping the two halves in two files is what makes "never writes" checkable at a glance: every
 * query here is a `select`.
 *
 * **The view says what the read could not do.** A write-free reader cannot reclaim a job that went
 * quiet or deliver a finished one, so the view carries both facts — `stalled` and `awaitingDelivery`
 * — computed from the same entity predicates the editor's settle path acts on. On that path they
 * come back false almost always, because the visit has just acted on them.
 */
export const checkPlanInput = z.object({ planId: z.uuid() });

export type CheckPlanInput = z.infer<typeof checkPlanInput>;

/**
 * Which side of the job the plan being visited is on.
 *
 * The same job row is rendered by two different pages with two different stories, so the view has to
 * say which one it is answering. On the **source** the job is something the author launched and can
 * leave — an advisory, and a home for failures. On the **proposal** it is what the page IS: progress
 * while pending, provenance once delivered.
 */
export type GenerationJobRole = "source" | "proposal";

export type GenerationJobView = {
  jobId: string;
  status: GenerationJobStatus;
  role: GenerationJobRole;
  /** The plan the snapshot was assembled from. Always present — `plan_id` is `not null`. */
  sourcePlanId: string;
  /** Read only on the `proposal` role, where the strip needs it for "Generated from <name>". */
  sourcePlanName: string | null;
  /** Null once a failed job's orphan clone has been removed (`on delete set null` does the rest). */
  proposalPlanId: string | null;
  /** True once the verified board has landed on the proposal plan. */
  delivered: boolean;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** `unavailable` until the board is delivered — there is nothing to be clean about before then. */
  cleanLabel: CleanLabel;
  /** The ladder POSITION (1-based, "stage N of 10") whose checkpoint a halted job kept, or null when
   *  it kept nothing. A position, not a tier, since S-307: under a permuted policy the two differ, and
   *  the count the author reads must never run backwards. Tier identity lives in `stages[].tier`. */
  checkpointStageIndex: number | null;
  /** The ladder POSITION now running, 1-based — the pending page's live progress. Null before the
   *  first stage. Same rule as above: a position, never a tier. */
  stageIndex: number | null;
  stageName: string | null;
  /** When the author asked this job to stop (S-305), or null. Non-null on a still-active row is the
   *  "Stopping…" state: the request is durable and the solver has not finished reacting to it. */
  stopRequestedAt: string | null;
  /** The solve policy this job ran under (S-307) — the picker's seed and the provenance line's noun.
   *  Legacy rows (`{ clean: true }`) read as clean, which is what every one of them was solved as. */
  policy: SolvePolicy;
  /** An active row that has gone quiet past the grace (`isStaleActiveJob`, S-304). An editor's visit
   *  reclaims it; a viewer's read can only say so (S-405). */
  stalled: boolean;
  /** A board is waiting to land (`isDeliverableJob`). An editor's visit delivers it; a viewer's read
   *  can only say so, and waits for an author or admin to open the plan (S-405). */
  awaitingDelivery: boolean;
};

/** Everything the strip renders, and none of the ~160 KB of payload beside it. `heartbeat_at` is the
 *  staleness clock, `checkpoint_stage_index` the free existence proxy for the ~35 KB checkpoint, and
 *  `stop_requested_at` one narrow scalar that lets the pending page render "Stopping…" across ticks
 *  and reloads rather than from a client-side memory a refresh would lose. */
const STATUS_COLUMNS =
  "id,plan_id,status,proposal_plan_id,delivered_plan_id,delivery,stages,error,created_at,finished_at,heartbeat_at,checkpoint_stage_index,notified_at,stage_index,stage_name,stop_requested_at,policy";

export type StatusRow = {
  id: string;
  plan_id: string;
  status: GenerationJobStatus;
  proposal_plan_id: string | null;
  delivered_plan_id: string | null;
  delivery: string | null;
  notified_at: string | null;
  stages: StoredStageReport[];
  error: string | null;
  created_at: string;
  finished_at: string | null;
  heartbeat_at: string | null;
  checkpoint_stage_index: number | null;
  stage_index: number | null;
  stage_name: string | null;
  stop_requested_at: string | null;
  policy: SolvePolicy;
};

/** The row a visit found, and which side of it the visited plan is on. */
export type FoundJob = { row: StatusRow; role: GenerationJobRole };

/**
 * A non-editor's visit (S-405): the same dual-keyed read and precedence as `checkPlan`, and nothing
 * after it. No reclaim, delivery, sweep, failure, pending clear or `notified_at` stamp — a stale row
 * comes back `stalled`, a finished one `awaitingDelivery`, and both stay exactly as they were until an
 * author or admin opens the plan.
 *
 * Same weight as the hub's status poll: the narrow status columns, plus the snapshot only when a
 * delivered board's clean label needs its floor (`labelOf`). So the pending page may keep polling it
 * while a board waits for an author, which is how a viewer's page flips into the board on its own.
 */
export const readPlanJob = async (
  supabase: SupabaseClient,
  input: CheckPlanInput,
): Promise<GenerationJobView | null> => {
  const found = await findPlanJob(supabase, input.planId);
  if (!found) return null;

  const { row, role } = found;
  const view = toView(row, await labelOf(supabase, row), Date.now());
  if (role === "source") return view;
  return { ...view, role, sourcePlanName: await planName(supabase, view.sourcePlanId) };
};

/**
 * The visit's read, whichever plan it is a visit to.
 *
 * **One entry point, two keys.** `generation_jobs` names two plans — the `plan_id` it solved from and
 * the `proposal_plan_id` it solves onto — and both are pages an author can be standing on. The key
 * decides only the `role` the view is tagged with, and therefore which story the strip tells.
 *
 * **Two narrow reads, not one `.or(…)`.** A single newest-row query cannot express the precedence
 * below, because "newest" and "the row this plan is the proposal of" are different questions. Both
 * reads are by an indexed column (`generation_jobs_plan_idx`, `generation_jobs_proposal_plan_idx`),
 * project `STATUS_COLUMNS` only, and run concurrently — one round trip in wall-clock terms.
 *
 * **Precedence, for the plan that is both.** A delivered proposal can itself be generated FROM, at
 * which point it is the `proposal_plan_id` of one job and the `plan_id` of another. The rule:
 *
 *   1. the plan's own job, when it is active or undelivered — a live solve the author launched here
 *      is the most urgent thing this page can say, and it is the only one with anything to deliver.
 *      *Undelivered* is asked of BOTH markers: `delivered_plan_id` can be re-nulled by its
 *      `on delete set null` FK when the proposal is deleted, and a row that outranked its provenance
 *      on that basis alone would permanently hide an A→B→C chain's "generated from A" strip.
 *      `delivery` is the durable fact and it settles the tie;
 *   2. otherwise the job that produced this plan — so a proposal keeps its provenance strip for good,
 *      rather than losing it the moment the author generates from it;
 *   3. otherwise the plan's own newest job.
 *
 * Returns null when neither key matches — a plan that has never been generated and never was one.
 */
export const findPlanJob = async (supabase: SupabaseClient, planId: string): Promise<FoundJob | null> => {
  const [asSource, asProposal] = await Promise.all([
    latestJobBy(supabase, "plan_id", planId),
    latestJobBy(supabase, "proposal_plan_id", planId),
  ]);

  const row = pickJob(asSource, asProposal);
  if (!row) return null;
  return { row, role: row === asSource ? "source" : "proposal" };
};

/**
 * The label for a job this call did not just deliver.
 *
 * Short-circuits before touching `snapshot`: an undelivered job has nothing to be clean about, and a
 * tier-5 `best` of 0 is clean regardless of the floor. Only a non-zero value has to be interpreted
 * against the floor, and only then is the ~124 KB column worth reading.
 */
export const labelOf = async (supabase: SupabaseClient, row: StatusRow): Promise<CleanLabel> => {
  if (row.delivered_plan_id === null) return { kind: "unavailable" };
  const achieved = softHitsAchieved(row.stages);
  if (achieved === undefined) return { kind: "unavailable" };
  if (achieved === 0) return { kind: "clean" };

  const { data, error } = await supabase.from("generation_jobs").select("snapshot").eq("id", row.id).single();
  if (error) return { kind: "unavailable" };
  return deriveCleanLabel(
    row.stages,
    computePinnedSoftFloor(data.snapshot as unknown as GeneratorSnapshot),
    row.policy,
  );
};

/** The source plan's display name, for the proposal strip's "Generated from <name>" provenance. */
export const planName = async (supabase: SupabaseClient, planId: string): Promise<string | null> => {
  const { data } = await supabase.from("plans").select("name").eq("id", planId).maybeSingle();
  return data?.name ?? null;
};

/**
 * `role` defaults to `source` and the entry points override it, because every path inside the
 * delivery file describes the job from the source's point of view — it is the source's snapshot, the
 * source's catalog the ids translate from. Only the entry point knows which page asked.
 *
 * `nowMs` is the staleness clock. Both readers pass `Date.now()`; the editor's settle path passes the
 * same instant it reclaimed by, so `stalled` there is true only when that compare-and-set was lost.
 */
export const toView = (row: StatusRow, cleanLabel: CleanLabel, nowMs: number): GenerationJobView => ({
  jobId: row.id,
  status: row.status,
  role: "source",
  sourcePlanId: row.plan_id,
  sourcePlanName: null,
  proposalPlanId: row.proposal_plan_id,
  delivered: row.delivered_plan_id !== null,
  error: row.error,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
  cleanLabel,
  checkpointStageIndex: row.checkpoint_stage_index,
  stageIndex: row.stage_index,
  stageName: row.stage_name,
  stopRequestedAt: row.stop_requested_at,
  policy: row.policy,
  stalled: isStaleActiveJob(row, nowMs),
  awaitingDelivery: isDeliverableJob(row),
});

/** The precedence in `findPlanJob`'s docblock, as one expression. */
const pickJob = (asSource: StatusRow | null, asProposal: StatusRow | null): StatusRow | null => {
  const undelivered = asSource !== null && asSource.delivered_plan_id === null && asSource.delivery === null;
  if (asSource && (isActiveJobStatus(asSource.status) || undelivered)) return asSource;
  return asProposal ?? asSource;
};

const latestJobBy = async (
  supabase: SupabaseClient,
  column: "plan_id" | "proposal_plan_id",
  planId: string,
): Promise<StatusRow | null> => {
  const { data, error } = await supabase
    .from("generation_jobs")
    .select(STATUS_COLUMNS)
    .eq(column, planId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to read the generation job: ${error.message}`);
  if (data === null) return null;
  // `stages` and `policy` are the two columns here that arrive as untyped jsonb, so they are parsed
  // rather than cast: a malformed transcript degrades the clean label to `unavailable` instead of
  // feeding `deriveCleanLabel` a shape it will read a confident wrong number out of, and a legacy or
  // malformed policy reads as the clean default every pre-S-307 row was solved under. Everything else
  // in STATUS_COLUMNS is a scalar the check constraints already pin.
  const row = data as unknown as Omit<StatusRow, "stages" | "policy"> & { stages: unknown; policy: unknown };
  return { ...row, stages: parseStoredStages(row.stages), policy: parseStoredPolicy(row.policy) };
};
