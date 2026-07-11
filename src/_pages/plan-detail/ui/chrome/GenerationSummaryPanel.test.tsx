import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GenerationSummary } from "../../model/generation/use-generate-plan";
import GenerationSummaryPanel from "./GenerationSummaryPanel";

const summary = (over: Partial<GenerationSummary["diagnostics"]> = {}, softWarnCount = 0): GenerationSummary => ({
  diagnostics: {
    engine: "greedy",
    elapsedMs: 18_300,
    partial: false,
    cohorts: {
      dp1: { occupiedSlotsBefore: 4, occupiedSlotsAfter: 50, unplaced: [] },
      dp2: {
        occupiedSlotsBefore: 0,
        occupiedSlotsAfter: 48,
        unplaced: [{ courseId: "hist", missing: 2 }],
      },
    },
    ...over,
  },
  softWarnCount,
});

const courseDisplay = { hist: { name: "History-HL", color: null } };

describe("GenerationSummaryPanel", () => {
  it("shows per-cohort slots before → after and the budget used", () => {
    render(<GenerationSummaryPanel summary={summary()} courseDisplay={courseDisplay} onDismiss={vi.fn()} />);

    const panel = screen.getByRole("region", { name: "Generation summary" });
    expect(panel).toHaveTextContent("DP1");
    expect(panel).toHaveTextContent("slots 4 → 50");
    expect(panel).toHaveTextContent("slots 0 → 48");
    expect(panel).toHaveTextContent("18.3s used");
  });

  it("resolves unplaced course names at the render edge", () => {
    render(<GenerationSummaryPanel summary={summary()} courseDisplay={courseDisplay} onDismiss={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Generation summary" })).toHaveTextContent("unplaced: History-HL (2h)");
  });

  it("marks a cancelled solve as partial and counts soft warns", () => {
    render(
      <GenerationSummaryPanel
        summary={summary({ partial: true }, 3)}
        courseDisplay={courseDisplay}
        onDismiss={vi.fn()}
      />,
    );

    const panel = screen.getByRole("region", { name: "Generation summary" });
    expect(panel).toHaveTextContent("stopped early — best so far kept");
    expect(panel).toHaveTextContent("3 soft availability warns");
  });

  it("notes a proven-optimal result when the engine provides it", () => {
    render(
      <GenerationSummaryPanel
        summary={summary({ provenOptimal: true })}
        courseDisplay={courseDisplay}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("region", { name: "Generation summary" })).toHaveTextContent("proven optimal");
  });

  it("dismisses on the close button", () => {
    const onDismiss = vi.fn();
    render(<GenerationSummaryPanel summary={summary()} courseDisplay={courseDisplay} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss generation summary" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
