import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOLVE_POLICY } from "@/entities/timetable";
import type { GenerationJobView } from "../api/generation-delivery";
import StopAndKeep from "./StopAndKeep";

/**
 * The affordance FR-305 is actually about: not "there is a button" but "the button says what
 * stopping now would keep". Every case below is a sentence the author reads before deciding.
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

const openDialog = () => {
  fireEvent.click(screen.getByRole("button", { name: /Stop & keep/ }));
};

describe("StopAndKeep", () => {
  it("names the stage whose board would be kept", () => {
    render(<StopAndKeep job={job({ checkpointStageIndex: 3 })} stop={vi.fn()} />);
    openDialog();

    expect(screen.getByText(/Keep the board from stage 3 of 10/)).toBeInTheDocument();
    // The work since that checkpoint is genuinely lost, and the author is deciding whether to wait
    // for it — so the dialog must not let them assume it is banked.
    expect(screen.getByText(/the stage now running is discarded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop & keep" })).toBeInTheDocument();
  });

  it("says plainly when there is nothing to keep, and stops promising to keep it", () => {
    render(<StopAndKeep job={job({ checkpointStageIndex: null })} stop={vi.fn()} />);
    openDialog();

    expect(screen.getByText(/No stage has completed yet — stopping now keeps nothing/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop anyway" })).toBeInTheDocument();
  });

  it("is honest that stopping is not immediate", () => {
    // Decision Q5: qualitative, budget-derived, and never a measured number — the stage budgets are
    // configuration, so a quoted latency would be a promise this page cannot keep.
    render(<StopAndKeep job={job()} stop={vi.fn()} />);
    openDialog();

    expect(screen.getByText(/Stopping is not immediate/)).toBeInTheDocument();
    expect(screen.getByText(/This page updates on its own/)).toBeInTheDocument();
  });

  it("calls the action with the job id when confirmed", async () => {
    const stop = vi.fn().mockResolvedValue({ outcome: "stopping" });
    render(<StopAndKeep job={job({ jobId: "job-42", checkpointStageIndex: 2 })} stop={stop} />);
    openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Stop & keep" }));

    await waitFor(() => {
      expect(stop).toHaveBeenCalledWith("job-42");
    });
  });

  it("surfaces a failed request instead of swallowing it", async () => {
    const stop = vi.fn().mockRejectedValue(new Error("Failed to request a stop"));
    render(<StopAndKeep job={job({ checkpointStageIndex: 2 })} stop={stop} />);
    openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Stop & keep" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to request a stop");
  });

  it("replaces the button with a Stopping… indicator once the request is durable", () => {
    // Derived from the POLLED snapshot, not from a local memory of the click — so a reload, a second
    // tab, and the tab that pressed it all agree, and the state survives the island remounting.
    render(<StopAndKeep job={job({ stopRequestedAt: "2026-09-01T07:41:00.000Z" })} stop={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Stopping…");
    expect(screen.queryByRole("button", { name: /Stop & keep/ })).not.toBeInTheDocument();
  });

  it("never fires the action twice for one dialog", async () => {
    const stop = vi.fn().mockResolvedValue({ outcome: "stopping" });
    render(<StopAndKeep job={job({ checkpointStageIndex: 2 })} stop={stop} />);
    openDialog();
    const confirm = screen.getByRole("button", { name: "Stop & keep" });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(stop).toHaveBeenCalledTimes(1);
    });
  });
});
