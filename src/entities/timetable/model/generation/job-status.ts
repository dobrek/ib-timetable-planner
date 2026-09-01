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
 * is it over? All six now have producers — `interrupted` from S-304 (a SIGTERM'd container, or the
 * app's staleness reclaim) and `stopped` from S-305 (the author asking) — and both are terminal by
 * construction: nothing advances a row out of either. The two are deliberately distinct statuses
 * rather than one halted state, because who ended the run is what the copy has to say.
 */
export const GENERATION_JOB_STATUSES = ["queued", "running", "succeeded", "failed", "stopped", "interrupted"] as const;

export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number];

export const isGenerationJobStatus = (raw: string): raw is GenerationJobStatus =>
  (GENERATION_JOB_STATUSES as readonly string[]).includes(raw);

export const isActiveJobStatus = (status: GenerationJobStatus): boolean => status === "queued" || status === "running";

export const isTerminalJobStatus = (status: GenerationJobStatus): boolean => !isActiveJobStatus(status);
