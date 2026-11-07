import { creditText, type CreditedUser } from "@/entities/user";
import type { GenerationJobView } from "../../api/generation-read";

/**
 * Who stopped a job, as its copy names them: the viewer, another user, or nobody we can name. `text`
 * is the user as a sentence names them: "Name (email)", or the email alone (FR-413).
 */
export type StoppedBy = { kind: "you" } | { kind: "user"; user: CreditedUser; text: string } | { kind: "unknown" };

/**
 * Who stopped `job`, for "You stopped…" / "Stopped by <name>…" / the neutral line (S-407). Decided by
 * the stopper's id, not by whether the viewer may edit, so a viewer reads "Stopped by <name>" too.
 * "You" comes from the recorded id alone, so the viewer's own stop reads "You" even when the name
 * lookup failed. A job stopped before S-407, by a user since deleted, or whose stopper could not be
 * looked up, names nobody to anyone else.
 */
export const stoppedBy = (job: GenerationJobView, viewerId: string | null): StoppedBy => {
  if (job.stopRequestedBy !== null && job.stopRequestedBy === viewerId) return { kind: "you" };
  const credit = job.stoppedBy;
  if (credit?.kind !== "user") return { kind: "unknown" };
  return { kind: "user", user: credit.user, text: creditText(credit) };
};
