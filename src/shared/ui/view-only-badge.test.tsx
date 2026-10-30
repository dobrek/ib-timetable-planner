import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CurrentPlanBadge } from "./current-plan-badge";
import { ViewOnlyBadge } from "./view-only-badge";

describe("ViewOnlyBadge", () => {
  it("reads 'View only' as text, with the eye icon hidden from assistive tech", () => {
    const { container } = render(<ViewOnlyBadge />);

    expect(screen.getByText("View only", { exact: true })).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  // The collapsed rail shows the icon alone. The label must leave the layout without leaving the
  // accessibility tree, so the caller's class lands on the label span (never the whole chip), and the
  // tooltip carries the same words.
  it("puts the caller's label class on the label, keeping the text and the tooltip", () => {
    render(<ViewOnlyBadge labelClassName="sr-only" />);

    const label = screen.getByText("View only", { exact: true });
    expect(label).toHaveClass("sr-only");
    expect(label.closest("[data-slot=badge]")).toHaveAttribute("title", "View only");
  });

  // It describes the account, not a plan, so it must never read as the filled "Current" chip.
  it("is styled apart from CurrentPlanBadge", () => {
    render(
      <>
        <ViewOnlyBadge />
        <CurrentPlanBadge />
      </>,
    );

    const viewOnly = screen.getByText("View only", { exact: true }).closest("[data-slot=badge]");
    const current = screen.getByText("Current").closest("[data-slot=badge]");
    expect(viewOnly).toHaveAttribute("data-variant", "outline");
    expect(viewOnly?.getAttribute("data-variant")).not.toBe(current?.getAttribute("data-variant"));
  });
});
