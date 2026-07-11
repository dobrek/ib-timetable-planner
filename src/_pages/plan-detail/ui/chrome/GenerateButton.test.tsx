import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GenerationControls } from "../../model/use-cohort-board-state";
import GenerateButton from "./GenerateButton";

const controls = (over: Partial<GenerationControls> = {}): GenerationControls => ({
  run: { status: "idle" },
  error: null,
  summary: null,
  generate: vi.fn(),
  cancel: vi.fn(),
  dismissSummary: vi.fn(),
  disabledReason: null,
  busy: false,
  ...over,
});

describe("GenerateButton", () => {
  it("idle: enabled, and a click generates", () => {
    const generation = controls();
    render(<GenerateButton generation={generation} />);

    const button = screen.getByRole("button", { name: "Generate plan" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(generation.generate).toHaveBeenCalledOnce();
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

  it("board busy disables without a reason-specific tooltip", () => {
    render(<GenerateButton generation={controls({ busy: true })} />);

    const button = screen.getByRole("button", { name: "Generate plan" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Waiting for pending edits to settle");
  });

  it("solving: shows progress vs budget and Stop & keep cancels", () => {
    const generation = controls({
      run: { status: "solving", elapsedMs: 5000, budgetMs: 20000, cancelRequested: false },
    });
    render(<GenerateButton generation={generation} />);

    expect(screen.getByRole("status")).toHaveTextContent("5s / 20s");
    fireEvent.click(screen.getByRole("button", { name: "Stop & keep" }));
    expect(generation.cancel).toHaveBeenCalledOnce();
  });

  it("a requested cancel reads Stopping… and goes inert", () => {
    render(
      <GenerateButton
        generation={controls({ run: { status: "solving", elapsedMs: 5000, budgetMs: 20000, cancelRequested: true } })}
      />,
    );

    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  });

  it("applying: the button is inert and labelled", () => {
    render(<GenerateButton generation={controls({ run: { status: "applying" } })} />);

    expect(screen.getByRole("button", { name: "Generate plan" })).toBeDisabled();
    expect(screen.getByText("Applying…")).toBeInTheDocument();
  });

  it("errors surface inline with role=alert", () => {
    render(<GenerateButton generation={controls({ error: "Generation failed: boom" })} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Generation failed: boom");
  });
});
