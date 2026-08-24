import { z } from "zod";
import { loadCohortCourses, type SupabaseClient } from "@/shared/api";
import { COHORT_VALUES, type Cohort, type PlacementWeek } from "@/shared/config";
import { DomainError } from "@/shared/lib/errors";
import {
  buildCourseIdMap,
  computePinnedSoftFloor,
  deriveCleanLabel,
  runVerifiedGeneration,
  parseStoredStages,
  softHitsAchieved,
  translateCourseIds,
  type CleanLabel,
  type CourseIdentityIndex,
  type GeneratedPlacement,
  type GenerationJobStatus,
  type GenerationResult,
  type GeneratorSnapshot,
  type StoredStageReport,
} from "@/entities/timetable";
import { reclaimStaleJob } from "./generation-reclaim";
import { applyGeneratedPlacements } from "./placements";

/**
 * The delivery half of S-301: read a plan's latest job back, and if it succeeded and has not been
 * delivered, verify the board SERVER-SIDE, translate it into the clone's id space, and apply it.
 *
 * **The trigger is a visit, and the plan says so out loud.** This satisfies FR-313's *location*
 * requirement — the oracle runs server-side in the delivery pipeline, not in a browser — but not its
 * *rationale* ("so headless delivery is verified without a browser open"). Nothing here polls, and
 * S-303 did not add that: it put a status-only poll on the plans list, which never calls this
 * function — running delivery on a timer, from a page the author is not looking at, is exactly what
 * that separation avoids. S-306 adds drift-decided delivery; until then the author's return to the
 * page is the clock.
 *
 * **Idempotent under concurrent invocation**, because two tabs firing the on-visit check is the
 * normal case rather than an edge one. The delivered marker is a compare-and-set
 * (`… where id = … and delivered_plan_id is null`), so exactly one caller writes it and the loser
 * reports the same delivered state.
 *
 * **Narrow projections are a correctness-adjacent rule here, not an optimisation.** `snapshot` is
 * ~124 KB TOASTed and `result`/`checkpoint` ~35 KB each; the status read touches none of them —
 * `checkpoint_stage_index is not null` is the free existence proxy for the payload — and the heavy
 * pair is fetched only once a job is known to be deliverable. Even the clean label short-circuits: a
 * tier-5 `best` of 0 is clean whatever the floor is, so the snapshot is re-read only when a non-zero
 * value genuinely needs the floor to be interpreted.
 *
 * **An unverified board never lands.** A failing verdict marks the job `failed` with the oracle's
 * reasons and removes the orphan clone; nothing partial is ever written, because the apply is one
 * plpgsql transaction.
 *
 * **One deliberate exception to "a visit is otherwise a read" (S-304).** Before anything else, a row
 * that is still `queued`/`running` but has gone quiet past `HEARTBEAT_GRACE_MS` is compare-and-set to
 * `interrupted` — because the plan visit is exactly where that failure is FELT: the partial unique
 * index refuses the author's next Generate until the wedged row leaves the active set, and nothing
 * else in the system sweeps it (no cron, and a `scheduled` handler has no database identity here).
 * S-301's implementation review rejected a staleness sweep on the grounds that a wrong threshold
 * fails healthy jobs; what answers that objection is not a better guess but a better cadence — S-304's
 * 15 s heartbeat makes the five-minute grace twenty consecutive missed beats. See `job-staleness.ts`.
 *
 * **An interrupted row is salvage when it has a checkpoint, litter when it does not.** A checkpoint is
 * a full `GenerationResult` written through the same wire path as `result`, so it delivers through
 * this file's existing verify → translate → apply chain unchanged; `deriveCleanLabel` already degrades
 * to `unavailable` for a transcript that never reached tier 5, which is the honest label for a partial
 * board. Without one there is nothing to deliver, and the clone is swept exactly as a failed job's is.
 */
export const checkGenerationInput = z.object({ planId: z.uuid() });

export type CheckGenerationInput = z.infer<typeof checkGenerationInput>;

export type GenerationJobView = {
  jobId: string;
  status: GenerationJobStatus;
  /** Null once a failed job's orphan clone has been removed (`on delete set null` does the rest). */
  proposalPlanId: string | null;
  /** True once the verified board has landed on the proposal plan. */
  delivered: boolean;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** `unavailable` until the board is delivered — there is nothing to be clean about before then. */
  cleanLabel: CleanLabel;
  /** The TIER whose checkpoint an interrupted job kept, or null when it kept nothing. */
  checkpointStageIndex: number | null;
};

/** Everything the strip renders, and none of the ~160 KB of payload beside it. `heartbeat_at` is the
 *  staleness clock and `checkpoint_stage_index` the free existence proxy for the ~35 KB checkpoint. */
