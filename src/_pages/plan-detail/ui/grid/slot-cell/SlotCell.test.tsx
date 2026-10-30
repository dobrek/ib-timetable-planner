import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import { describe, expect, it, vi } from "vitest";
import type { PlacementWeek } from "@/shared/config";
import { DEFAULT_HINT_MODE } from "../../../lib/drag-hint-mode";
import type { CellOccupant } from "@/entities/timetable";
import SlotCell from "./SlotCell";

// Locks the duplicate affordance rules: the header Copy button shows for EVERY ≥2-occupant cell
// (grouped OR exploded — unlike the bundled-gated trash), single-occupant cells get an
// always-visible Copy sibling, both call onDuplicateBundle(day, period), and the trash stays
// bundled-gated. The cell is a dnd droppable/draggable, so it renders inside a DragDropProvider.

const occupant = (courseId: string, name: string, week: PlacementWeek = "both"): CellOccupant => ({
  placement: { id: `p-${courseId}`, courseId, day: 2, period: 3, week, isOptional: false },
  name,
  color: null,
  blocking: false,
  warning: false,
  unavailable: false,
  finishesEarly: false,
});

type CellProps = ComponentProps<typeof SlotCell>;

const renderCell = (occupants: CellOccupant[], bundled: boolean, overrides: Partial<CellProps> = {}) => {
  const onDuplicateBundle = vi.fn();
  const props: CellProps = {
    day: 2,
    period: 3,
    cohort: "dp1",
    occupants,
    dropHint: undefined,
    hintActive: false,
    hintMode: DEFAULT_HINT_MODE,
    bundled,
    justDuplicated: false,
    lensMatched: null,
    onToggleBundle: vi.fn(),
    onInspect: vi.fn(),
    edit: {
      onRemove: vi.fn(),
      onSetWeek: vi.fn(),
      onSetOptional: vi.fn(),
      onRemoveBundle: vi.fn(),
      onDuplicateBundle,
      onLiftBundle: vi.fn(),
    },
    ...overrides,
  };
  render(
    <DragDropProvider>
      <SlotCell {...props} />
    </DragDropProvider>,
  );
  return { onDuplicateBundle };
};

const isPlacementChip = (element: HTMLElement): boolean => element.getAttribute("aria-roledescription") === "placement";

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

// S-405: a cell without `edit` (a viewer's board) renders only its read affordances. Every absence
// below is paired with the same cell WITH `edit`, so the test cannot pass on a cell that never
// rendered the control in the first place.
describe("SlotCell — without edit (a viewer)", () => {
  const readOnly = { edit: undefined };
  const writeButtons = () => [
    screen.queryByRole("button", { name: /^Duplicate/ }),
    screen.queryByRole("button", { name: "Lift to shelf" }),
    trash(),
  ];
  // An exploded opposite-week pair: each chip would carry the A/B toggle and its "⋯" menu, and the
  // blocking one the collision badge.
  const opposedPair = [{ ...occupant("A", "Alpha", "a"), blocking: true }, occupant("B", "Bravo", "b")];
  const weekRadios = () => [
    ...screen.queryAllByRole("radio", { name: "Week A" }),
    ...screen.queryAllByRole("radio", { name: "Week B" }),
  ];
  const chipMenus = () => screen.queryAllByRole("button", { name: /^Actions for / });

  it("a bundled cell keeps Ungroup and renders no Duplicate, Lift to shelf or Remove all", () => {
    renderCell([occupant("A", "Alpha"), occupant("B", "Bravo")], true, readOnly);
    expect(screen.getByRole("button", { name: "Ungroup slot" })).toBeInTheDocument();
    expect(writeButtons()).toEqual([null, null, null]);
  });

  it("the same bundled cell with edit renders all three", () => {
    renderCell([occupant("A", "Alpha"), occupant("B", "Bravo")], true);
    expect(writeButtons().every((button) => button !== null)).toBe(true);
  });

  it("a bundled cell is not grabbable without edit", () => {
    renderCell([occupant("A", "Alpha"), occupant("B", "Bravo")], true, readOnly);
    expect(screen.getByRole("gridcell")).not.toHaveClass("cursor-grab");
  });

  it("the same bundled cell with edit is grabbable", () => {
    renderCell([occupant("A", "Alpha"), occupant("B", "Bravo")], true);
    expect(screen.getByRole("gridcell")).toHaveClass("cursor-grab");
  });

  // dnd-kit's accessibility plugin mirrors each draggable's `disabled` onto `aria-disabled`, so this
  // is the drag itself, not the cursor that hints at it.
  const placementChips = () => screen.getAllByRole("button").filter(isPlacementChip);

  it("an exploded cell's chips do not drag without edit", async () => {
    renderCell(opposedPair, false, readOnly);
    await waitFor(() => {
      expect(placementChips().map((chip) => chip.getAttribute("aria-disabled"))).toEqual(["true", "true"]);
    });
  });

  it("the same exploded cell's chips drag with edit", async () => {
    renderCell(opposedPair, false);
    await waitFor(() => {
      expect(placementChips().map((chip) => chip.getAttribute("aria-disabled"))).toEqual(["false", "false"]);
    });
  });

  it("an exploded cell renders no week toggle and no chip menu, and keeps Group and the inspect badge", () => {
    renderCell(opposedPair, false, readOnly);
    expect(weekRadios()).toEqual([]);
    expect(chipMenus()).toEqual([]);
    expect(screen.getByRole("button", { name: "Group slot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show collision details" })).toBeInTheDocument();
  });

  it("the same exploded cell with edit renders both week toggles and both chip menus", () => {
    renderCell(opposedPair, false);
    expect(weekRadios()).toHaveLength(4);
    expect(chipMenus()).toHaveLength(2);
  });

  it("a single-occupant cell renders no control strip (its only controls are writes)", () => {
    renderCell([occupant("A", "Alpha")], false, readOnly);
    expect(screen.getByRole("gridcell").querySelector('[data-slot="slot-header"]')).toBeNull();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("the same single-occupant cell with edit renders its control strip", () => {
    renderCell([occupant("A", "Alpha")], false);
    expect(screen.getByRole("gridcell").querySelector('[data-slot="slot-header"]')).not.toBeNull();
  });
});
