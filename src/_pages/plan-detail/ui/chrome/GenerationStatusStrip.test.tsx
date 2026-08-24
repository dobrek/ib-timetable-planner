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
  checkpointStageIndex: null,
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

    expect(screen.getByRole("status")).toHaveTextContent(/Generating… started \d{1,2}:\d{2}/);
    // The instant travels in `dateTime`; the readable text is the reader's own zone, filled in only
    // after hydration (jsdom renders as an already-hydrated client) — see `useHydrated`.
    expect(screen.getByRole("status").querySelector("time")).toHaveAttribute("dateTime", "2026-08-13T07:40:07.000Z");
    expect(screen.getByText(/you can leave the page/)).toBeInTheDocument();
  });

  it("active: points at the plans list, where the live stage-by-stage progress is", () => {
    // The strip stays static on purpose (FR-308 is an advisory, and the board is on this page);
    // `/plans` has no board, so polling there cannot contend with dragging. The link is the seam
    // between the two, and it must exist on both active states.
    for (const status of ["queued", "running"] as const) {
      const { unmount } = render(<GenerationStatusStrip generation={tracking(job({ status }))} />);
      expect(screen.getByRole("link", { name: "Watch progress in Plans" })).toHaveAttribute("href", "/plans");
      unmount();
    }
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

  it("interrupted with a delivered checkpoint says which stage's board was kept", () => {
    // The author's decision is "keep this or run it again", and the stage number is what it turns on.
    const view = job({ status: "interrupted", delivered: true, checkpointStageIndex: 3 });
    render(<GenerationStatusStrip generation={tracking(view)} />);

    expect(screen.getByRole("link", { name: /Partial proposal ready — open/ })).toHaveAttribute(
      "href",
      "/plans/plan-2",
    );
    expect(screen.getByText(/kept the board from stage 3 of 10/)).toBeInTheDocument();
  });

  it("interrupted never claims a clean label it has no transcript for", () => {
    // A mid-ladder run rarely reaches tier 5, so `describeCleanLabel` would say "unavailable" — true
    // but useless. The stage summary replaces it rather than sitting beside it.
    const view = job({
      status: "interrupted",
      delivered: true,
      checkpointStageIndex: 2,
      cleanLabel: { kind: "clean" },
    });
    render(<GenerationStatusStrip generation={tracking(view)} />);

    expect(screen.queryByText(/no lesson sits on a soft-unavailable cell/)).not.toBeInTheDocument();
  });

  it("interrupted with nothing kept says so plainly, and is advisory rather than an alert", () => {
    // The platform cut the run short; that is not the author's data being wrong, so no role=alert.
    const view = job({ status: "interrupted", delivered: false, checkpointStageIndex: null });
    render(<GenerationStatusStrip generation={tracking(view)} />);

    expect(screen.getByRole("status")).toHaveTextContent(/interrupted before any stage finished/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh/ })).toBeEnabled();
  });
});
