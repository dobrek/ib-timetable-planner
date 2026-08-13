import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GenerationControls } from "../../model/use-cohort-board-state";
import GenerateButton from "./GenerateButton";

const controls = (over: Partial<GenerationControls> = {}): GenerationControls => ({
  state: { status: "idle" },
  error: null,
  launch: vi.fn(),
  disabledReason: null,
  busy: false,
  ...over,
});

describe("GenerateButton", () => {
  it("idle: enabled, and a click launches the job", () => {
    const generation = controls();
    render(<GenerateButton generation={generation} />);

    const button = screen.getByRole("button", { name: "Generate plan" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(generation.launch).toHaveBeenCalledOnce();
  });

  it("blocking violations disable with the block-until-clean tooltip", () => {
    render(<GenerateButton generation={controls({ disabledReason: "violations" })} />);

    const button = screen.getByRole("button", { name: "Generate plan" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Resolve blocking violations first");
  });

  it("a complete plan disables with its own tooltip", () => {
    render(<GenerateButton generation={controls({ disabledReason: "complete" })} />);

    expect(screen.getByRole("button", { name: "Generate plan" })).toHaveAttribute("title", "Plan is complete");
  });

  it("board busy disables with the settle tooltip", () => {
    render(<GenerateButton generation={controls({ busy: true })} />);

    const button = screen.getByRole("button", { name: "Generate plan" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Waiting for pending edits to settle");
  });

  it("launching: inert and labelled, so a double click cannot enqueue twice", () => {
    render(<GenerateButton generation={controls({ state: { status: "launching" } })} />);

    expect(screen.getByRole("button", { name: "Generate plan" })).toBeDisabled();
    expect(screen.getByText("Starting…")).toBeInTheDocument();
  });

  it("once launched the button stays disabled — one active job per plan", () => {
    // The database enforces this with a partial unique index; the button says so before the author
    // spends a click discovering it.
    const state = { status: "launched", job: { jobId: "job-1", proposalPlanId: "plan-2" } } as const;
    render(<GenerateButton generation={controls({ state })} />);

    const button = screen.getByRole("button", { name: "Generate plan" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "A generation is already running for this plan");
  });

  it("errors surface inline with role=alert", () => {
    render(<GenerateButton generation={controls({ error: "A generation is already running for this plan." })} />);

    expect(screen.getByRole("alert")).toHaveTextContent("A generation is already running for this plan.");
  });
});
