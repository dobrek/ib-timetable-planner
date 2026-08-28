import type { GenerationJobStatus } from "./job-status";

/**
 * Whether a job row has a board waiting to land, and whether its clone is litter — the two questions
 * every consumer of `generation_jobs` eventually asks, written down once.
 *
 * They lived in `plan-detail/api/generation-delivery.ts` until S-306, which is where they are ACTED
 * on. They moved here when a second slice needed to ask without acting: the plans hub refuses to
 * delete a proposal whose board has not been delivered yet, because `proposal_plan_id` is
 * `on delete set null` and `deliver()` on a null proposal marks the job failed — so a deliberate
 * delete of a ready proposal would surface as a red failure the author never caused. That refusal has
 * to mean exactly what delivery means. Two copies of this predicate drifting apart would either
 * strand a deletable plan or let a deliverable one be deleted, and neither would be visible until it
 * happened to someone.
 *
 * A cross-`_pages` import is a steiger error, so "share it" means "lift it to the entity" — and the
 * predicates are pure functions of a row shape, which is exactly what belongs here.
 */
export type DeliverableJobRow = {
  status: GenerationJobStatus;
  delivered_plan_id: string | null;
  /** The tier whose checkpoint a halted job kept. Null when it kept nothing — the free existence
   *  proxy for the ~35 KB `checkpoint` column, so neither caller has to read it. */
  checkpoint_stage_index: number | null;
};

/**
 * A succeeded job, or a halted one that kept a board — undelivered in either case.
 *
 * `stopped` sits beside `interrupted` because the two differ only in WHO halted the run: the author
 * asked, or the platform took the container away. A checkpoint is a checkpoint, written through the
 * same wire path, and it delivers through the same chain. S-305 owns the PRODUCER of a `stopped` row;
 * admitting one for delivery is S-306's one-predicate down-payment on it.
 */
export const isDeliverableJob = (row: DeliverableJobRow): boolean =>
  row.delivered_plan_id === null &&
  (row.status === "succeeded" || (isHaltedJobStatus(row.status) && row.checkpoint_stage_index !== null));

/** A terminal job with nothing to deliver: its clone can only ever be litter. */
export const isSweepableJob = (row: DeliverableJobRow): boolean =>
  row.status === "failed" || (isHaltedJobStatus(row.status) && row.checkpoint_stage_index === null);

/** Stopped short of the ladder's end — by the author (`stopped`) or by the platform (`interrupted`). */
export const isHaltedJobStatus = (status: GenerationJobStatus): boolean =>
  status === "interrupted" || status === "stopped";
