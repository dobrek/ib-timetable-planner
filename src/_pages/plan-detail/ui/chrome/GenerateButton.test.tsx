import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOLVE_POLICY, type SolvePolicy } from "@/entities/timetable";
import type { GenerationJobView } from "../../api/generation-delivery";
import type { GenerationControls } from "../../model/use-cohort-board-state";
import GenerateButton from "./GenerateButton";

/**
 * Two halves (S-307). The TRIGGER keeps every state it had — the disable reasons, the tooltips, the
 * "Starting…" inertness — and the DIALOG behind it is where the policy is chosen. Copy is a tested
 * contract here as it is in `StopAndKeep.test.tsx`: each option's sentence is what the author reads
 * before deciding, and it must state a consequence rather than a verdict.
 */
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

const trackedJob = (status: GenerationJobView["status"], policy: SolvePolicy = DEFAULT_SOLVE_POLICY) => ({
  jobId: "job-1",
  status,
  proposalPlanId: "plan-2",
  delivered: status === "succeeded",
  error: null,
  createdAt: "2026-08-13T07:40:07.000Z",
  finishedAt: null,
  cleanLabel: { kind: "clean" } as const,
  checkpointStageIndex: null,
  role: "source" as const,
  sourcePlanId: "plan-1",
  sourcePlanName: null,
  stageIndex: null,
  stageName: null,
  stopRequestedAt: null,
  policy,
});

const openDialog = () => {
  fireEvent.click(screen.getByRole("button", { name: "Generate plan" }));
  return screen.getByRole("alertdialog");
};

const radio = (name: string) => screen.getByRole("radio", { name });

describe("GenerateButton — the trigger", () => {
  it("idle: enabled, and a click opens the confirm dialog rather than launching", () => {
    const generation = controls();
    render(<GenerateButton generation={generation} />);

    const button = screen.getByRole("button", { name: "Generate plan" });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(generation.launch).not.toHaveBeenCalled();
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
    // spends a click discovering it. The DERIVATION lives in `use-cohort-board-state` (S-306); what
    // this pins is the button's half of the contract.
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

describe("GenerateButton — the dialog", () => {
  it("pre-selects the default policy when the plan has no previous job", () => {
    render(<GenerateButton generation={controls()} />);
    openDialog();

    expect(screen.getByRole("radiogroup", { name: "Solve policy" })).toBeInTheDocument();
    expect(radio("clean")).toHaveAttribute("aria-checked", "true");
    expect(radio("canonical order")).toHaveAttribute("aria-checked", "false");
    expect(radio("student-first")).toHaveAttribute("aria-checked", "false");
  });

  it("pre-selects the previous job's policy — the audit column earning its keep", () => {
    const job = trackedJob("succeeded", { preset: "student-first" });
    render(<GenerateButton generation={controls({ state: { status: "tracking", job } })} />);
    openDialog();

    expect(radio("student-first")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Generate — student-first" })).toBeInTheDocument();
  });

  it("seeds on OPEN, not on mount, so a job read back after a launch seeds the next open", () => {
    const { rerender } = render(<GenerateButton generation={controls()} />);
    // The component mounted with no job; the job arrives later (a launch, then the re-read).
    const job = trackedJob("succeeded", { preset: "canonical" });
    rerender(<GenerateButton generation={controls({ state: { status: "tracking", job } })} />);
    openDialog();

    expect(radio("canonical order")).toHaveAttribute("aria-checked", "true");
  });

  it("shows each option's consequence when it is selected, and the confirm follows the selection", () => {
    render(<GenerateButton generation={controls()} />);
    openDialog();

    expect(screen.getByText(/Keeps every generated lesson off soft-unavailable cells/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate — clean" })).toBeInTheDocument();

    fireEvent.click(radio("canonical order"));
    expect(screen.getByText(/may place lessons on soft cells when that improves an earlier tier/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate — canonical order" })).toBeInTheDocument();

    fireEvent.click(radio("student-first"));
    expect(screen.getByText(/closes students' free periods before compacting the day/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate — student-first" })).toBeInTheDocument();
  });

  it("states consequences only — no option is ranked, compared, or given a number", () => {
    render(<GenerateButton generation={controls()} />);
    const dialog = openDialog();

    for (const name of ["clean", "canonical order", "student-first"]) {
      fireEvent.click(radio(name));
      const copy = dialog.textContent;
      expect(copy).not.toMatch(/\d/);
      expect(copy).not.toMatch(/\b(better|best|worse|faster|slower|recommended)\b/i);
    }
  });

  it("confirm launches with the chosen policy and closes the dialog", () => {
    const generation = controls();
    render(<GenerateButton generation={generation} />);
    openDialog();

    fireEvent.click(radio("student-first"));
    fireEvent.click(screen.getByRole("button", { name: "Generate — student-first" }));

    expect(generation.launch).toHaveBeenCalledExactlyOnceWith({ preset: "student-first" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("cancel closes without launching", () => {
    const generation = controls();
    render(<GenerateButton generation={generation} />);
    openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(generation.launch).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("a disable reason arriving while open disables confirm and shows the reason as text", () => {
    // The live re-gate: the board became complete (or gained a blocking violation) in another tab
    // while the author was deciding. The trigger's `title` cannot be read from inside a modal, so
    // the reason has to appear in the dialog, as a live region.
    const { rerender } = render(<GenerateButton generation={controls()} />);
    openDialog();
    expect(screen.getByRole("button", { name: "Generate — clean" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(<GenerateButton generation={controls({ disabledReason: "complete" })} />);

    expect(screen.getByRole("button", { name: "Generate — clean" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Plan is complete");
  });

  it("ignores the empty value Radix emits on re-press — a policy is never cleared", () => {
    render(<GenerateButton generation={controls()} />);
    openDialog();

    fireEvent.click(radio("clean"));

    expect(radio("clean")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Generate — clean" })).toBeInTheDocument();
  });
});
