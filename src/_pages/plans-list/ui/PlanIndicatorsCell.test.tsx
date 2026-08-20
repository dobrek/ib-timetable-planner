import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GenerationIndicator } from "../model/plan-indicators";
import PlanIndicatorsCell from "./PlanIndicatorsCell";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

const indicator = (overrides: Partial<GenerationIndicator> = {}): GenerationIndicator => ({
  kind: "generation",
  jobId: "22222222-2222-4222-8222-222222222222",
  planId: PLAN_ID,
  status: "running",
  stageIndex: 4,
  stageName: "teacherHoles",
  startedAt: "2026-08-20T14:02:31.000Z",
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

  it("offers a finished job a way into the SOURCE plan, where delivery happens", () => {
    render(<PlanIndicatorsCell indicators={[indicator({ status: "succeeded" })]} />);

    const link = screen.getByRole("link", { name: "Finished — open plan" });
    expect(link).toHaveAttribute("href", `/plans/${PLAN_ID}`);
  });

  it("offers a failed job the same way in, so the strip can say what went wrong", () => {
    render(<PlanIndicatorsCell indicators={[indicator({ status: "failed" })]} />);
    expect(screen.getByRole("link", { name: "Failed — open plan" })).toHaveAttribute("href", `/plans/${PLAN_ID}`);
  });

  it.each([
    ["stopped" as const, "Stopped"],
    ["interrupted" as const, "Interrupted"],
  ])("names a %s job plainly rather than dressing it as a failure", (status, label) => {
    render(<PlanIndicatorsCell indicators={[indicator({ status })]} />);
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  });

  it("carries no palette-named or arbitrary colour classes — semantic tokens only", () => {
    const { container } = render(<PlanIndicatorsCell indicators={[indicator()]} />);
    const classes = [...container.querySelectorAll("*")].flatMap((node) => [...node.classList]);
    expect(classes.filter((name) => /^(bg|text|border)-(gray|slate|red|green|blue|amber)-|\[#/.test(name))).toEqual([]);
  });
});