const STATUS_COLUMNS =
  "id,status,proposal_plan_id,delivered_plan_id,stages,error,created_at,finished_at,heartbeat_at,checkpoint_stage_index";

type StatusRow = {
  id: string;
  status: GenerationJobStatus;
  proposal_plan_id: string | null;
  delivered_plan_id: string | null;
  stages: StoredStageReport[];
  error: string | null;
  created_at: string;
  finished_at: string | null;
  heartbeat_at: string | null;
  checkpoint_stage_index: number | null;
};

export const checkGeneration = async (
  supabase: SupabaseClient,
  input: CheckGenerationInput,
): Promise<GenerationJobView | null> => {
  const latest = await latestJob(supabase, input.planId);
  if (!latest) return null;

  // BEFORE the delivery branch, so a crash-wedged row becomes `interrupted` and delivers its
  // checkpoint in the SAME visit rather than making the author come back a second time.
  const row = await reclaimIfStale(supabase, latest);

  if (deliverable(row)) return deliver(supabase, input.planId, row);

  // An orphan clone is one nothing will ever be delivered onto, and leaving it clutters the plans
  // list with a half-made proposal. Guarded twice over — only this job's own `proposal_plan_id`, and
  // only while nothing has been delivered. S-304 decided the question the old comment here left open:
  // an `interrupted` clone is SALVAGE when the row carries a checkpoint (handled above) and litter
  // when it does not. `stopped` is still S-305's to answer.
  if (sweepable(row) && row.delivered_plan_id === null && row.proposal_plan_id !== null) {
    await deleteOrphanClone(supabase, row.proposal_plan_id);
    return toView({ ...row, proposal_plan_id: null }, { kind: "unavailable" });
  }

  return toView(row, await labelOf(supabase, row));
};

/** A succeeded job, or an interrupted one that kept a board — both undelivered, both deliverable. */
const deliverable = (row: StatusRow): boolean =>
  row.delivered_plan_id === null &&
  (row.status === "succeeded" || (row.status === "interrupted" && row.checkpoint_stage_index !== null));

/** A terminal job with nothing to deliver: its clone can only ever be litter. */
const sweepable = (row: StatusRow): boolean =>
  row.status === "failed" || (row.status === "interrupted" && row.checkpoint_stage_index === null);

// --- reclaim ----------------------------------------------------------------------------------

/** The shared CAS, applied to the row this visit just read. See `generation-reclaim.ts`. */
const reclaimIfStale = async (supabase: SupabaseClient, row: StatusRow): Promise<StatusRow> => {
  const reclaimed = await reclaimStaleJob(supabase, row);
  return reclaimed === null
    ? row
    : { ...row, status: "interrupted", error: reclaimed.error, finished_at: reclaimed.finishedAt };
};

// --- delivery ---------------------------------------------------------------------------------

/**
 * Verify → translate → apply → mark, in that order and for that reason. The marker goes LAST: a crash
 * between apply and mark simply re-applies on the next visit, which the region-replace absorbs (it
 * states each cell's complete final content), whereas marking first would strand a proposal plan that
 * was never actually written.
 *
 * A succeeded job delivers its `result`; an interrupted one delivers its `checkpoint`. Nothing else
 * differs — S-303 shaped a checkpoint through `wire_result(to_generation_result(...))`, the exact path
 * the terminal write uses, precisely so that this chain would not need a second branch.
 */
