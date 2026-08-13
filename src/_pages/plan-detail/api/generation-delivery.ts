import { z } from "zod";
import { loadCohortCourses, type SupabaseClient } from "@/shared/api";
import { COHORT_VALUES, type Cohort, type PlacementWeek } from "@/shared/config";
import { DomainError } from "@/shared/lib/errors";
import {
  buildCourseIdMap,
  computePinnedSoftFloor,
  deriveCleanLabel,
  runVerifiedGeneration,
  softHitsAchieved,
  translateCourseIds,
  type CleanLabel,
  type CourseIdentityIndex,
  type GeneratedPlacement,
  type GenerationResult,
  type GeneratorSnapshot,
  type StoredStageReport,
} from "@/entities/timetable";
import { applyGeneratedPlacements } from "./placements";

/**
 * The delivery half of S-301: read a plan's latest job back, and if it succeeded and has not been
 * delivered, verify the board SERVER-SIDE, translate it into the clone's id space, and apply it.
 *
 * **The trigger is a visit, and the plan says so out loud.** This satisfies FR-313's *location*
 * requirement — the oracle runs server-side in the delivery pipeline, not in a browser — but not its
 * *rationale* ("so headless delivery is verified without a browser open"). Nothing here polls; S-303
 * adds that, S-306 adds drift-decided delivery. Until then the author's return to the page is the clock.
 *
 * **Idempotent under concurrent invocation**, because two tabs firing the on-visit check is the
 * normal case rather than an edge one. The delivered marker is a compare-and-set
 * (`… where id = … and delivered_plan_id is null`), so exactly one caller writes it and the loser
 * reports the same delivered state.
 *
 * **Narrow projections are a correctness-adjacent rule here, not an optimisation.** `snapshot` is
 * ~124 KB TOASTed and `result` ~35 KB; the status read touches neither, and the heavy pair is fetched
 * only once a job is known to be succeeded-and-undelivered. Even the clean label short-circuits: a
 * tier-5 `best` of 0 is clean whatever the floor is, so the snapshot is re-read only when a non-zero
 * value genuinely needs the floor to be interpreted.
 *
 * **An unverified board never lands.** A failing verdict marks the job `failed` with the oracle's
 * reasons and removes the orphan clone; nothing partial is ever written, because the apply is one
 * plpgsql transaction.
 */
export const checkGenerationInput = z.object({ planId: z.uuid() });

export type CheckGenerationInput = z.infer<typeof checkGenerationInput>;

export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed" | "stopped" | "interrupted";

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
};

/** Everything the strip renders, and none of the ~160 KB of payload beside it. */
const STATUS_COLUMNS = "id,status,proposal_plan_id,delivered_plan_id,stages,error,created_at,finished_at";

type StatusRow = {
  id: string;
  status: GenerationJobStatus;
  proposal_plan_id: string | null;
  delivered_plan_id: string | null;
  stages: StoredStageReport[];
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export const checkGeneration = async (
  supabase: SupabaseClient,
  input: CheckGenerationInput,
): Promise<GenerationJobView | null> => {
  const row = await latestJob(supabase, input.planId);
  if (!row) return null;

  if (row.status === "succeeded" && row.delivered_plan_id === null) return deliver(supabase, input.planId, row);

  // A failed job's clone is an orphan: nothing will ever be delivered onto it, and leaving it would
  // clutter the plans list with a half-made proposal. Guarded twice over — only this job's own
  // `proposal_plan_id`, and only while nothing has been delivered. `stopped`/`interrupted` are
  // deliberately NOT swept here: those states belong to S-305/S-304, which will decide whether their
  // clones are salvage or litter.
  if (row.status === "failed" && row.delivered_plan_id === null && row.proposal_plan_id !== null) {
    await deleteOrphanClone(supabase, row.proposal_plan_id);
    return toView({ ...row, proposal_plan_id: null }, { kind: "unavailable" });
  }

  return toView(row, await labelOf(supabase, row));
};

// --- delivery ---------------------------------------------------------------------------------

/**
 * Verify → translate → apply → mark, in that order and for that reason. The marker goes LAST: a crash
 * between apply and mark simply re-applies on the next visit, which the region-replace absorbs (it
 * states each cell's complete final content), whereas marking first would strand a proposal plan that
 * was never actually written.
 */
const deliver = async (supabase: SupabaseClient, planId: string, row: StatusRow): Promise<GenerationJobView> => {
  const proposalPlanId = row.proposal_plan_id;
  if (proposalPlanId === null) {
    // The clone is gone — deleted by hand, or nulled by `on delete set null`. Nowhere to deliver to.
    await failJob(supabase, row.id, "the proposal plan no longer exists, so the result cannot be delivered");
    return toView({ ...row, status: "failed" }, { kind: "unavailable" });
  }

  const { snapshot, result } = await loadPayload(supabase, row.id);

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

  const courseIds = await courseIdMap(supabase, planId, proposalPlanId);
  await applyToProposal(supabase, proposalPlanId, translateCourseIds(result.placements, courseIds));
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
  if (placements.length === 0) return;
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
  return data === null ? null : (data as unknown as StatusRow);
};

/** The heavy pair, fetched ONLY once a job is known to be succeeded-and-undelivered. */
const loadPayload = async (
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ snapshot: GeneratorSnapshot; result: GenerationResult }> => {
  const { data, error } = await supabase.from("generation_jobs").select("snapshot, result").eq("id", jobId).single();
  if (error) throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to read the solved snapshot: ${error.message}`);
  if (!data.result) throw new DomainError("INTERNAL_SERVER_ERROR", "The job reports success but carries no result.");
  return {
    snapshot: data.snapshot as unknown as GeneratorSnapshot,
    result: data.result as unknown as GenerationResult,
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

const failJob = async (supabase: SupabaseClient, jobId: string, reason: string): Promise<void> => {
  const { error } = await supabase
    .from("generation_jobs")
    .update({ status: "failed", error: reason, finished_at: new Date().toISOString() })
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
});
