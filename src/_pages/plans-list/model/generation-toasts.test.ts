import { describe, expect, it } from "vitest";
import { announcementsFor } from "./generation-toasts";
import type { IndicatorsByPlan } from "./job-progress-store";
import type { GenerationIndicator } from "./plan-indicators";

/**
 * FR-309's in-app half, as a pure diff. What is worth pinning is the definition of the EVENT — one
 * active → terminal transition, once — because every plausible wrong definition is wrong in a way
 * the author would notice: "is terminal" toasts on every tick, "appeared" toasts yesterday's job on
 * page load, and "changed at all" toasts on every stage.
 */
const PLAN = "11111111-1111-4111-8111-111111111111";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";
const JOB = "22222222-2222-4222-8222-222222222222";

const indicator = (over: Partial<GenerationIndicator> = {}): GenerationIndicator => ({
  kind: "generation",
  jobId: JOB,
  planId: PLAN,
  proposalPlanId: PROPOSAL,
  delivered: false,
  status: "running",
  stageIndex: 4,
  stageName: "teacherHoles",
  startedAt: "2026-08-28T14:02:31.000Z",
  stale: false,
  ...over,
});

const snapshot = (...indicators: GenerationIndicator[]): IndicatorsByPlan =>
  new Map(indicators.map((one) => [one.planId, one]));

const names: Record<string, string> = { [PLAN]: "Year 2026/27", [PROPOSAL]: "Proposal — Year 2026/27" };
const nameOf = (planId: string) => names[planId];

describe("announcementsFor", () => {
  it("announces a job that finished while the hub was open, pointing at the proposal", () => {
    const done = indicator({ status: "succeeded", delivered: true });

    expect(announcementsFor(snapshot(indicator()), snapshot(done), nameOf)).toEqual([
      {
        jobId: JOB,
        tone: "success",
        title: "Proposal ready",
        description: "Proposal — Year 2026/27",
        href: `/plans/${PROPOSAL}`,
      },
    ]);
  });

  it("announces a failure as an error, pointing at the SOURCE where the diagnostic is", () => {
    const failed = indicator({ status: "failed", proposalPlanId: null });

    expect(announcementsFor(snapshot(indicator()), snapshot(failed), nameOf)).toEqual([
      { jobId: JOB, tone: "error", title: "Generation failed", description: "Year 2026/27", href: `/plans/${PLAN}` },
    ]);
  });

  it("says nothing on a tick where the job merely advanced a stage", () => {
    const before = snapshot(indicator({ stageIndex: 4 }));
    const after = snapshot(indicator({ stageIndex: 5 }));

    expect(announcementsFor(before, after, nameOf)).toEqual([]);
  });

  it("says nothing when the job was ALREADY terminal in the previous snapshot", () => {
    // Otherwise the badge would re-toast every five seconds for as long as the hub stayed open.
    const done = indicator({ status: "succeeded", delivered: true });

    expect(announcementsFor(snapshot(done), snapshot(done), nameOf)).toEqual([]);
  });

  it("says nothing about a job the hub is seeing for the first time", () => {
    // A hub loaded after the fact would otherwise announce a run that finished yesterday — the
    // discovery read returns terminal-undelivered rows precisely so the BADGE can show them.
    const done = indicator({ status: "succeeded", delivered: true });

    expect(announcementsFor(new Map(), snapshot(done), nameOf)).toEqual([]);
  });

  it("says nothing when the plan's indicator is a different job than before", () => {
    // A second Generate on the same plan replaces the entry. That is a new job starting, not the old
    // one finishing, and the old job's own completion was announced when it happened.
    const before = snapshot(indicator({ jobId: "old-job", status: "running" }));
    const after = snapshot(indicator({ jobId: "new-job", status: "succeeded", delivered: true }));

    expect(announcementsFor(before, after, nameOf)).toEqual([]);
  });

  it("falls back to no description rather than inventing a name for a row it cannot see", () => {
    const done = indicator({ status: "succeeded", delivered: true });

    expect(announcementsFor(snapshot(indicator()), snapshot(done), () => undefined)[0]?.description).toBeUndefined();
  });
});
