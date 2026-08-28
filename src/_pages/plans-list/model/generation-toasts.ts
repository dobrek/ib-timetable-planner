import { isActiveJobStatus } from "@/entities/timetable";
import { describeGenerationIndicator, type GenerationIndicator } from "./plan-indicators";
import type { IndicatorsByPlan } from "./job-progress-store";

/**
 * What an open hub should announce, given the poll's previous snapshot and its current one.
 *
 * **Pure, and separate from the effect that fires it**, because the interesting part is the DIFF and
 * a diff is exactly the kind of thing that should be testable without a DOM, a timer or a mocked
 * toast library. The component keeps the previous snapshot in a ref and hands both here.
 *
 * The event is one transition and only one: a job this hub was watching go **active → terminal**. Not
 * "is terminal" (which would re-announce on every tick for as long as the hub stayed open), and not
 * "appeared" (a hub loaded after the fact would announce a job that finished yesterday). A plan the
 * previous snapshot had never heard of announces nothing, which is what keeps the first tick after a
 * page load silent.
 *
 * S-306 calls this the in-app half of FR-309. The durable half is the row transition the hub's
 * badge reads (`delivered_plan_id` set, `notified_at` still null); a toast is the free by-product of a
 * poll that is already running, and S-310's emailer is a third reader of the same event.
 */
export type GenerationAnnouncement = {
  jobId: string;
  tone: "success" | "error";
  /** "Proposal ready" / "Generation failed" — the headline. */
  title: string;
  /** The plan name the author will recognise, when the hub has one for the row this points at. */
  description: string | undefined;
  /** Where "Open" goes — the proposal for a delivered board, the source for a failure. */
  href: string | null;
};

export const announcementsFor = (
  previous: IndicatorsByPlan,
  current: IndicatorsByPlan,
  nameOf: (planId: string) => string | undefined,
): GenerationAnnouncement[] =>
  [...current.values()].flatMap((indicator) => {
    const before = previous.get(indicator.planId);
    // Never seen before, or was already terminal: nothing transitioned in this tick.
    if (before?.jobId !== indicator.jobId) return [];
    if (!isActiveJobStatus(before.status) || isActiveJobStatus(indicator.status)) return [];
    return [toAnnouncement(indicator, nameOf)];
  });

const toAnnouncement = (
  indicator: GenerationIndicator,
  nameOf: (planId: string) => string | undefined,
): GenerationAnnouncement => {
  const { href } = describeGenerationIndicator(indicator);
  const failed = indicator.status === "failed";
  return {
    jobId: indicator.jobId,
    tone: failed ? "error" : "success",
    title: failed ? "Generation failed" : "Proposal ready",
    // The name of the plan the toast POINTS at, which is the proposal for a result and the source for
    // a failure — the same split the badge's href makes, for the same reason.
    description: nameOf(failed || indicator.proposalPlanId === null ? indicator.planId : indicator.proposalPlanId),
    href,
  };
};
