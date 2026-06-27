import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Boxes, Inbox } from "lucide-react";
import CollapsibleEdgePanel from "./CollapsibleEdgePanel";

// Presentational shell shared by the palette (left) and the shelf (right). These lock the chrome
// contract both consumers depend on: the collapsed-rail / collapse-button accessible names, the
// disclosure callbacks, and the header / toolbar / body slot placement.

const renderPanel = (overrides: Partial<React.ComponentProps<typeof CollapsibleEdgePanel>> = {}) => {
  const props: React.ComponentProps<typeof CollapsibleEdgePanel> = {
    side: "left",
    icon: Boxes,
    label: "Groupings",
    name: "palette",
    countNoun: "groupings",
    count: 3,
    collapsed: false,
    onCollapsedChange: vi.fn(),
    openWidthClass: "w-64",
    dataSlot: "planner-palette",
    children: <div data-testid="body">body</div>,
    ...overrides,
  };
  render(<CollapsibleEdgePanel {...props} />);
  return props;
};

describe("CollapsibleEdgePanel", () => {
  it("expanded: shows the header label + count, the body, and collapses on the collapse click", () => {
    const props = renderPanel({ collapsed: false });

    expect(screen.getByText("Groupings")).toBeInTheDocument();
    expect(screen.getByTestId("body")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="palette-count"]')?.textContent).toBe("3");

    fireEvent.click(screen.getByRole("button", { name: "Collapse palette" }));
    expect(props.onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("collapsed: the rail names the count and expands on click", () => {
    const props = renderPanel({ collapsed: true });

    const rail = screen.getByRole("button", { name: "Open palette (3 groupings)" });
    fireEvent.click(rail);
    expect(props.onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("renders headerActions and the toolbar slot in the expanded section", () => {
    renderPanel({
      headerActions: <button type="button">pin</button>,
      toolbar: <div data-testid="toolbar">switcher</div>,
    });

    expect(screen.getByRole("button", { name: "pin" })).toBeInTheDocument();
    expect(screen.getByTestId("toolbar")).toBeInTheDocument();
  });

  it("uses the side-specific name for the rail + collapse accessible names (shelf)", () => {
    renderPanel({ side: "right", icon: Inbox, label: "Shelf", name: "shelf", countNoun: "parked", count: 1 });

    expect(screen.getByRole("button", { name: "Collapse shelf" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open shelf (1 parked)" })).toBeInTheDocument();
  });

  it("disables the collapse control when collapseDisabled is set (shelf pinned)", () => {
    renderPanel({ collapseDisabled: true, collapseTitle: "Unpin to collapse" });

    const collapse = screen.getByRole("button", { name: "Collapse palette" });
    expect(collapse).toBeDisabled();
    expect(collapse).toHaveAttribute("title", "Unpin to collapse");
  });
});
