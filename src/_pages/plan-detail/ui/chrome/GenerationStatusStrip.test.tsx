import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOLVE_POLICY } from "@/entities/timetable";
import type { GenerationJobView } from "../../api/generation-delivery";
import type { GenerationControls } from "../../model/use-cohort-board-state";
import GenerationStatusStrip from "./GenerationStatusStrip";

/**
 * Two roles, two stories (S-306). The same job row renders on the SOURCE plan, where the solve is
 * something happening elsewhere, and on the PROPOSAL plan, where it is what the page is made of. Most
 * of what this suite pins is the boundary between them — in particular that the source falls SILENT
 * once a board has been delivered, because the result is not on that plan.
 */
const job = (over: Partial<GenerationJobView> = {}): GenerationJobView => ({
  jobId: "job-1",
  status: "running",
  role: "source",
  sourcePlanId: "plan-1",
  sourcePlanName: null,
  proposalPlanId: "plan-2",
  delivered: false,
  error: null,
  createdAt: "2026-08-13T07:40:07.000Z",
  finishedAt: null,
  cleanLabel: { kind: "unavailable" },
  checkpointStageIndex: null,
  stageIndex: null,
  stageName: null,
  stopRequestedAt: null,
  policy: DEFAULT_SOLVE_POLICY,
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

  describe("on the source plan", () => {
    it("active: names the state it is solving from, and that leaving is fine", () => {
      render(<GenerationStatusStrip generation={tracking(job({ status: "running" }))} />);

      expect(screen.getByRole("status")).toHaveTextContent(
        /Generating a proposal from the \d{1,2}:\d{2}(\s?[AP]M)? state/,
      );
      // The instant travels in `dateTime`; the readable text is the reader's own zone, filled in only
      // after hydration (jsdom renders as an already-hydrated client) — see `useHydrated`.
      expect(screen.getByRole("status").querySelector("time")).toHaveAttribute("dateTime", "2026-08-13T07:40:07.000Z");
      expect(screen.getByText(/you can leave the page/)).toBeInTheDocument();
    });

    it("active: offers the proposal, which is openable from the first second", () => {
      // The point of the whole slice: the clone is a listed, visitable plan while it solves, so the
      // advisory is a route to it rather than a dead sentence.
      render(<GenerationStatusStrip generation={tracking(job({ status: "running" }))} />);

      expect(screen.getByRole("link", { name: /Open proposal/ })).toHaveAttribute("href", "/plans/plan-2");
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

    it("renders NOTHING once the board is delivered — the result is not on this plan", () => {
      // The source is never written to (FR-307). A "ready" banner here would send the author looking
      // for a board that landed somewhere else; the hub's badge and the proposal's own page carry it.
      const view = job({ status: "succeeded", delivered: true, cleanLabel: { kind: "clean" } });
      const { container } = render(<GenerationStatusStrip generation={tracking(view)} />);

      expect(container).toBeEmptyDOMElement();
    });

    it("renders nothing for a terminal job whose board has not been delivered yet either", () => {
      // The window between the solver finishing and a check running. There is still nothing on THIS
      // plan to report, and the next visit to either plan delivers.
      const { container } = render(
        <GenerationStatusStrip generation={tracking(job({ status: "succeeded", delivered: false }))} />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it("failed: surfaces the diagnostic through role=alert — a failure has no proposal to live on", () => {
      const view = job({ status: "failed", proposalPlanId: null, error: "infeasible: no complete board" });
      render(<GenerationStatusStrip generation={tracking(view)} />);

      expect(screen.getByRole("alert")).toHaveTextContent("Generation failed: infeasible: no complete board");
      expect(screen.getByRole("button", { name: /Refresh/ })).toBeEnabled();
    });

    it("failed without a message still says so rather than rendering an empty strip", () => {
      render(<GenerationStatusStrip generation={tracking(job({ status: "failed", error: null }))} />);

      expect(screen.getByRole("alert")).toHaveTextContent("Generation failed.");
    });

    it("halted with nothing kept says so plainly, and is advisory rather than an alert", () => {
      // The run was cut short; that is not the author's data being wrong, so no role=alert. The two
      // halted statuses split their WORDING (S-305) while sharing this branch and its tone.
      for (const [status, expected] of [
        ["interrupted", /Generation was interrupted before any stage finished/],
        ["stopped", /You stopped this generation/],
      ] as const) {
        const view = job({ status, delivered: false, checkpointStageIndex: null });
        const { unmount } = render(<GenerationStatusStrip generation={tracking(view)} />);

        expect(screen.getByRole("status")).toHaveTextContent(expected);
        expect(screen.getByRole("status")).toHaveTextContent(/nothing was kept. Generate again when you are ready./);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        unmount();
      }
    });
  });

  describe("on the proposal plan", () => {
    const proposal = (over: Partial<GenerationJobView> = {}) =>
      job({ role: "proposal", delivered: true, status: "succeeded", sourcePlanName: "Year 2026/27", ...over });

    it("names the source it was generated from, and links to it", () => {
      // A proposal is named `Proposal — <source>` only until the author renames it; after that this
      // link is the only record of where the board came from.
      render(<GenerationStatusStrip generation={tracking(proposal({ cleanLabel: { kind: "clean" } }))} />);

      expect(screen.getByRole("link", { name: "Year 2026/27" })).toHaveAttribute("href", "/plans/plan-1");
      expect(screen.getByText(/Generated from/)).toBeInTheDocument();
    });

    it("names the policy the board was solved under — the one surface that shows it afterwards", () => {
      const view = proposal({ cleanLabel: { kind: "clean" }, policy: { preset: "student-first" } });
      render(<GenerationStatusStrip generation={tracking(view)} />);

      expect(screen.getByText(/· student-first policy/)).toBeInTheDocument();
    });

    it("says why a not-clean board is not clean in the policy's own terms", () => {
      const view = proposal({ cleanLabel: { kind: "not-clean", softHits: 3, floor: 1, cleanRequested: false } });
      render(<GenerationStatusStrip generation={tracking(view)} />);

      expect(screen.getByText(/The canonical order policy does not require a clean board/)).toBeInTheDocument();
    });

    it("states the clean label beside the provenance", () => {
      render(<GenerationStatusStrip generation={tracking(proposal({ cleanLabel: { kind: "clean" } }))} />);

      expect(screen.getByText(/no lesson sits on a soft-unavailable cell/)).toBeInTheDocument();
    });

    it("an at-the-floor board names the residue instead of claiming clean", () => {
      const view = proposal({ cleanLabel: { kind: "clean-at-floor", pinnedHours: 2 } });
      render(<GenerationStatusStrip generation={tracking(view)} />);

      expect(screen.getByText(/2 pinned hours remain on soft cells/)).toBeInTheDocument();
    });

    it("falls back to a generic label when the source name could not be read", () => {
      render(<GenerationStatusStrip generation={tracking(proposal({ sourcePlanName: null }))} />);

      expect(screen.getByRole("link", { name: "the source plan" })).toHaveAttribute("href", "/plans/plan-1");
    });

    it("a halted run says which stage's board was kept, instead of a clean label it cannot support", () => {
      // A mid-ladder run rarely reaches tier 5, so `describeCleanLabel` would say "unavailable" — true
      // but useless. The stage summary replaces it rather than sitting beside it. The author's decision
      // is "keep this or run it again", and the stage number is what it turns on.
      const view = proposal({ status: "interrupted", checkpointStageIndex: 3, cleanLabel: { kind: "clean" } });
      render(<GenerationStatusStrip generation={tracking(view)} />);

      expect(screen.getByText(/kept the board from stage 3 of 10/)).toBeInTheDocument();
      expect(screen.queryByText(/no lesson sits on a soft-unavailable cell/)).not.toBeInTheDocument();
    });

    it("distinguishes the author stopping the run from the platform interrupting it", () => {
      // S-305 gives `stopped` a producer, so the two statuses stop being interchangeable here: one is
      // something the author did on purpose, the other something that happened to them. Saying
      // "Stopped" over both would attribute the platform's act to the author.
      for (const [status, expected] of [
        ["stopped", "Stopped early — kept the board from stage 4 of 10."],
        ["interrupted", "Interrupted — kept the board from stage 4 of 10."],
      ] as const) {
        const view = proposal({ status, checkpointStageIndex: 4 });
        const { unmount } = render(<GenerationStatusStrip generation={tracking(view)} />);

        expect(screen.getByText(expected)).toBeInTheDocument();
        unmount();
      }
    });

    it("renders nothing before the board has landed — that page is the pending panel, not a strip", () => {
      const { container } = render(
        <GenerationStatusStrip generation={tracking(proposal({ delivered: false, status: "running" }))} />,
      );

      expect(container).toBeEmptyDOMElement();
    });
  });
});
