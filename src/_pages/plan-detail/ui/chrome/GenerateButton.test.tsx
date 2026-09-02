import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOLVE_POLICY } from "@/entities/timetable";
import type { GenerationJobView } from "../../api/generation-delivery";
import type { GenerationControls } from "../../model/use-cohort-board-state";
import GenerateButton from "./GenerateButton";

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

const trackedJob = (status: GenerationJobView["status"]): GenerationJobView => ({
  jobId: "job-1",
  status,
  proposalPlanId: "plan-2",
  delivered: status === "succeeded",
  error: null,
  createdAt: "2026-08-13T07:40:07.000Z",
  finishedAt: null,
  cleanLabel: { kind: "clean" },
  checkpointStageIndex: null,
  role: "source",
  sourcePlanId: "plan-1",
  sourcePlanName: null,
  stageIndex: null,
  stageName: null,
  stopRequestedAt: null,
  policy: DEFAULT_SOLVE_POLICY,
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

  it("a LIVE job disables the button — one active job per plan", () => {
    // The database enforces this with a partial unique index; the button says so before the author
    // spends a click discovering it.
    //
    // The DERIVATION moved to `use-cohort-board-state` with S-306 (so a live job can outrank the
    // board-derived reasons); what this pins is the button's half of the contract — that
    // `disabledReason: "generating"` disables it and names why. The derivation itself is pinned in
    // `use-cohort-board-state.test.ts`.
    render(
      <GenerateButton
        generation={controls({
          state: { status: "tracking", job: trackedJob("running") },
          disabledReason: "generating",
        })}
      />,
    );

    const button = screen.getByRole("button", { name: "Generate plan" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "A generation is already running for this plan");
  });

  it("a finished job does NOT disable it — the plan is enqueueable again", () => {
    // Matching the partial unique index, which only covers queued/running. A button that stayed
    // disabled after delivery would be stricter than the database and strand the author.
    for (const status of ["succeeded", "failed"] as const) {
      const { unmount } = render(
        <GenerateButton generation={controls({ state: { status: "tracking", job: trackedJob(status) } })} />,
      );
      expect(screen.getByRole("button", { name: "Generate plan" }), status).toBeEnabled();
      unmount();
    }
  });

  it("errors surface inline with role=alert", () => {
    render(<GenerateButton generation={controls({ error: "A generation is already running for this plan." })} />);

    expect(screen.getByRole("alert")).toHaveTextContent("A generation is already running for this plan.");
  });
});
