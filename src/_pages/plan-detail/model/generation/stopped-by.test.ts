import { describe, expect, it } from "vitest";
import { DEFAULT_SOLVE_POLICY } from "@/entities/timetable";
import type { Credit, CreditedUser } from "@/entities/user";
import type { GenerationJobView } from "../../api/generation-read";
import { stoppedBy } from "./stopped-by";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const grace: CreditedUser = {
  id: ADMIN_ID,
  label: { primary: "Grace Hopper", secondary: "grace@example.test" },
  isServiceAccount: false,
};
const adminCredit: Credit = { kind: "user", user: grace };

/** A stopped job; the recorded stopper's id defaults to the credit's, as the read produces it. */
const stoppedJob = (
  credit: Credit | null,
  stopperId: string | null = credit?.kind === "user" ? credit.user.id : null,
): GenerationJobView => ({
  jobId: "job-1",
  status: "stopped",
  role: "proposal",
  sourcePlanId: "plan-1",
  sourcePlanName: "Year 2026/27",
  proposalPlanId: "plan-2",
  delivered: false,
  error: null,
  createdAt: "2026-11-06T07:40:07.000Z",
  finishedAt: "2026-11-06T07:50:07.000Z",
  cleanLabel: { kind: "unavailable" },
  checkpointStageIndex: null,
  stageIndex: 3,
  stageName: "teacherHoles",
  stopRequestedAt: "2026-11-06T07:45:07.000Z",
  requestedBy: "22222222-2222-4222-8222-222222222222",
  stopRequestedBy: stopperId,
  stoppedBy: credit,
  policy: DEFAULT_SOLVE_POLICY,
  stalled: false,
  awaitingDelivery: false,
});

describe("stoppedBy", () => {
  it("is you when the viewer stopped it, whatever the label says", () => {
    expect(stoppedBy(stoppedJob(adminCredit), ADMIN_ID)).toEqual({ kind: "you" });
  });

  it("names the stopper to everyone else, a viewer included", () => {
    expect(stoppedBy(stoppedJob(adminCredit), "33333333-3333-4333-8333-333333333333")).toEqual({
      kind: "user",
      user: grace,
      text: "Grace Hopper (grace@example.test)",
    });
  });

  it("is still you when the name lookup failed, from the recorded id alone", () => {
    expect(stoppedBy(stoppedJob(null, ADMIN_ID), ADMIN_ID)).toEqual({ kind: "you" });
  });

  it("names nobody to anyone else when the name lookup failed", () => {
    expect(stoppedBy(stoppedJob(null, ADMIN_ID), "33333333-3333-4333-8333-333333333333")).toEqual({
      kind: "unknown",
    });
  });

  it("names nobody when no stopper is recorded", () => {
    expect(stoppedBy(stoppedJob(null), ADMIN_ID)).toEqual({ kind: "unknown" });
  });

  it("never reads you when neither the viewer nor the stopper has an id", () => {
    expect(stoppedBy(stoppedJob(null), null)).toEqual({ kind: "unknown" });
  });

  it("names nobody when the stopper is unknown to the directory", () => {
    expect(stoppedBy(stoppedJob({ kind: "unknown" }), ADMIN_ID)).toEqual({ kind: "unknown" });
  });
});