const deliver = async (supabase: SupabaseClient, planId: string, row: StatusRow): Promise<GenerationJobView> => {
  const proposalPlanId = row.proposal_plan_id;
  if (proposalPlanId === null) {
    // The clone is gone — deleted by hand, or nulled by `on delete set null`. Nowhere to deliver to.
    await failJob(supabase, row.id, "the proposal plan no longer exists, so the result cannot be delivered");
    return toView({ ...row, status: "failed" }, { kind: "unavailable" });
  }

  const { snapshot, result } = await loadPayload(supabase, row.id, payloadColumn(row));

  // A succeeded job with nothing to place cannot become a proposal: "ready" would link to a board
  // that is just the clone's own pins. Unreachable via the UI (Generate is disabled on a complete
  // plan) but reachable via the action — terminal, with the same handling as a failed verdict.
  if (result.placements.length === 0) {
    await failJob(supabase, row.id, "the solver returned a result with no placements");
    await deleteOrphanClone(supabase, proposalPlanId);
    return toView({ ...row, status: "failed", proposal_plan_id: null }, { kind: "unavailable" });
  }

  // The relocated runner seam (FR-313), with a trivial engine handing back the already-solved board.
  // Deliberately `runVerifiedGeneration` and not a bare `verifyGeneration`: it re-runs the pins
  // precondition against the same snapshot the solver validated — an idempotent re-check, and the
  // seam the roadmap names.
  const outcome = await runVerifiedGeneration(() => Promise.resolve(result), snapshot, { budgetMs: 0 });
  if (!outcome.verdict.ok) {
    await failJob(
      supabase,
      row.id,
      `the returned board did not pass verification: ${outcome.verdict.reasons.join("; ")}`,
    );
    await deleteOrphanClone(supabase, proposalPlanId);
    return toView({ ...row, status: "failed", proposal_plan_id: null }, { kind: "unavailable" });
  }

  let translated: GeneratedPlacement[];
  try {
    translated = translateCourseIds(result.placements, await courseIdMap(supabase, planId, proposalPlanId));
  } catch (cause) {
    // A transient read failure stays retryable; only a natural-key mismatch is terminal.
    if (cause instanceof DomainError) throw cause;
    // The clone's catalog diverged from the source — the author edited the proposal between enqueue
    // and delivery, and no retry can mend a key mismatch. Fail the job with the diagnostic, and KEEP
    // the clone (it carries the very edits that caused the mismatch): detaching it is what protects
    // it from the failed-job orphan sweep above.
    const reason = cause instanceof Error ? cause.message : String(cause);
    await failJob(supabase, row.id, `the result could not be translated onto the proposal plan: ${reason}`, {
      detachClone: true,
    });
    return toView({ ...row, status: "failed", proposal_plan_id: null }, { kind: "unavailable" });
  }
  await applyToProposal(supabase, proposalPlanId, translated);
  await markDelivered(supabase, row.id, proposalPlanId);

  return toView(
    { ...row, delivered_plan_id: proposalPlanId },
    deriveCleanLabel(row.stages, computePinnedSoftFloor(snapshot)),
  );
};

/** Source→clone `courseId` translation, built from both catalogs' natural keys. */
const courseIdMap = async (
  supabase: SupabaseClient,
  sourcePlanId: string,
  proposalPlanId: string,
): Promise<Map<string, string>> => {
  const [source, clone] = await Promise.all([
    courseIdentities(supabase, sourcePlanId),
    courseIdentities(supabase, proposalPlanId),
  ]);
  return buildCourseIdMap(source, clone);
};

const courseIdentities = async (supabase: SupabaseClient, planId: string): Promise<CourseIdentityIndex> => {
  const perCohort = await Promise.all(
    COHORT_VALUES.map(
      async (cohort) => [cohort, (await loadCohortCourses(supabase, planId, cohort)).courseIdentity] as const,
    ),
  );
  return Object.fromEntries(perCohort) as CourseIdentityIndex;
};

type RegionRow = {
  cohort: Cohort;
  courseId: string;
  day: number;
  period: number;
  week: PlacementWeek;
  isOptional: boolean;
};

/**
 * Region-replace the generated cells on the proposal plan, through the slice's existing domain
 * function — the same RPC and the same wrapper the board's own apply uses, rather than a second
 * region shape re-derived from `bench/`.
 *
 * The clone was made with `includeBoard`, so it already carries the author's pins. A region replace
 * states each cell's COMPLETE final content, so any pin sharing a cell with a generated row has to
 * travel in the payload too — otherwise applying the proposal would silently delete the very pins the
 * solve treated as fixed.
 */
const applyToProposal = async (
  supabase: SupabaseClient,
  proposalPlanId: string,
  placements: GeneratedPlacement[],
): Promise<void> => {
  const cells = [...new Map(placements.map((row) => [cellKey(row), cellOf(row)])).values()];
  const generated: RegionRow[] = placements.map((row) => ({ ...row, isOptional: false }));
  await applyGeneratedPlacements(supabase, {
    planId: proposalPlanId,
    cells,
    placements: [...generated, ...(await survivingPins(supabase, proposalPlanId, cells, generated))],
  });
};

/** The clone's own rows inside the replaced region that are NOT being replaced — the pins to keep. */
const survivingPins = async (
  supabase: SupabaseClient,
  proposalPlanId: string,
  cells: { cohort: Cohort; day: number; period: number }[],
  generated: RegionRow[],
): Promise<RegionRow[]> => {
  const { data, error } = await supabase
    .from("placements")
    .select("cohort, course_id, day, period, week, is_optional")
    .eq("plan_id", proposalPlanId);
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to read the proposal board: ${error.message}`);

  const inRegion = new Set(cells.map(cellKey));
  const replaced = new Set(generated.map(rowKey));
  return data
    .map(
      (row): RegionRow => ({
        cohort: row.cohort,
        courseId: row.course_id,
        day: row.day,
        period: row.period,
        week: row.week,
        isOptional: row.is_optional,
      }),
    )
    .filter((row) => inRegion.has(cellKey(row)) && !replaced.has(rowKey(row)));
};

const cellOf = (row: { cohort: Cohort; day: number; period: number }) => ({
  cohort: row.cohort,
  day: row.day,
  period: row.period,
});

const cellKey = (row: { cohort: Cohort; day: number; period: number }): string =>
  `${row.cohort}|${String(row.day)}|${String(row.period)}`;

const rowKey = (row: { cohort: Cohort; courseId: string; day: number; period: number }): string =>
  `${cellKey(row)}|${row.courseId}`;

// --- row access -------------------------------------------------------------------------------

const latestJob = async (supabase: SupabaseClient, planId: string): Promise<StatusRow | null> => {
  const { data, error } = await supabase
    .from("generation_jobs")
    .select(STATUS_COLUMNS)
    .eq("plan_id", planId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to read the generation job: ${error.message}`);
  if (data === null) return null;
  // `stages` is the one column here that arrives as untyped jsonb, so it is parsed rather than cast:
  // a malformed transcript degrades the clean label to `unavailable` instead of feeding
  // `deriveCleanLabel` a shape it will read a confident wrong number out of. Everything else in
  // STATUS_COLUMNS is a scalar the check constraints already pin.
  const row = data as unknown as Omit<StatusRow, "stages"> & { stages: unknown };
  return { ...row, stages: parseStoredStages(row.stages) };
};

