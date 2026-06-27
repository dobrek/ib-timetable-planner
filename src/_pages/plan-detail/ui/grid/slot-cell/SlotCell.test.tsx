import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import { describe, expect, it, vi } from "vitest";
import type { PlacementWeek } from "@/shared/config";
import { DEFAULT_HINT_MODE } from "../../../lib/drag-hint-mode";
import type { CellOccupant } from "../../../model/collision/cell-occupants";
import SlotCell from "./SlotCell";

// Locks the duplicate affordance rules: the header Copy button shows for EVERY ≥2-occupant cell
// (grouped OR exploded — unlike the bundled-gated trash), single-occupant cells get an
// always-visible Copy sibling, both call onDuplicateBundle(day, period), and the trash stays
// bundled-gated. The cell is a dnd droppable/draggable, so it renders inside a DragDropProvider.

const occupant = (courseId: string, name: string, week: PlacementWeek = "both"): CellOccupant => ({
  placement: { id: `p-${courseId}`, courseId, day: 2, period: 3, week },
  name,
  blocking: false,
  warning: false,
  unavailable: false,
});

type CellProps = ComponentProps<typeof SlotCell>;

const renderCell = (occupants: CellOccupant[], bundled: boolean, overrides: Partial<CellProps> = {}) => {
  const onDuplicateBundle = vi.fn();
  const props: CellProps = {
    day: 2,
    period: 3,
    occupants,
    dropHint: undefined,
    hintActive: false,
    hintMode: DEFAULT_HINT_MODE,
    bundled,
    justDuplicated: false,
    onRemove: vi.fn(),
    onSetWeek: vi.fn(),
    onToggleBundle: vi.fn(),
    onRemoveBundle: vi.fn(),
    onDuplicateBundle,
    onLiftBundle: vi.fn(),
    onInspect: vi.fn(),
    ...overrides,
  };
  render(
    <DragDropProvider>
      <SlotCell {...props} />
    </DragDropProvider>,
  );
  return { onDuplicateBundle };
};

const headerDuplicate = () => screen.getByRole("button", { name: "Duplicate slot to next free slot" });
const trash = () => screen.queryByRole("button", { name: "Remove all from slot" });

describe("SlotCell — duplicate affordance", () => {
  const twoOccupants = [occupant("A", "Alpha"), occupant("B", "Bravo")];

  it("shows the header duplicate button on a grouped ≥2 cell, alongside the trash", () => {
    renderCell(twoOccupants, true);
    expect(headerDuplicate()).toBeInTheDocument();
    expect(trash()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ungroup slot" })).toBeInTheDocument();
  });

  it("keeps the header duplicate button on an exploded ≥2 cell, where the trash is hidden", () => {
    renderCell(twoOccupants, false);
    // Ungrouping must never hide duplicate — but the trash IS bundled-gated and disappears.
    expect(headerDuplicate()).toBeInTheDocument();
    expect(trash()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Group slot" })).toBeInTheDocument();
  });

  it("clicking the header duplicate calls onDuplicateBundle with the cell coords", () => {
    const { onDuplicateBundle } = renderCell(twoOccupants, true);
    fireEvent.click(headerDuplicate());
    expect(onDuplicateBundle).toHaveBeenCalledWith(2, 3);
  });

  it("shows the always-visible duplicate icon on a single-occupant cell (header present, no toggle)", () => {
    renderCell([occupant("A", "Alpha")], false);
    expect(screen.getByRole("button", { name: "Duplicate Alpha to next free slot" })).toBeInTheDocument();
    // The single-occupant header carries only the duplicate — no group/ungroup toggle (grouping
    // needs >=2), and the duplicate is name-specific, not the generic bundle label.
    expect(screen.queryByRole("button", { name: /^(Ungroup|Group) slot$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicate slot to next free slot" })).not.toBeInTheDocument();
  });

  it("clicking the single-occupant duplicate calls onDuplicateBundle with the cell coords", () => {
    const { onDuplicateBundle } = renderCell([occupant("A", "Alpha")], false);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Alpha to next free slot" }));
    expect(onDuplicateBundle).toHaveBeenCalledWith(2, 3);
  });

  it("renders no duplicate control on an empty cell", () => {
    renderCell([], false);
    expect(screen.queryByRole("button", { name: /Duplicate/ })).not.toBeInTheDocument();
  });
});
