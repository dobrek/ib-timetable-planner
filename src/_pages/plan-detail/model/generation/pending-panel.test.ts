import { describe, expect, it } from "vitest";
import { DEFAULT_SOLVE_POLICY } from "@/entities/timetable";
import type { GenerationJobView } from "../../api/generation-read";
import { resolvePendingPanel, type PendingPanel } from "./pending-panel";

/**
 * The pending page's panel choice (S-405), as a table: each job state, read by an editor and by a
 * viewer. The viewer's three kinds — stranded, stalled, awaiting-author — are states an editor's
 * visit would already have settled, so an editor never resolves to them.
 */
const view = (over: Partial<GenerationJobView> = {}): GenerationJobView => ({
  jobId: "job-1",
  status: "running",
  role: "proposal",
  sourcePlanId: "plan-1",
  sourcePlanName: "Year 2026/27",
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

type Case = {
  name: string;
  job: GenerationJobView | null;
  stranded?: boolean;
  tracked?: boolean;
  editor: PendingPanel;
  viewer: PendingPanel;
};

const CASES: Case[] = [
  { name: "a read that failed", job: null, editor: "unreadable", viewer: "unreadable" },
  // The route sets `stranded` for a non-editor only; the dispatch keeps the kind viewer-only anyway.
  { name: "a pending plan no job references", job: null, stranded: true, editor: "unreadable", viewer: "stranded" },
  // The page held a job and a later read found none: an editor's visit swept the proposal. Gone wins
  // over stranded, which the route only ever set for a page that started with no job.
  {
    name: "a proposal gone after the page held its job",
    job: null,
    tracked: true,
    editor: "removed",
    viewer: "removed",
  },
  {
    name: "a proposal gone, on a page the route called stranded",
    job: null,
    stranded: true,
    tracked: true,
    editor: "removed",
    viewer: "removed",
  },
  {
    name: "a delivered board",
    job: view({ status: "succeeded", delivered: true }),
    editor: "delivered",
    viewer: "delivered",
  },
  { name: "a running job", job: view(), editor: "progress", viewer: "progress" },
  { name: "a queued job", job: view({ status: "queued", stageIndex: null }), editor: "progress", viewer: "progress" },
  // An editor's visit reclaims a stale row before the page renders; one still active lost that CAS
  // to a heartbeat, so it is alive after all.
  { name: "a stalled running job", job: view({ stalled: true }), editor: "progress", viewer: "stalled" },
  {
    name: "a stalled queued job",
    job: view({ status: "queued", stageIndex: null, stalled: true }),
    editor: "progress",
    viewer: "stalled",
  },
  // An editor's visit delivers these three before the page renders. Were one left behind, the
  // editor's panel falls back exactly as it did before S-405.
  {
    name: "a finished board not yet delivered",
    job: view({ status: "succeeded", awaitingDelivery: true }),
    editor: "failed",
    viewer: "awaiting-author",
  },
  {
    name: "a stopped job that kept a checkpoint",
    job: view({ status: "stopped", checkpointStageIndex: 4, awaitingDelivery: true }),
    editor: "stopped",
    viewer: "awaiting-author",
  },
  {
    name: "an interrupted job that kept a checkpoint",
    job: view({ status: "interrupted", checkpointStageIndex: 2, awaitingDelivery: true }),
    editor: "failed",
    viewer: "awaiting-author",
  },
  { name: "a job stopped before any stage", job: view({ status: "stopped" }), editor: "stopped", viewer: "stopped" },
  {
    name: "a failed job",
    job: view({ status: "failed", error: "infeasible" }),
    editor: "failed",
    viewer: "failed",
  },
  {
    name: "an interrupted job that kept nothing",
    job: view({ status: "interrupted" }),
    editor: "failed",
    viewer: "failed",
  },
];

describe("resolvePendingPanel", () => {
  it.each(CASES)("$name, read by an editor → $editor", ({ job, stranded = false, tracked = false, editor }) => {
    expect(resolvePendingPanel(job, { canEdit: true, stranded, tracked })).toBe(editor);
  });

  it.each(CASES)("$name, read by a viewer → $viewer", ({ job, stranded = false, tracked = false, viewer }) => {
    expect(resolvePendingPanel(job, { canEdit: false, stranded, tracked })).toBe(viewer);
  });

  it("names a delivered board ahead of every other flag, so the reload's round trip never flashes a wait", () => {
    const delivered = view({ status: "succeeded", delivered: true, awaitingDelivery: true, stalled: true });

    expect(resolvePendingPanel(delivered, { canEdit: false, stranded: false, tracked: true })).toBe("delivered");
  });
});
