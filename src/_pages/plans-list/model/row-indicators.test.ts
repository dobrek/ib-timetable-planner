import { describe, expect, it } from "vitest";
import type { IndicatorsByPlan } from "./job-progress-store";
import type { GenerationIndicator } from "./plan-indicators";
import { indicatorsForRow } from "./row-indicators";

const SOURCE = "11111111-1111-4111-8111-111111111111";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";
const OTHER = "33333333-3333-4333-8333-333333333333";

const indicator = (overrides: Partial<GenerationIndicator> = {}): GenerationIndicator => ({
  kind: "generation",
  jobId: "22222222-2222-4222-8222-222222222222",
  planId: SOURCE,
  proposalPlanId: PROPOSAL,
  delivered: false,
  status: "running",
  stageIndex: 1,
  stageName: "completeness",
  startedAt: "2026-08-20T14:02:31.000Z",
  stale: false,
  ...overrides,
});

const live = (...indicators: GenerationIndicator[]): IndicatorsByPlan =>
  new Map(indicators.map((one) => [one.planId, one]));

describe("indicatorsForRow", () => {
  it("puts the badge on the proposal row, which is the plan it is about", () => {
    const snapshot = live(indicator());

    expect(indicatorsForRow(PROPOSAL, snapshot, [SOURCE, PROPOSAL])).toEqual([indicator()]);
    expect(indicatorsForRow(SOURCE, snapshot, [SOURCE, PROPOSAL])).toEqual([]);
  });

  it("falls back to the source row while the proposal is not on the page", () => {
    // The two-tab hole: Generate was pressed elsewhere, so the clone exists but this hub has never
    // loaded its row. The source row is the only place the badge can appear at all.
    const snapshot = live(indicator());

    expect(indicatorsForRow(SOURCE, snapshot, [SOURCE])).toEqual([indicator()]);
  });

  it("keeps a failed job on the source row even when the proposal row is present", () => {
    // Its clone has been swept and the diagnostic lives on the source strip (FR-308).
    const failed = indicator({ status: "failed" });
    const snapshot = live(failed);

    expect(indicatorsForRow(SOURCE, snapshot, [SOURCE, PROPOSAL])).toEqual([failed]);
  });

  it("keeps a job whose clone is gone on the source row", () => {
    const swept = indicator({ status: "succeeded", proposalPlanId: null });
    const snapshot = live(swept);

    expect(indicatorsForRow(SOURCE, snapshot, [SOURCE])).toEqual([swept]);
  });

  it("says nothing about a row the snapshot has nothing for", () => {
    expect(indicatorsForRow(OTHER, live(indicator()), [SOURCE, PROPOSAL, OTHER])).toEqual([]);
  });

  it("shows nothing once the poll has evicted the job, rather than the page-load copy", () => {
    // The whole point of the eviction fix. The store is seeded from the SSR'd indicators, so an empty
    // snapshot after a tick means the server no longer has the row — a render path that reached back
    // for the page-load copy here would put the stale badge straight back on screen.
    const empty: IndicatorsByPlan = new Map();

    expect(indicatorsForRow(PROPOSAL, empty, [SOURCE, PROPOSAL])).toEqual([]);
    expect(indicatorsForRow(SOURCE, empty, [SOURCE, PROPOSAL])).toEqual([]);
  });
});
