import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_SOLVE_POLICY } from "@/entities/timetable";
import type { GenerationJobView } from "../api/generation-delivery";
import PendingProposalPage from "./PendingProposalPage";

/**
 * The page's three panels, driven off the SSR'd snapshot alone.
 *
 * The ticker is not exercised here — `use-pending-proposal.test.ts` owns the lifecycle, and this
 * suite is about what the author reads. The `initial` view is also the store's first snapshot, so
 * rendering with no interval elapsed shows exactly what the server sent.
 */
const job = (over: Partial<GenerationJobView> = {}): GenerationJobView => ({
  jobId: "job-1",
  status: "running",
  role: "proposal",
  sourcePlanId: "plan-1",
  sourcePlanName: "Year 2026/27",
  proposalPlanId: "plan-2",
  delivered: false,
  error: null,
  createdAt: "2026-09-01T07:40:07.000Z",
  finishedAt: null,
  cleanLabel: { kind: "unavailable" },
  checkpointStageIndex: null,
  stageIndex: 4,
  stageName: "teacherHoles",
  stopRequestedAt: null,
  policy: DEFAULT_SOLVE_POLICY,
  ...over,
});

const renderPage = (view: GenerationJobView | null) =>
  render(<PendingProposalPage planName="Proposal — Year 2026/27" planId="plan-2" job={view} />);

describe("PendingProposalPage", () => {
  it("offers Stop & keep while the job is active", () => {
    renderPage(job({ status: "running" }));

    expect(screen.getByRole("button", { name: /Stop & keep/ })).toBeInTheDocument();
  });

  it("shows a Stopping… indicator instead once the request is durable", () => {
    renderPage(job({ status: "running", stopRequestedAt: "2026-09-01T07:41:00.000Z" }));

    expect(screen.queryByRole("button", { name: /Stop & keep/ })).not.toBeInTheDocument();
    // The stage line stays: the ladder genuinely is still running until the solver has unwound it,
    // and hiding the progress would imply the stop had already landed.
    const statuses = screen.getAllByRole("status").map((node) => node.textContent);
    expect(statuses).toContainEqual(expect.stringContaining("Stopping…"));
    expect(statuses).toContainEqual(expect.stringContaining("stage 4 of 10"));
  });

  it("a job the author stopped before any stage gets a neutral panel, not a failure", () => {
    // The author did this on purpose. The destructive tone is for a run that broke, and a
    // `stopped` row WITH a checkpoint never reaches this branch — it delivers and navigates.
    renderPage(job({ status: "stopped", error: "stopped by the author: …", proposalPlanId: null }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "You stopped this generation before any stage finished — nothing was kept.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still reports a genuine failure as one", () => {
    renderPage(job({ status: "failed", error: "infeasible: the snapshot admits no complete board" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/This generation ended without a board: infeasible/);
    expect(screen.queryByRole("button", { name: /Stop & keep/ })).not.toBeInTheDocument();
  });

  it("offers no stop when the status could not be read at all", () => {
    renderPage(null);

    expect(screen.getByRole("status")).toHaveTextContent(/status could not be read/);
    expect(screen.queryByRole("button", { name: /Stop & keep/ })).not.toBeInTheDocument();
  });
});
