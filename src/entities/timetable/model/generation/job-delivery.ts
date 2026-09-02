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
 * **The delivered case is the same failure, and it is why `delivery` is here.** The paragraph above
 * used to close with "once delivered the plan is no longer pending, so this guard is not consulted at
 * all" — scope, stated as safety. It was neither: `delivered_plan_id` is ALSO `on delete set null`, so
 * deleting a proposal that already delivered nulls the pointer, makes the row deliverable again, and
 * the source plan's next visit fails a solve that worked. `delivery` is the durable half of that fact
 * — written by `markDelivered` in the SAME statement as the pointer, and a plain vocabulary column no
 * foreign key can reach — so "has this ever delivered?" is asked of `delivery`, and only "where did it
 * land?" of `delivered_plan_id`.
 *
 * A cross-`_pages` import is a steiger error, so "share it" means "lift it to the entity" — and the
 * predicates are pure functions of a row shape, which is exactly what belongs here.
 */
/** The delivery vocabulary — exactly one value, checked in the schema: the source is never a
 *  target. WRITERS must use this type (`"proposal" satisfies GenerationJobDelivery`) so a typo'd
 *  write cannot compile. Read-side row types stay `string | null` on purpose: the predicates treat
 *  ANY non-null as "has delivered" — fail-safe for a value this build does not recognise — and
 *  narrowing them would force casts at every select boundary, against the drop-never-cast rule. */
export type GenerationJobDelivery = "proposal";

export type DeliverableJobRow = {
  status: GenerationJobStatus;
  delivered_plan_id: string | null;
  /** The delivery vocabulary (`'proposal'`, or null while nothing has landed) — see
   *  {@link GenerationJobDelivery} for why this reads wide. The fact half of
   *  `delivered_plan_id`, and the half that survives the proposal plan being deleted. */
  delivery: string | null;
  /** The ladder position whose checkpoint a halted job kept. Null when it kept nothing — the free existence
   *  proxy for the ~35 KB `checkpoint` column, so neither caller has to read it. */
  checkpoint_stage_index: number | null;
};

/**
 * A succeeded job, or a halted one that kept a board — undelivered in either case, and never
 * delivered before.
 *
 * `stopped` sits beside `interrupted` because the two differ only in WHO halted the run: the author
 * asked (S-305), or the platform took the container away (S-304). A checkpoint is a checkpoint,
 * written through the same wire path, and it delivers through the same chain — which is why S-305
 * needed no delivery change at all, only a producer.
 *
 * Both null checks are load-bearing and they ask different questions. `delivered_plan_id === null`
 * is "is there still somewhere to deliver to" — a live pointer means the board is already there.
 * `delivery === null` is "has this row ever delivered at all", which is the only one of the two that
 * survives the proposal's deletion. A job may be re-delivered exactly never.
 */
export const isDeliverableJob = (row: DeliverableJobRow): boolean =>
  row.delivered_plan_id === null &&
  row.delivery === null &&
  (row.status === "succeeded" || (isHaltedJobStatus(row.status) && row.checkpoint_stage_index !== null));

/** A terminal job with nothing to deliver: its clone can only ever be litter. */
export const isSweepableJob = (row: DeliverableJobRow): boolean =>
  row.status === "failed" || (isHaltedJobStatus(row.status) && row.checkpoint_stage_index === null);

/** Stopped short of the ladder's end — by the author (`stopped`) or by the platform (`interrupted`). */
export const isHaltedJobStatus = (status: GenerationJobStatus): boolean =>
  status === "interrupted" || status === "stopped";
