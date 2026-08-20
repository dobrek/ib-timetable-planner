import { describe, expect, it } from "vitest";
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
const STARTED = "2026-08-20T14:02:31.000Z";

const row = (overrides: Partial<GenerationJobStatusRow> = {}): GenerationJobStatusRow => ({
  id: JOB_ID,
  plan_id: PLAN_ID,
  status: "running",
  stage_index: 4,
  stage_name: "teacherHoles",
  created_at: STARTED,
  ...overrides,
});

const indicator = (overrides: Partial<GenerationIndicator> = {}): GenerationIndicator => ({
  kind: "generation",
  jobId: JOB_ID,
  planId: PLAN_ID,
  status: "running",
  stageIndex: 4,
  stageName: "teacherHoles",
  startedAt: STARTED,
  ...overrides,
});

describe("toGenerationIndicator", () => {
  it("maps the projected row onto the indicator the cell renders", () => {
    expect(toGenerationIndicator(row())).toEqual({
      kind: "generation",
      jobId: JOB_ID,
      planId: PLAN_ID,
      status: "running",
      stageIndex: 4,
      stageName: "teacherHoles",
      startedAt: STARTED,
    });
  });

  it("carries a not-yet-started job's null stage through rather than inventing a zero", () => {
    expect(toGenerationIndicator(row({ status: "queued", stage_index: null, stage_name: null }))).toMatchObject({
      stageIndex: null,
      stageName: null,
    });
  });

  it("drops a status this build does not recognise rather than casting it through", () => {
    // The column is CHECK-constrained, not an enum, so Supabase types it `string`; a value added to
    // the constraint ahead of the client must not reach a `switch` with no branch for it.
    expect(toGenerationIndicator(row({ status: "cancelled" }))).toBeNull();
    expect(toGenerationIndicators([row(), row({ id: "x", status: "cancelled" })])).toHaveLength(1);
  });
});

describe("describeGenerationIndicator", () => {
  it("names the tier and the position while a stage is running", () => {
    expect(describeGenerationIndicator(indicator())).toEqual({
      tone: "active",
      label: "Generating — stage 4 of 10 · teacher holes",
      href: null,
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

  it("points a finished job at the SOURCE plan, because delivery happens on a visit there", () => {
    expect(describeGenerationIndicator(indicator({ status: "succeeded" }))).toEqual({
      tone: "done",
      label: "Finished — open plan",
      href: `/plans/${PLAN_ID}`,
      startedAt: null,
    });
  });

  it("offers a failed job the same way in, so the strip can say what went wrong", () => {
    expect(describeGenerationIndicator(indicator({ status: "failed" }))).toMatchObject({
      tone: "failed",
      label: "Failed — open plan",
      href: `/plans/${PLAN_ID}`,
    });
  });

  it.each([
    ["stopped" as const, "Stopped"],
    ["interrupted" as const, "Interrupted"],
  ])("names %s plainly rather than guessing at it", (status, label) => {
    expect(describeGenerationIndicator(indicator({ status }))).toMatchObject({ tone: "other", label });
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
