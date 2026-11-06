import { isActiveJobStatus } from "@/entities/timetable";
import type { GenerationJobView } from "../../api/generation-read";

export type StopPermission = {
  /** The route's `allows(access, "edit")`: a viewer, a demoted requester included, never stops. */
  canEdit: boolean;
  /** The signed-in user's id, from the route; null when there is no session. */
  viewerId: string | null;
  /** The route's `allows(access, "stop_any_job")`: an admin stops anyone's job. */
  canStopAnyJob: boolean;
};

/**
 * Whether this viewer gets the Stop control on this job (S-407): the client's copy of the rule that
 * `generation_jobs_guard_attribution` enforces. An editor may stop a job they requested, a job that
 * records no requester (it predates S-407, or its requester was deleted), and, with `stop_any_job`,
 * anyone's. Everyone else sees no control at all: absent, never disabled.
 *
 * Decided from the polled view, so it holds on every tick, including after a first read that failed.
 */
export const canStopJob = (job: GenerationJobView, { canEdit, viewerId, canStopAnyJob }: StopPermission): boolean =>
  canEdit &&
  isActiveJobStatus(job.status) &&
  (canStopAnyJob || job.requestedBy === null || job.requestedBy === viewerId);
