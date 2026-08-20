import { z } from "zod";

/**
 * One rung of the solver's lexicographic ladder, as stored in `generation_jobs.stages`.
 *
 * This is a **projection of the frozen wire contract** (`contracts/generation-wire.schema.json`
 * `$defs/StageReport`), not a shape of our own: the solver writes the array, the app only ever reads
 * it. The schema is the source of the type rather than the other way round, so the two cannot drift;
 * `bench/contract-parity.test.ts` then holds it against the same ajv validator the goldens go through,
 * which is what makes "the JSON Schema is the contract" true on this side too.
 *
 * `strictObject` mirrors the contract's `additionalProperties: false`, and every optional is
 * `undefined`-or-absent rather than nullable — no property on this wire may be `null`.
 */
export const storedStageReportSchema = z.strictObject({
  /** 1-based TIER number, the stage's identity. Never an array position: `stages` is
   *  variable-length and possibly sparse (repair mode emits tiers 1 and 4 only). */
  tier: z.int().min(1),
  name: z.string().min(1),
  /** CP-SAT's own status vocabulary (OPTIMAL | FEASIBLE | INFEASIBLE | UNKNOWN | MODEL_INVALID),
   *  left unenumerated here exactly as the contract leaves it. */
  status: z.string().min(1),
  best: z.int().optional(),
  bound: z.int().optional(),
  wallClockS: z.number().min(0),
  /** Why a non-optimal stage ended when it did. Omitted on OPTIMAL, and on a stage with no solution
   *  to attribute. */
  stoppedBy: z.enum(["budget", "target", "cancelled"]).optional(),
});

export type StoredStageReport = z.infer<typeof storedStageReportSchema>;

export const storedStagesSchema = z.array(storedStageReportSchema);

/**
 * Read a stored `stages` column defensively: a malformed transcript yields `[]`, never a throw.
 *
 * The posture is deliberate and matches `deriveCleanLabel`'s: a board whose transcript is unreadable
 * is still a deliverable board — its cleanliness merely becomes `unavailable`. Refusing to deliver a
 * server-verified board because a diagnostic array drifted would be the worse of the two failures.
 */
export const parseStoredStages = (value: unknown): StoredStageReport[] => {
  const parsed = storedStagesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
};
