import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GenerationJobView } from "../../api/generation-delivery";
import type { GenerationControls } from "../../model/use-cohort-board-state";
import GenerationStatusStrip from "./GenerationStatusStrip";

const job = (over: Partial<GenerationJobView> = {}): GenerationJobView => ({
  jobId: "job-1",
  status: "running",
  proposalPlanId: "plan-2",
  delivered: false,
  error: null,
  createdAt: "2026-08-13T07:40:07.000Z",
  finishedAt: null,
  cleanLabel: { kind: "unavailable" },
  ...over,
});

const controls = (over: Partial<GenerationControls> = {}): GenerationControls => ({
  state: { status: "idle" },
  error: null,
  checking: false,
  launch: vi.fn(),
  refresh: vi.fn(),
  disabledReason: null,
  busy: false,
  ...over,
});

const tracking = (view: GenerationJobView, over: Partial<GenerationControls> = {}) =>
  controls({ state: { status: "tracking", job: view }, ...over });

describe("GenerationStatusStrip", () => {
  it("renders nothing when no job is being tracked", () => {
    const { container } = render(<GenerationStatusStrip generation={controls()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("active: says it is generating, when it started, and that leaving is fine", () => {
    render(<GenerationStatusStrip generation={tracking(job({ status: "running" }))} />);

    expect(screen.getByRole("status")).toHaveTextContent(/Generating… started/);
    expect(screen.getByText(/you can leave the page/)).toBeInTheDocument();
  });

  it("active: Refresh re-reads the row — which is also what delivers a finished job", () => {
    const generation = tracking(job({ status: "queued" }));
    render(<GenerationStatusStrip generation={generation} />);

    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(generation.refresh).toHaveBeenCalledOnce();
  });

  it("active: Refresh goes inert while a check is in flight, so a double click cannot double-deliver", () => {
    render(<GenerationStatusStrip generation={tracking(job(), { checking: true })} />);

    expect(screen.getByRole("button", { name: /Checking…/ })).toBeDisabled();
  });

  it("delivered: links to the proposal plan and states the clean label", () => {
    const view = job({ status: "succeeded", delivered: true, cleanLabel: { kind: "clean" } });
    render(<GenerationStatusStrip generation={tracking(view)} />);

    expect(screen.getByRole("link", { name: /Proposal ready — open/ })).toHaveAttribute("href", "/plans/plan-2");
    expect(screen.getByText(/no lesson sits on a soft-unavailable cell/)).toBeInTheDocument();
  });

  it("delivered: an at-the-floor board names the residue instead of claiming clean", () => {
    const view = job({
      status: "succeeded",
      delivered: true,
      cleanLabel: { kind: "clean-at-floor", pinnedHours: 2 },
    });
    render(<GenerationStatusStrip generation={tracking(view)} />);

    expect(screen.getByText(/2 pinned hours remain on soft cells/)).toBeInTheDocument();
  });

  it("failed: surfaces the diagnostic through role=alert", () => {
    const view = job({ status: "failed", proposalPlanId: null, error: "infeasible: no complete board" });
    render(<GenerationStatusStrip generation={tracking(view)} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Generation failed: infeasible: no complete board");
  });

  it("failed without a message still says so rather than rendering an empty strip", () => {
    render(<GenerationStatusStrip generation={tracking(job({ status: "failed", error: null }))} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Generation failed.");
  });

  it("succeeded-but-undelivered says exactly that, and offers Refresh", () => {
    // The window between the solver finishing and a check running — honest rather than optimistic.
    render(<GenerationStatusStrip generation={tracking(job({ status: "succeeded", delivered: false }))} />);

    expect(screen.getByRole("status")).toHaveTextContent(/no proposal has been delivered/);
    expect(screen.getByRole("button", { name: /Refresh/ })).toBeEnabled();
  });
});
