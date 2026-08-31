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
  isActiveJobStatus,
  isDeliverableJob,
  isHaltedJobStatus,
  isSweepableJob,
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
 * **The trigger is a visit to EITHER plan.** This satisfies FR-313's *location* requirement — the
 * oracle runs server-side in the delivery pipeline, not in a browser. Nothing here polls on the hub:
 * S-303's plans-list poll is status-only and never calls this function, because running delivery on a
 * timer from a page the author is not looking at is exactly what that separation avoids. S-306 adds
 * the second key: the proposal plan's own page also reaches this file, and while that plan is pending
 * it renders progress instead of a board — so it may poll, and the poll may deliver, because delivery
 * from that page is delivery *to* that page.
 *
 * **The board lands on the PROPOSAL, never on the source.** That is the whole of S-306's delivery
 * rule (PRD FR-307, re-grounded twice on 2026-08-28): there is no merge and no drift gate, so the
 * author's source plan is never written to by this pipeline. `plans.pending_proposal` marks the clone
 * un-editable from the moment enqueue creates it until the moment this file clears it.
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
  /** The TIER whose checkpoint an interrupted job kept, or null when it kept nothing. */
  checkpointStageIndex: number | null;
  /** The TIER now running, 1-based — the pending page's live progress. Null before the first stage. */
  stageIndex: number | null;
  stageName: string | null;
};

/** Everything the strip renders, and none of the ~160 KB of payload beside it. `heartbeat_at` is the
 *  staleness clock and `checkpoint_stage_index` the free existence proxy for the ~35 KB checkpoint. */
const STATUS_COLUMNS =
  "id,plan_id,status,proposal_plan_id,delivered_plan_id,delivery,stages,error,created_at,finished_at,heartbeat_at,checkpoint_stage_index,notified_at,stage_index,stage_name";

type StatusRow = {
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
};

/**
 * The visit, whichever plan it is a visit to.
 *
 * **One entry point, two keys.** `generation_jobs` names two plans — the `plan_id` it solved from and
 * the `proposal_plan_id` it solves onto — and both are now pages an author can be standing on. Rather
 * than two functions racing to deliver the same board, there is one dual-keyed read and one shared
 * `settle` core; the only thing the key decides is the `role` the view is tagged with, and therefore
 * which story the strip tells.
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
export const checkPlan = async (supabase: SupabaseClient, input: CheckPlanInput): Promise<GenerationJobView | null> => {
  const [asSource, asProposal] = await Promise.all([
    latestJobBy(supabase, "plan_id", input.planId),
    latestJobBy(supabase, "proposal_plan_id", input.planId),
  ]);

  const row = pickJob(asSource, asProposal);
  if (!row) return null;

  const role: GenerationJobRole = row === asSource ? "source" : "proposal";
  const view = await settle(supabase, row);
  if (role === "source") return { ...view, role };

  // Looking at the delivered proposal IS the notification (FR-309), so this visit is what stamps it.
  await markNotified(supabase, view, row.notified_at);
  return { ...view, role, sourcePlanName: await planName(supabase, view.sourcePlanId) };
};

/**
 * Stamp `notified_at` the first time the author actually looks at a delivered proposal.
 *
 * **The event this closes is a row transition, not a render** — `delivered_plan_id is not null and
 * notified_at is null` means "there is a result and nobody has been told". The hub reads that pair
 * to keep "Ready — open" on the badge across reloads; without a writer the badge would never clear.
 * S-310's emailer is the intended SECOND writer and must skip rows that already carry a value.
 *
 * Only on the PROPOSAL role, and deliberately: the author has to have opened the plan the board
 * landed on for the announcement to have been made. Visiting the source tells them nothing about it —
 * the source's strip says nothing at all once a job is delivered.
 *
 * A plain update, not a CAS. Two tabs racing this write the same fact a few milliseconds apart, and a
 * later instant overwriting an earlier one is harmless: the only reader asks whether it is null.
 */
