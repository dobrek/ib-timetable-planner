import { isActiveJobStatus } from "@/entities/timetable";
import type { GenerationJobView } from "../../api/generation-read";

/**
 * Which panel the pending proposal page shows (S-306), as a named state rather than a ternary chain.
 *
 * `stranded`, `stalled` and `awaiting-author` are the viewer's own (S-405). Each names a state an
 * editor's visit would have settled — released, reclaimed, delivered — and a viewer's write-free read
 * can only report:
 *
 *   - **stranded:** a pending proposal no job references. An editor's visit releases it.
 *   - **stalled:** an active job that went quiet. An editor's visit reclaims it, so for an editor the
 *     same row stays `progress`: by the time the page renders, the visit has already acted on it.
 *   - **awaiting-author:** a finished board that has not landed. An editor's visit delivers it.
 *
 * The rest are shared: `unreadable` when the read failed, `removed` when the page held a job and a
 * later read found none (an editor's visit swept the proposal), `delivered` for the reload's round
 * trip, `progress` while the ladder runs, `stopped` for a run halted before any stage finished, and
 * `failed` for every other ending without a board.
 */
export type PendingPanel =
  | "unreadable"
  | "removed"
  | "stranded"
  | "delivered"
  | "progress"
  | "stalled"
  | "awaiting-author"
  | "stopped"
  | "failed";

export type PendingPanelContext = {
  /** The caller may edit (`allows(access, "edit")`), computed once by the route. */
  canEdit: boolean;
  /** The route found the plan pending with no job referencing it, and the read did not fail. */
  stranded: boolean;
  /** The page has held a job for this proposal (`useHasTrackedJob`). A failed read throws and keeps
   *  the last snapshot, so a later null is a successful read that found the proposal gone. */
  tracked: boolean;
};

export const resolvePendingPanel = (job: GenerationJobView | null, context: PendingPanelContext): PendingPanel => {
  const { canEdit } = context;
  if (job === null) return whenNoJob(context);
  // Ahead of every terminal kind: a stopped row WITH a checkpoint delivers, and the delivering tick
  // publishes its snapshot before it navigates — so this is the reload's round trip, not a final state.
  if (job.delivered) return "delivered";
  if (isActiveJobStatus(job.status)) return job.stalled && !canEdit ? "stalled" : "progress";
  if (job.awaitingDelivery && !canEdit) return "awaiting-author";
  if (job.status === "stopped") return "stopped";
  return "failed";
};

/** No job to describe: the proposal is gone, stranded, or the read failed — in that order. */
const whenNoJob = ({ canEdit, stranded, tracked }: PendingPanelContext): PendingPanel => {
  if (tracked) return "removed";
  return stranded && !canEdit ? "stranded" : "unreadable";
};
