import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_SOLVE_POLICY } from "@/entities/timetable";
import type { GenerationJobView } from "../api/generation-read";
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
  stalled: false,
  awaitingDelivery: false,
  ...over,
});

const renderPage = (view: GenerationJobView | null, { canEdit = true, stranded = false } = {}) =>
  render(
    <PendingProposalPage
      planName="Proposal — Year 2026/27"
      planId="plan-2"
      job={view}
      canEdit={canEdit}
      stranded={stranded}
    />,
  );

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

  it("tells an editor they may leave while the ladder runs", () => {
    renderPage(job({ status: "running" }));

    expect(screen.getByText(/the board appears here on its own, and you can leave the page\./)).toBeInTheDocument();
  });

  /**
   * A viewer's page (S-405). Its read never writes, so every state an editor's visit would settle
   * gets a panel that names the wait, and nothing on the page is an edit control.
   */
  describe("for a viewer", () => {
    const asViewer = (view: GenerationJobView | null, stranded = false) =>
      renderPage(view, { canEdit: false, stranded });

    it("shows progress with no Stop & keep, and no invitation to leave", () => {
      asViewer(job({ status: "running" }));

      expect(screen.getByRole("status")).toHaveTextContent("stage 4 of 10");
      expect(screen.getByText(/the board appears here on its own\./)).toBeInTheDocument();
      expect(screen.queryByText(/you can leave the page/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Stop & keep/ })).not.toBeInTheDocument();
    });

    it("never offers Stop & keep, even while a stop is already pending", () => {
      asViewer(job({ status: "running", stopRequestedAt: "2026-09-01T07:41:00.000Z" }));

      expect(screen.queryByRole("button", { name: /Stop & keep/ })).not.toBeInTheDocument();
    });

    it("a stalled job says an author's or admin's visit will settle it", () => {
      asViewer(job({ status: "running", stalled: true }));

      expect(screen.getByRole("status")).toHaveTextContent("Generating — stalled");
      expect(screen.getByText(/An author's or admin's visit will settle it\./)).toBeInTheDocument();
    });

    it("a stalled queued job says it never started", () => {
      asViewer(job({ status: "queued", stageIndex: null, stalled: true }));

      expect(screen.getByRole("status")).toHaveTextContent("Queued — stalled");
    });

    it("a finished, undelivered board waits for an author — not a status that could not be read", () => {
      asViewer(job({ status: "succeeded", stageIndex: 10, awaitingDelivery: true }));

      expect(screen.getByRole("status")).toHaveTextContent("Finished — waiting for an author");
      expect(screen.getByText(/Its board appears here once an author or admin opens it\./)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("a stopped job names no one, since the viewer did not stop it", () => {
      asViewer(job({ status: "stopped", error: "stopped by the author: …", proposalPlanId: null }));

      expect(screen.getByRole("status")).toHaveTextContent(
        "This generation was stopped before any stage finished — nothing was kept.",
      );
      expect(screen.queryByText(/You stopped/)).not.toBeInTheDocument();
    });

    it("a failure reads exactly as it does for an editor", () => {
      asViewer(job({ status: "failed", error: "infeasible: the snapshot admits no complete board" }));

      expect(screen.getByRole("alert")).toHaveTextContent(/This generation ended without a board: infeasible/);
    });

    it("a stranded proposal says an author's visit will release it", () => {
      asViewer(null, true);

      expect(screen.getByRole("status")).toHaveTextContent(
        "This proposal's generation is no longer on record. An author's or admin's visit will release it as an ordinary plan.",
      );
    });

    it("a read that failed keeps the neutral refresh copy", () => {
      asViewer(null);

      expect(screen.getByRole("status")).toHaveTextContent(/status could not be read just now — refresh to try again/);
    });
  });
});
