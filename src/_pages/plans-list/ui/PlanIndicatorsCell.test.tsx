import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GenerationIndicator } from "../model/plan-indicators";
import PlanIndicatorsCell from "./PlanIndicatorsCell";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const PROPOSAL_ID = "44444444-4444-4444-8444-444444444444";

const indicator = (overrides: Partial<GenerationIndicator> = {}): GenerationIndicator => ({
  kind: "generation",
  jobId: "22222222-2222-4222-8222-222222222222",
  planId: PLAN_ID,
  proposalPlanId: PROPOSAL_ID,
  delivered: false,
  status: "running",
  stageIndex: 4,
  stageName: "teacherHoles",
  startedAt: "2026-08-20T14:02:31.000Z",
  stale: false,
  ...overrides,
});

describe("PlanIndicatorsCell", () => {
  it("renders nothing at all for a plan with no activity", () => {
    // The common case. A placeholder dash would make the column's scan-down read dishonest.
    const { container } = render(<PlanIndicatorsCell indicators={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the running stage and its position in the ladder", () => {
    render(<PlanIndicatorsCell indicators={[indicator()]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Generating — stage 4 of 10 · teacher holes");
  });

  it("announces an ACTIVE badge as a live region, and only an active one", () => {
    // An advancing stage is the unprompted change assistive tech should hear; a table full of
    // terminal badges announcing themselves on load is not.
    const { unmount } = render(<PlanIndicatorsCell indicators={[indicator()]} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    unmount();

    render(<PlanIndicatorsCell indicators={[indicator({ status: "succeeded" })]} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says 'starting' for a claimed job that has not reported a stage yet", () => {
    render(<PlanIndicatorsCell indicators={[indicator({ stageIndex: null, stageName: null })]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Generating — starting");
  });

  it("shows a queued job with the time it started, as machine-readable data", () => {
    render(<PlanIndicatorsCell indicators={[indicator({ status: "queued" })]} />);

    expect(screen.getByRole("status")).toHaveTextContent(/Queued — started/);
    // The `<time>` element carries the instant; the text is the reader's own zone, which is why the
    // element is `suppressHydrationWarning`.
    expect(screen.getByText(/^\d{1,2}:\d{2}/).closest("time")).toHaveAttribute("dateTime", "2026-08-20T14:02:31.000Z");
  });

  it("offers a delivered job a way into the PROPOSAL, which is where the board is", () => {
    render(<PlanIndicatorsCell indicators={[indicator({ status: "succeeded", delivered: true })]} />);

    expect(screen.getByRole("link", { name: "Ready — open" })).toHaveAttribute("href", `/plans/${PROPOSAL_ID}`);
  });

  it("says an undelivered finished job still needs a visit", () => {
    render(<PlanIndicatorsCell indicators={[indicator({ status: "succeeded", delivered: false })]} />);

    expect(screen.getByRole("link", { name: "Finished — open to deliver" })).toHaveAttribute(
      "href",
      `/plans/${PROPOSAL_ID}`,
    );
  });

  it("offers a failed job a way into the SOURCE, so the strip can say what went wrong", () => {
    render(<PlanIndicatorsCell indicators={[indicator({ status: "failed" })]} />);
    expect(screen.getByRole("link", { name: "Failed — open plan" })).toHaveAttribute("href", `/plans/${PLAN_ID}`);
  });

  it.each([["stopped" as const], ["interrupted" as const]])(
    "treats a %s job as the same question — did a board land?",
    (status) => {
      render(<PlanIndicatorsCell indicators={[indicator({ status, delivered: true })]} />);
      expect(screen.getByRole("link", { name: "Ready — open" })).toHaveAttribute("href", `/plans/${PROPOSAL_ID}`);
    },
  );

  it("keeps the live region on an ACTIVE badge now that it also links", () => {
    // S-306 gave the active badge an href for the first time. The role used to sit only on the
    // non-link branch, so the change would have silently dropped the one live region on this page.
    render(<PlanIndicatorsCell indicators={[indicator({ status: "running" })]} />);

    const badge = screen.getByRole("status");
    expect(badge.tagName).toBe("A");
    expect(badge).toHaveAttribute("href", `/plans/${PROPOSAL_ID}`);
  });

  it("carries no palette-named or arbitrary colour classes — semantic tokens only", () => {
    const { container } = render(<PlanIndicatorsCell indicators={[indicator()]} />);
    const classes = [...container.querySelectorAll("*")].flatMap((node) => [...node.classList]);
    expect(classes.filter((name) => /^(bg|text|border)-(gray|slate|red|green|blue|amber)-|\[#/.test(name))).toEqual([]);
  });
});
