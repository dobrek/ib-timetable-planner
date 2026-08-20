/**
 * The six-value `generation_jobs.status` vocabulary, and the one place it is written down.
 *
 * It mirrors the column's CHECK constraint, not the wire contract — job status is a *database*
 * vocabulary, deliberately distinct from `StageReport.status` (which is CP-SAT's) and from
 * `stopReason` (which is the engine's). Two page slices read it — plan-detail's delivery check and
 * the plans hub's activity indicator — so it lives in the entity rather than being declared twice or
 * imported across slices, which FSD forbids and steiger enforces.
 *
 * A CHECK constraint is not an enum, so Supabase's generated types type the column as `string`. That
 * is why :func:`isGenerationJobStatus` exists: a read narrows through it rather than casting, so a
 * status this build has never heard of is DROPPED at the boundary instead of reaching a `switch`
 * that has no branch for it.
 *
 * The active/terminal split below is what every consumer actually asks: is this job still going, or
 * is it over? `stopped` and `interrupted` have no producer yet (S-305 and S-304 own them), but they
 * are terminal by construction — nothing will advance a row out of either — so treating them as such
 * today is correct rather than provisional.
 */
export const GENERATION_JOB_STATUSES = ["queued", "running", "succeeded", "failed", "stopped", "interrupted"] as const;

export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number];

export const isGenerationJobStatus = (raw: string): raw is GenerationJobStatus =>
  (GENERATION_JOB_STATUSES as readonly string[]).includes(raw);

export const isActiveJobStatus = (status: GenerationJobStatus): boolean => status === "queued" || status === "running";

export const isTerminalJobStatus = (status: GenerationJobStatus): boolean => !isActiveJobStatus(status);
