import { describe, expect, it } from "vitest";
import { DEFAULT_SOLVE_POLICY } from "@/entities/timetable";
import type { GenerationJobView } from "../../api/generation-read";
import { resolveStatusStrip, type StatusStrip } from "./status-strip";

/**
 * The board strip's line choice (S-306, S-405), as a table: each job state on the source, read by an
 * editor and by a viewer, plus the proposal's provenance. The viewer's two kinds — stalled and
 * awaiting-author — are states an editor's visit has already settled, so an editor never resolves to
 * them. Same shape as `pending-panel.test.ts`, the pending page's own dispatch.
 */
const view = (over: Partial<GenerationJobView> = {}): GenerationJobView => ({
  jobId: "job-1",
  status: "running",
  role: "source",
  sourcePlanId: "plan-1",
  sourcePlanName: null,
  proposalPlanId: "plan-2",
  delivered: false,
  error: null,
  createdAt: "2026-10-30T07:40:07.000Z",
  finishedAt: null,
  cleanLabel: { kind: "unavailable" },
  checkpointStageIndex: null,
  stageIndex: 3,
  stageName: "teacherHoles",
  stopRequestedAt: null,
  policy: DEFAULT_SOLVE_POLICY,
  stalled: false,
  awaitingDelivery: false,
  ...over,
});

type Case = { name: string; job: GenerationJobView; editor: StatusStrip; viewer: StatusStrip };

const CASES: Case[] = [
  {
    name: "the proposal's own page",
    job: view({ role: "proposal", status: "succeeded", delivered: true }),
    editor: "provenance",
    viewer: "provenance",
  },
  { name: "a running job", job: view(), editor: "active", viewer: "active" },
  { name: "a queued job", job: view({ status: "queued", stageIndex: null }), editor: "active", viewer: "active" },
  // An editor's visit reclaims a stale row before the strip renders; one still active lost that CAS
  // to a heartbeat, so it is alive after all.
  { name: "a stalled running job", job: view({ stalled: true }), editor: "active", viewer: "stalled" },
  { name: "a failed job", job: view({ status: "failed", error: "infeasible" }), editor: "failed", viewer: "failed" },
  { name: "a job stopped before any stage", job: view({ status: "stopped" }), editor: "halted", viewer: "halted" },
  {
    name: "a job interrupted before any stage",
    job: view({ status: "interrupted" }),
    editor: "halted",
    viewer: "halted",
  },
  // An editor's visit delivers a finished board, so for them it is the "none" a delivered one is.
  {
    name: "a finished board not yet delivered",
    job: view({ status: "succeeded", awaitingDelivery: true }),
    editor: "none",
    viewer: "awaiting-author",
  },
  {
    name: "a stopped job that kept a checkpoint",
    job: view({ status: "stopped", checkpointStageIndex: 4, awaitingDelivery: true }),
    editor: "none",
    viewer: "awaiting-author",
  },
  {
    name: "a delivered board",
    job: view({ status: "succeeded", delivered: true }),
    editor: "none",
    viewer: "none",
  },
];

describe("resolveStatusStrip", () => {
  it.each(CASES)("$name, read by an editor → $editor", ({ job, editor }) => {
    expect(resolveStatusStrip(job, true)).toBe(editor);
  });

  it.each(CASES)("$name, read by a viewer → $viewer", ({ job, viewer }) => {
    expect(resolveStatusStrip(job, false)).toBe(viewer);
  });
});
