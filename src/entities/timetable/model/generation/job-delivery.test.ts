import { describe, expect, it } from "vitest";
import { isDeliverableJob, isHaltedJobStatus, isSweepableJob, type DeliverableJobRow } from "./job-delivery";
import { GENERATION_JOB_STATUSES } from "./job-status";

/**
 * The truth table both page slices refuse and deliver by. It is written here rather than inferred
 * from the integration suites because the predicates' whole reason for living in the entity is that
 * ONE definition serves plan-detail's `settle` and the hub's two delete guards — and a drift between
 * them is invisible until it strands a plan or fails a solve that worked.
 */
const row = (overrides: Partial<DeliverableJobRow> = {}): DeliverableJobRow => ({
  status: "succeeded",
  delivered_plan_id: null,
  delivery: null,
  checkpoint_stage_index: null,
  ...overrides,
});

const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";

describe("isDeliverableJob", () => {
  it("admits a succeeded job that has never delivered", () => {
    expect(isDeliverableJob(row())).toBe(true);
  });

  it("admits a halted job that kept a checkpoint, whoever halted it", () => {
    for (const status of ["interrupted", "stopped"] as const) {
      expect(isDeliverableJob(row({ status, checkpoint_stage_index: 5 }))).toBe(true);
    }
  });

  it("refuses a halted job that kept nothing — there is no board to land", () => {
    for (const status of ["interrupted", "stopped"] as const) {
      expect(isDeliverableJob(row({ status }))).toBe(false);
    }
  });

  it("refuses a job that already landed its board", () => {
    expect(isDeliverableJob(row({ delivered_plan_id: PROPOSAL_ID, delivery: "proposal" }))).toBe(false);
  });

  it("refuses a DELIVERED job whose proposal plan was then deleted — D2", () => {
    // The row shape the `on delete set null` FK leaves behind: the pointer is gone, the fact is not.
    // Without the `delivery` conjunct this is indistinguishable from "finished, never delivered", so
    // the source plan's next visit re-enters `deliver()`, finds no proposal, and marks a solve that
    // WORKED as failed — a red strip for the author's own deliberate cleanup.
    expect(isDeliverableJob(row({ delivered_plan_id: null, delivery: "proposal" }))).toBe(false);
  });

  it("refuses the same shape on a halted job that kept a checkpoint", () => {
    // The predicate is broader than "succeeded", so the D2 shape has a second arm to close.
    for (const status of ["interrupted", "stopped"] as const) {
      expect(isDeliverableJob(row({ status, checkpoint_stage_index: 5, delivery: "proposal" }))).toBe(false);
    }
  });

  it("refuses every active or failed status, delivered or not", () => {
    for (const status of GENERATION_JOB_STATUSES.filter(
      (value) => value !== "succeeded" && !isHaltedJobStatus(value),
    )) {
      expect(isDeliverableJob(row({ status, checkpoint_stage_index: 5 }))).toBe(false);
    }
  });
});

describe("isSweepableJob", () => {
  it("sweeps a failed job's clone", () => {
    expect(isSweepableJob(row({ status: "failed" }))).toBe(true);
  });

  it("sweeps a halted job that kept nothing", () => {
    for (const status of ["interrupted", "stopped"] as const) {
      expect(isSweepableJob(row({ status }))).toBe(true);
    }
  });

  it("keeps the clone of a halted job that kept a checkpoint — that is salvage, not litter", () => {
    for (const status of ["interrupted", "stopped"] as const) {
      expect(isSweepableJob(row({ status, checkpoint_stage_index: 5 }))).toBe(false);
    }
  });

  it("leaves the D2 shape alone: delivered-then-deleted is neither deliverable nor sweepable", () => {
    // Nothing to land and nothing to clean up — the clone the author deleted IS the deletion. The
    // succeeded arm was never sweepable; the halted-with-checkpoint arm must not become so either,
    // or the fix for the false failure would start deleting plans instead.
    for (const status of ["succeeded", "interrupted", "stopped"] as const) {
      const d2 = row({ status, checkpoint_stage_index: status === "succeeded" ? null : 5, delivery: "proposal" });
      expect(isDeliverableJob(d2)).toBe(false);
      expect(isSweepableJob(d2)).toBe(false);
    }
  });

  it("never sweeps an active job", () => {
    for (const status of ["queued", "running"] as const) {
      expect(isSweepableJob(row({ status }))).toBe(false);
    }
  });
});

describe("isHaltedJobStatus", () => {
  it("is exactly the two halted statuses, which differ only in who halted the run", () => {
    expect(GENERATION_JOB_STATUSES.filter(isHaltedJobStatus)).toEqual(["stopped", "interrupted"]);
  });
});