const markNotified = async (
  supabase: SupabaseClient,
  view: GenerationJobView,
  notifiedAt: string | null,
): Promise<void> => {
  if (!view.delivered || notifiedAt !== null) return;
  const { error } = await supabase
    .from("generation_jobs")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", view.jobId);
  // Best-effort: failing to record the announcement must not fail the visit that made it. The badge
  // simply stays up until the next visit succeeds.
  // eslint-disable-next-line no-console
  if (error) console.error(`[checkPlan] could not stamp notified_at on job ${view.jobId}:`, error.message);
};

/** The precedence in the docblock above, as one expression. */
const pickJob = (asSource: StatusRow | null, asProposal: StatusRow | null): StatusRow | null => {
  const undelivered = asSource !== null && asSource.delivered_plan_id === null && asSource.delivery === null;
  if (asSource && (isActiveJobStatus(asSource.status) || undelivered)) return asSource;
  return asProposal ?? asSource;
};

/**
 * Reclaim → deliver | sweep | label: everything that happens to a job row once a visit has found it.
 *
 * Extracted from `checkPlan` so the two keys share ONE settle path rather than two that must be kept
 * in step. It takes no plan id of its own: the source plan is `row.plan_id` by definition, and using
 * the visited plan's id here would translate course ids against the wrong catalog whenever the visit
 * came in through the proposal.
 */
const settle = async (supabase: SupabaseClient, latest: StatusRow): Promise<GenerationJobView> => {
  // BEFORE the delivery branch, so a crash-wedged row becomes `interrupted` and delivers its
  // checkpoint in the SAME visit rather than making the author come back a second time.
  const row = await reclaimIfStale(supabase, latest);

  if (isDeliverableJob(row)) return deliver(supabase, row.plan_id, row);

  // An orphan clone is one nothing will ever be delivered onto, and leaving it clutters the plans
  // list with a half-made proposal. Guarded twice over — only this job's own `proposal_plan_id`, and
  // only while nothing has been delivered. S-304 decided the question the old comment here left open:
  // an `interrupted` clone is SALVAGE when the row carries a checkpoint (handled above) and litter
  // when it does not — and S-306 answers `stopped` the same way, since the two differ only in who
  // halted the run. A swept clone needs no `pending_proposal` clear: the row is gone.
  if (isSweepableJob(row) && row.delivered_plan_id === null && row.proposal_plan_id !== null) {
    await deleteOrphanClone(supabase, row.proposal_plan_id);
    return toView({ ...row, proposal_plan_id: null }, { kind: "unavailable" });
  }

  return toView(row, await labelOf(supabase, row));
};

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
    // Reachable only for a job that never delivered: `isDeliverableJob` consults `delivery`, so the
    // deleted proposal of a job that DID deliver never gets here.
    //
    // The reason is hoisted because the view is built from the row as it was READ, before `failJob`
    // wrote — so spreading `row` alone would render a bare "Generation failed." on the one visit that
    // caused the failure, and the explanation only from the next visit on.
    const reason = "the proposal plan no longer exists, so the result cannot be delivered";
    await failJob(supabase, row.id, reason);
    return toView({ ...row, status: "failed", error: reason }, { kind: "unavailable" });
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
    // The one terminal branch that leaves a clone ALIVE, so the one that must un-pend it by hand.
    // Without this the plan is stranded read-only forever: no job references it any more, so nothing
    // would ever clear the flag. (Near-unreachable since S-306 — the catalog cannot be edited while
    // pending — but "near" is not "never": a service-role write, or a clone detached by an earlier
    // failure, can still get here.)
    //
    // Un-pend BEFORE detaching. Once `proposal_plan_id` is null no visit can find this plan's job
    // again, so a crash between the two writes would strand it read-only with no retry. Cleared first,
    // a crash leaves the job still deliverable: the next visit re-enters, re-hits the same mismatch
    // and detaches — the same asymmetric-crash argument the clear-before-mark ordering below rests on.
    await clearPending(supabase, proposalPlanId);
    await failJob(supabase, row.id, `the result could not be translated onto the proposal plan: ${reason}`, {
      detachClone: true,
    });
    return toView({ ...row, status: "failed", proposal_plan_id: null }, { kind: "unavailable" });
  }
  await applyToProposal(supabase, proposalPlanId, translated);
  // BETWEEN the apply and the marker, and that ordering is the same argument the marker's own
  // position rests on. A crash here leaves `delivered_plan_id` null, so the next visit re-enters
  // `deliver()`, re-applies (the region replace absorbs it) and re-clears — whereas clearing after
  // the marker would strand a delivered plan read-only if the process died in between.
  await clearPending(supabase, proposalPlanId);
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
  // `stages` is the one column here that arrives as untyped jsonb, so it is parsed rather than cast:
  // a malformed transcript degrades the clean label to `unavailable` instead of feeding
  // `deriveCleanLabel` a shape it will read a confident wrong number out of. Everything else in
  // STATUS_COLUMNS is a scalar the check constraints already pin.
  const row = data as unknown as Omit<StatusRow, "stages"> & { stages: unknown };
  return { ...row, stages: parseStoredStages(row.stages) };
};

