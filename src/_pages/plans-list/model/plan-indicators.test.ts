import { describe, expect, it } from "vitest";
import { HEARTBEAT_GRACE_MS } from "@/entities/timetable";
import {
  describeGenerationIndicator,
  isActiveIndicator,
  toGenerationIndicator,
  toGenerationIndicators,
  type GenerationIndicator,
  type GenerationJobStatusRow,
} from "./plan-indicators";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const PROPOSAL_ID = "44444444-4444-4444-8444-444444444444";
const STARTED = "2026-08-20T14:02:31.000Z";

/** A clock a few seconds after `STARTED`, so the default fixture is a healthy, freshly-beating job. */
const NOW = Date.parse(STARTED) + 8_000;
const STALE_BEAT = new Date(Date.parse(STARTED) - HEARTBEAT_GRACE_MS).toISOString();

const row = (overrides: Partial<GenerationJobStatusRow> = {}): GenerationJobStatusRow => ({
  id: JOB_ID,
  plan_id: PLAN_ID,
  proposal_plan_id: PROPOSAL_ID,
  delivered_plan_id: null,
  delivery: null,
  status: "running",
  stage_index: 4,
  stage_name: "teacherHoles",
  created_at: STARTED,
  heartbeat_at: STARTED,
  ...overrides,
});

const indicator = (overrides: Partial<GenerationIndicator> = {}): GenerationIndicator => ({
  kind: "generation",
  jobId: JOB_ID,
  planId: PLAN_ID,
  proposalPlanId: PROPOSAL_ID,
  delivered: false,
  status: "running",
  stageIndex: 4,
  stageName: "teacherHoles",
  startedAt: STARTED,
  stale: false,
  ...overrides,
});

describe("toGenerationIndicator", () => {
  it("maps the projected row onto the indicator the cell renders", () => {
    expect(toGenerationIndicator(row(), NOW)).toEqual({
      kind: "generation",
      jobId: JOB_ID,
      planId: PLAN_ID,
      proposalPlanId: PROPOSAL_ID,
      delivered: false,
      status: "running",
      stageIndex: 4,
      stageName: "teacherHoles",
      startedAt: STARTED,
      stale: false,
    });
  });

  it("carries a not-yet-started job's null stage through rather than inventing a zero", () => {
    expect(toGenerationIndicator(row({ status: "queued", stage_index: null, stage_name: null }), NOW)).toMatchObject({
      stageIndex: null,
      stageName: null,
    });
  });

  it("marks a running job whose heartbeat has gone quiet as stale", () => {
    expect(toGenerationIndicator(row({ heartbeat_at: STALE_BEAT }), NOW)?.stale).toBe(true);
  });

  it("marks a stranded queued job stale from created_at, which is the only clock it has", () => {
    expect(
      toGenerationIndicator(row({ status: "queued", heartbeat_at: null, created_at: STALE_BEAT }), NOW)?.stale,
    ).toBe(true);
  });

  it("never marks a terminal job stale", () => {
    expect(toGenerationIndicator(row({ status: "succeeded", heartbeat_at: STALE_BEAT }), NOW)?.stale).toBe(false);
  });

  it("drops a status this build does not recognise rather than casting it through", () => {
    // The column is CHECK-constrained, not an enum, so Supabase types it `string`; a value added to
    // the constraint ahead of the client must not reach a `switch` with no branch for it.
    expect(toGenerationIndicator(row({ status: "cancelled" }), NOW)).toBeNull();
    expect(toGenerationIndicators([row(), row({ id: "x", status: "cancelled" })], NOW)).toHaveLength(1);
  });

  it("drops a job that delivered into a proposal the author has since deleted", () => {
    // `delivered_plan_id` is `on delete set null` and `delivery` is not, so this pair is the exact
    // signature of the deletion. Read through the pointer alone the row looks "finished, undelivered"
    // and badges the SOURCE "Finished — open to deliver" forever, for a board that is gone by request.
    const deletedProposal = row({ status: "succeeded", delivered_plan_id: null, delivery: "proposal" });
    expect(toGenerationIndicator(deletedProposal, NOW)).toBeNull();
    // ...on the refresh path too, which is unfiltered by design: an open hub tab tracking this job id
    // stops badging on its next tick rather than waiting for a reload.
    expect(toGenerationIndicators([row(), deletedProposal], NOW)).toHaveLength(1);
  });

  it("drops the same shape on a halted job, which delivers a checkpoint by the same chain", () => {
    for (const status of ["interrupted", "stopped"] as const) {
      expect(toGenerationIndicator(row({ status, delivered_plan_id: null, delivery: "proposal" }), NOW)).toBeNull();
    }
  });

  it("keeps a DELIVERED job whose proposal is still there — that is 'Ready — open' material", () => {
    // The drop is on the PAIR, never on `delivery` alone. A delivered, un-announced row is the whole
    // reason the badge survives a reload.
    expect(
      toGenerationIndicator(row({ status: "succeeded", delivered_plan_id: PROPOSAL_ID, delivery: "proposal" }), NOW),
    ).toMatchObject({ delivered: true, status: "succeeded" });
  });
});

