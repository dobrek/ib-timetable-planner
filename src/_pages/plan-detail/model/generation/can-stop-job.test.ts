import { describe, expect, it } from "vitest";
import { DEFAULT_SOLVE_POLICY, type GenerationJobStatus } from "@/entities/timetable";
import type { GenerationJobView } from "../../api/generation-read";
import { canStopJob, stopAffordance, type StopPermission } from "./can-stop-job";

const REQUESTER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const job = (requestedBy: string | null, status: GenerationJobStatus = "running"): GenerationJobView => ({
  jobId: "job-1",
  status,
  role: "proposal",
  sourcePlanId: "plan-1",
  sourcePlanName: "Year 2026/27",
  proposalPlanId: "plan-2",
  delivered: false,
  error: null,
  createdAt: "2026-11-06T07:40:07.000Z",
  finishedAt: null,
  cleanLabel: { kind: "unavailable" },
  checkpointStageIndex: null,
  stageIndex: 3,
  stageName: "teacherHoles",
  stopRequestedAt: null,
  requestedBy,
  stopRequestedBy: null,
  stoppedBy: null,
  policy: DEFAULT_SOLVE_POLICY,
  stalled: false,
  awaitingDelivery: false,
});

const author = (viewerId: string): StopPermission => ({ canEdit: true, viewerId, canStopAnyJob: false });
const admin: StopPermission = { canEdit: true, viewerId: OTHER, canStopAnyJob: true };

/**
 * Who gets Stop (S-407): the client's copy of the stop guard, which the role matrix pins in the
 * database. Each row is one viewer looking at one job.
 */
describe("canStopJob", () => {
  it.each([
    ["the requester, on their own job", job(REQUESTER), author(REQUESTER), true],
    ["another author", job(REQUESTER), author(OTHER), false],
    ["an admin, on anyone's job", job(REQUESTER), admin, true],
    ["any author, on a job with no requester", job(null), author(OTHER), true],
    [
      "a viewer, on a job with no requester",
      job(null),
      { canEdit: false, viewerId: OTHER, canStopAnyJob: false },
      false,
    ],
    [
      "a requester demoted to viewer, on their own job",
      job(REQUESTER),
      { canEdit: false, viewerId: REQUESTER, canStopAnyJob: false },
      false,
    ],
    ["the requester, on a queued job", job(REQUESTER, "queued"), author(REQUESTER), true],
    ["the requester, on a finished job", job(REQUESTER, "succeeded"), author(REQUESTER), false],
    ["an admin, on a stopped job", job(REQUESTER, "stopped"), admin, false],
  ] as const)("%s → %s", (_who, view, permission, expected) => {
    expect(canStopJob(view, permission)).toBe(expected);
  });
});

const viewer: StopPermission = { canEdit: false, viewerId: OTHER, canStopAnyJob: false };
const stopping = (view: GenerationJobView): GenerationJobView => ({
  ...view,
  stopRequestedAt: "2026-11-06T07:45:00.000Z",
});

/**
 * The progress panel's stop slot: once anyone has asked, the run reads "Stopping…" to everyone
 * watching it. Before that, only whoever `canStopJob` admits gets the control.
 */
describe("stopAffordance", () => {
  it.each([
    ["the requester, nothing pending", job(REQUESTER), author(REQUESTER), "control"],
    ["another author, nothing pending", job(REQUESTER), author(OTHER), "none"],
    ["a viewer, nothing pending", job(REQUESTER), viewer, "none"],
    ["the requester, their stop pending", stopping(job(REQUESTER)), author(REQUESTER), "stopping"],
    ["another author, someone's stop pending", stopping(job(REQUESTER)), author(OTHER), "stopping"],
    ["a viewer, someone's stop pending", stopping(job(REQUESTER)), viewer, "stopping"],
    ["an admin, on a finished job that once had a stop", stopping(job(REQUESTER, "stopped")), admin, "none"],
  ] as const)("%s → %s", (_who, view, permission, expected) => {
    expect(stopAffordance(view, permission)).toBe(expected);
  });
});