/** Which column holds the board this job is delivering. `result` stays the succeeded-only one. */
type PayloadColumn = "result" | "checkpoint";

const payloadColumn = (row: StatusRow): PayloadColumn => (isHaltedJobStatus(row.status) ? "checkpoint" : "result");

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

/**
 * Un-pend the proposal: it stops being a job artifact and becomes an ordinary plan.
 *
 * Loud rather than best-effort, unlike `failJob`/`deleteOrphanClone` beside it. A clone left pending
 * is a plan nobody can rename, clone, delete or open past its progress page — the failure mode is a
 * permanently stranded row, not a bit of litter — so the caller must hear about it.
 */
const clearPending = async (supabase: SupabaseClient, proposalPlanId: string): Promise<void> => {
  const { error } = await supabase.from("plans").update({ pending_proposal: false }).eq("id", proposalPlanId);
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to release the proposal plan: ${error.message}`);
  }
};

const markDelivered = async (supabase: SupabaseClient, jobId: string, proposalPlanId: string): Promise<void> => {
  // Losing this CAS is not an error: it means another tab delivered the identical verified board.
  // `delivery` rides along in the SAME update so the pair can never disagree — the vocabulary has
  // exactly one value (`'proposal'`, checked in the schema) because the source is never a target.
  const { error } = await supabase
    .from("generation_jobs")
    .update({ delivered_plan_id: proposalPlanId, delivery: "proposal" })
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
  if (error) console.error(`[checkPlan] could not mark job ${jobId} failed:`, error.message);
};

const deleteOrphanClone = async (supabase: SupabaseClient, proposalPlanId: string): Promise<void> => {
  const { error } = await supabase.from("plans").delete().eq("id", proposalPlanId);
  // eslint-disable-next-line no-console
  if (error) console.error(`[checkPlan] could not delete orphan clone ${proposalPlanId}:`, error.message);
};

/** The source plan's display name, for the proposal strip's "Generated from <name>" provenance. */
const planName = async (supabase: SupabaseClient, planId: string): Promise<string | null> => {
  const { data } = await supabase.from("plans").select("name").eq("id", planId).maybeSingle();
  return data?.name ?? null;
};

/**
 * `role` defaults to `source` and `checkPlan` overrides it, because every path INSIDE this file
 * describes the job from the source's point of view — it is the source's snapshot, the source's
 * catalog the ids translate from. Only the entry point knows which page asked.
 */
const toView = (row: StatusRow, cleanLabel: CleanLabel): GenerationJobView => ({
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
});