describe("describeGenerationIndicator", () => {
  it("names the tier and the position while a stage is running, and points at the PROPOSAL", () => {
    // The href used to be null here: before S-306 the clone had no reader, so there was nowhere to
    // send the author mid-solve. It is now a listed plan that renders its own progress, so the badge
    // is a link from the first second.
    expect(describeGenerationIndicator(indicator())).toEqual({
      tone: "active",
      label: "Generating — stage 4 of 10 · teacher holes",
      href: `/plans/${PROPOSAL_ID}`,
      startedAt: STARTED,
    });
  });

  it("says 'starting' before the first stage has been reported", () => {
    const description = describeGenerationIndicator(indicator({ stageIndex: null, stageName: null }));
    expect(description.label).toBe("Generating — starting");
    expect(description.tone).toBe("active");
  });

  it("omits the tier name when the row has an index but no name", () => {
    expect(describeGenerationIndicator(indicator({ stageName: null })).label).toBe("Generating — stage 4 of 10");
  });

  it("falls back to the engine's raw name for a tier the label map does not know", () => {
    expect(describeGenerationIndicator(indicator({ stageName: "someFutureTier" })).label).toBe(
      "Generating — stage 4 of 10 · someFutureTier",
    );
  });

  it("shows a queued job as queued, with its start time", () => {
    const description = describeGenerationIndicator(indicator({ status: "queued" }));
    expect(description).toMatchObject({ tone: "active", label: "Queued — started", startedAt: STARTED });
  });

  it("says 'stalled' for a running job that has gone quiet, and offers a way in", () => {
    // Tone `other`, not `failed`: nothing has been written and the row still says `running`. The href
    // is the actionable half — opening the plan is what performs the reclaim.
    expect(describeGenerationIndicator(indicator({ stale: true }))).toEqual({
      tone: "other",
      label: "Generating — stalled, open plan",
      href: `/plans/${PLAN_ID}`,
      startedAt: STARTED,
    });
  });

  it("says 'stalled' for a stranded queued job too — nothing ever claimed it", () => {
    expect(describeGenerationIndicator(indicator({ status: "queued", stale: true }))).toMatchObject({
      tone: "other",
      label: "Queued — stalled, open plan",
      href: `/plans/${PLAN_ID}`,
    });
  });

  it("ignores staleness on a terminal job, which cannot have any", () => {
    // Belt and braces: the predicate never sets it, and the switch never reads it here.
    expect(describeGenerationIndicator(indicator({ status: "succeeded", stale: true })).label).toBe(
      "Finished — open to deliver",
    );
  });

  it("points a DELIVERED job at the proposal, which is now an ordinary plan", () => {
    // Replaces "points a finished job at the SOURCE plan, because delivery happens on a visit there"
    // (S-301). Both halves of that reason expired: `checkPlan` is dual-keyed, so a visit to the
    // proposal delivers, and the board is on the proposal — the source is never written to.
    expect(describeGenerationIndicator(indicator({ status: "succeeded", delivered: true }))).toEqual({
      tone: "done",
      label: "Ready — open",
      href: `/plans/${PROPOSAL_ID}`,
      startedAt: null,
    });
  });

  it("tells an UNDELIVERED finished job apart, in the delete guard's own words", () => {
    // "open to deliver" is exactly what `assertNotPending` refuses a delete with, so the badge and
    // the refusal say the same thing.
    expect(describeGenerationIndicator(indicator({ status: "succeeded", delivered: false }))).toMatchObject({
      tone: "done",
      label: "Finished — open to deliver",
      href: `/plans/${PROPOSAL_ID}`,
    });
  });

  it("offers a failed job a way into the SOURCE, where the diagnostic lives", () => {
    // The one terminal state that keeps the old destination: a failed job's clone has been swept, so
    // there is no proposal to open, and FR-308 puts the failure on the source's strip.
    expect(describeGenerationIndicator(indicator({ status: "failed" }))).toMatchObject({
      tone: "failed",
      label: "Failed — open plan",
      href: `/plans/${PLAN_ID}`,
    });
  });

  it.each([["stopped" as const], ["interrupted" as const]])(
    "treats %s exactly as succeeded — the question is whether a board landed",
    (status) => {
      expect(describeGenerationIndicator(indicator({ status, delivered: true }))).toMatchObject({
        tone: "done",
        label: "Ready — open",
        href: `/plans/${PROPOSAL_ID}`,
      });
      expect(describeGenerationIndicator(indicator({ status, delivered: false })).label).toBe(
        "Finished — open to deliver",
      );
    },
  );

  it("falls back to the source when the proposal is gone", () => {
    // `proposal_plan_id` is `on delete set null`, so a swept or hand-deleted clone leaves the badge
    // with nowhere else to point.
    expect(describeGenerationIndicator(indicator({ status: "succeeded", proposalPlanId: null })).href).toBe(
      `/plans/${PLAN_ID}`,
    );
  });

  it("never pre-formats the start time — the cell renders it, to avoid a hydration mismatch", () => {
    // SSR runs on workerd (UTC) and hydration in the reader's zone, so a `toLocaleTimeString` here
    // would produce two different strings for the same instant.
    const description = describeGenerationIndicator(indicator());
    expect(description.startedAt).toBe(STARTED);
    expect(description.label).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe("isActiveIndicator", () => {
  it("is what decides whether the poll keeps a timer running", () => {
    expect(isActiveIndicator(indicator({ status: "running" }))).toBe(true);
    expect(isActiveIndicator(indicator({ status: "queued" }))).toBe(true);
    expect(isActiveIndicator(indicator({ status: "succeeded" }))).toBe(false);
    expect(isActiveIndicator(indicator({ status: "interrupted" }))).toBe(false);
  });
});