/** Which column holds the board this job is delivering. `result` stays the succeeded-only one. */
type PayloadColumn = "result" | "checkpoint";

const payloadColumn = (row: StatusRow): PayloadColumn => (row.status === "interrupted" ? "checkpoint" : "result");

/** The heavy pair, fetched ONLY once a job is known to be deliverable-and-undelivered. */
const loadPayload = async (
  supabase: SupabaseClient,
  jobId: string,
  column: PayloadColumn,
): Promise<{ snapshot: GeneratorSnapshot; result: GenerationResult }> => {
  const { data, error } = await supabase.from("generation_jobs").select(`snapshot, ${column}`).eq("id", jobId).single();
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to read the solved snapshot: ${error.message}`);
  const payload = (data as unknown as Record<PayloadColumn, unknown>)[column];
  if (!payload) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `The job is deliverable but carries no ${column}.`);
  }
  return {
    snapshot: (data as unknown as { snapshot: unknown }).snapshot as GeneratorSnapshot,
    result: payload as GenerationResult,
  };
};

/**
 * The label for a job this call did not just deliver.
 *
 * Short-circuits before touching `snapshot`: an undelivered job has nothing to be clean about, and a
 * tier-5 `best` of 0 is clean regardless of the floor. Only a non-zero value has to be interpreted
 * against the floor, and only then is the ~124 KB column worth reading.
 */
const labelOf = async (supabase: SupabaseClient, row: StatusRow): Promise<CleanLabel> => {
  if (row.delivered_plan_id === null) return { kind: "unavailable" };
  const achieved = softHitsAchieved(row.stages);
  if (achieved === undefined) return { kind: "unavailable" };
  if (achieved === 0) return { kind: "clean" };

  const { data, error } = await supabase.from("generation_jobs").select("snapshot").eq("id", row.id).single();
  if (error) return { kind: "unavailable" };
  return deriveCleanLabel(row.stages, computePinnedSoftFloor(data.snapshot as unknown as GeneratorSnapshot));
};

const markDelivered = async (supabase: SupabaseClient, jobId: string, proposalPlanId: string): Promise<void> => {
  // Losing this CAS is not an error: it means another tab delivered the identical verified board.
  const { error } = await supabase
    .from("generation_jobs")
    .update({ delivered_plan_id: proposalPlanId })
    .eq("id", jobId)
    .is("delivered_plan_id", null);
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to mark the job delivered: ${error.message}`);
};

const failJob = async (
  supabase: SupabaseClient,
  jobId: string,
  reason: string,
  options: { detachClone?: boolean } = {},
): Promise<void> => {
  const { error } = await supabase
    .from("generation_jobs")
    .update({
      status: "failed",
      error: reason,
      finished_at: new Date().toISOString(),
      ...(options.detachClone ? { proposal_plan_id: null } : {}),
    })
    .eq("id", jobId);
  // eslint-disable-next-line no-console
  if (error) console.error(`[checkGeneration] could not mark job ${jobId} failed:`, error.message);
};

const deleteOrphanClone = async (supabase: SupabaseClient, proposalPlanId: string): Promise<void> => {
  const { error } = await supabase.from("plans").delete().eq("id", proposalPlanId);
  // eslint-disable-next-line no-console
  if (error) console.error(`[checkGeneration] could not delete orphan clone ${proposalPlanId}:`, error.message);
};

const toView = (row: StatusRow, cleanLabel: CleanLabel): GenerationJobView => ({
  jobId: row.id,
  status: row.status,
  proposalPlanId: row.proposal_plan_id,
  delivered: row.delivered_plan_id !== null,
  error: row.error,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
  cleanLabel,
  checkpointStageIndex: row.checkpoint_stage_index,
});
