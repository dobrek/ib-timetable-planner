import { creditText } from "@/entities/user";
import type { GenerationJobView } from "../../api/generation-read";

/**
 * Who stopped a job, as its copy names them: the viewer, another user, or nobody we can name. `text`
 * is the user as a sentence names them: "Name (email)", or the email alone (FR-413).
 */
export type StoppedBy = { kind: "you" } | { kind: "user"; text: string } | { kind: "unknown" };

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
  return { kind: "user", text: creditText(credit) };
};

/**
 * The stopped run as one sentence, for every surface that reports it: the subject names the stopper
 * ("You stopped this generation", "Stopped by <name>", or the neutral "This generation was stopped"),
 * and `tail` says what it cost ("before any stage finished — nothing was kept.", "early — kept the
 * board from stage 3 of 10."). One template, so the pending page and the board's strip can never
 * name the same person two ways.
 */
export const stoppedSentence = (by: StoppedBy, tail: string): string => {
  if (by.kind === "you") return `You stopped this generation ${tail}`;
  if (by.kind === "user") return `Stopped by ${by.text} ${tail}`;
  return `This generation was stopped ${tail}`;
};
