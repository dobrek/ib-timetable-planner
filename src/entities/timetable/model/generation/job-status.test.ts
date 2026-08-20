import { describe, expect, it } from "vitest";
import { GENERATION_JOB_STATUSES, isActiveJobStatus, isGenerationJobStatus, isTerminalJobStatus } from "./job-status";

const ALL = [...GENERATION_JOB_STATUSES];

describe("job status guards", () => {
  it("treats exactly queued and running as active", () => {
    expect(ALL.filter(isActiveJobStatus)).toEqual(["queued", "running"]);
  });

  it("treats every other status as terminal, including the two with no producer yet", () => {
    // `stopped` (S-305) and `interrupted` (S-304) are terminal by construction: nothing advances a
    // row out of either, so a poll that stops on them today is right rather than provisional.
    expect(ALL.filter(isTerminalJobStatus)).toEqual(["succeeded", "failed", "stopped", "interrupted"]);
  });

  it("partitions the vocabulary — every status is exactly one of the two", () => {
    for (const status of ALL) expect(isActiveJobStatus(status)).toBe(!isTerminalJobStatus(status));
  });

  it("is the CHECK constraint's list, in the column's own order", () => {
    expect(ALL).toEqual(["queued", "running", "succeeded", "failed", "stopped", "interrupted"]);
  });
});

describe("isGenerationJobStatus", () => {
  it("accepts every status the column may hold", () => {
    for (const status of ALL) expect(isGenerationJobStatus(status)).toBe(true);
  });

  it("rejects anything else, so an unknown status is dropped at the read boundary", () => {
    // Supabase types a CHECK-constrained column as `string`; without this guard an unrecognised
    // value would reach a `switch` with no branch for it and render as nothing at all.
    for (const raw of ["", "RUNNING", "cancelled", "succeeded ", "pending"]) {
      expect(isGenerationJobStatus(raw)).toBe(false);
    }
  });
});
