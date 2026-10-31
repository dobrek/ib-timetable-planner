import { isActiveJobStatus, isHaltedJobStatus } from "@/entities/timetable";
import type { GenerationJobView } from "../../api/generation-read";

/**
 * Which line the board's generation strip shows (S-306, S-405), as a named state rather than an
 * if-ladder — the strip's counterpart of `resolvePendingPanel`, which picks the pending proposal
 * page's panel for the same job rows.
 *
 *   - **provenance:** the job is this plan's own origin (it is the proposal). The strip then says
 *     where the board came from, once delivered.
 *   - **stalled** — a viewer's: an active job that went quiet. An editor's visit has already reclaimed
 *     it, unless a heartbeat won that race, and then it is alive and reads `active`.
 *   - **active:** queued or running — the advisory line pointing at the proposal (FR-308).
 *   - **failed:** the reason, here, because a failed job has no proposal left to carry it.
 *   - **halted:** stopped or interrupted before any stage finished, so there is nothing to deliver.
 *   - **awaiting-author** — a viewer's: a finished board an editor's visit would have delivered.
 *   - **none:** delivered (the result lives on the proposal, not here), or a terminal board that an
 *     editor's visit is landing.
 */
export type StatusStrip = "provenance" | "stalled" | "active" | "failed" | "halted" | "awaiting-author" | "none";

export const resolveStatusStrip = (job: GenerationJobView, canEdit: boolean): StatusStrip => {
  if (job.role === "proposal") return "provenance";
  if (job.stalled && !canEdit) return "stalled";
  if (isActiveJobStatus(job.status)) return "active";
  if (job.status === "failed") return "failed";
  if (isHaltedJobStatus(job.status) && job.checkpointStageIndex === null) return "halted";
  if (job.awaitingDelivery && !canEdit) return "awaiting-author";
  return "none";
};
