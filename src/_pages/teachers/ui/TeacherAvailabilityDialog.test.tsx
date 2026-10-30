import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { refreshPage } from "@/shared/lib/forms";
import {
  clearAvailabilityCell,
  setAvailabilityCell,
  setAvailabilityColumn,
  setAvailabilityRow,
} from "../api/teacher-client";
import type { TeacherRow } from "../model/teacher";
import TeacherAvailabilityDialog from "./TeacherAvailabilityDialog";

vi.mock("../api/teacher-client", () => ({
  setAvailabilityCell: vi.fn(),
  clearAvailabilityCell: vi.fn(),
  setAvailabilityColumn: vi.fn(),
  setAvailabilityRow: vi.fn(),
}));
vi.mock("@/shared/lib/forms", () => ({ refreshPage: vi.fn() }));

/**
 * The availability dialog in both of its modes (S-405). The row's badge is where a teacher's
 * availability is shown, so a viewer still opens this dialog — and must read every slot an author
 * can toggle, with nothing that toggles. Each read-only assertion has an editor twin, so an absence
 * cannot pass on a control that never existed.
 */
const DAYS = 3;
const PERIODS = 3;

const teacher: TeacherRow = {
  id: "teacher-1",
  code: "JDO",
  fullName: "Jane Doe",
  assignments: [],
  availability: [
    { day: 1, period: 1, severity: "strong" },
    { day: 2, period: 3, severity: "soft" },
  ],
};

const renderDialog = (canEdit: boolean) =>
  render(
    <TeacherAvailabilityDialog
      teacher={teacher}
      planId="plan-1"
      days={DAYS}
      periods={PERIODS}
      onClose={vi.fn()}
      canEdit={canEdit}
    />,
  );

/** A slot's accessible name, e.g. "Mon P1: strong (cannot)" — the same in both modes. */
const SLOT_NAME = /^\w{3} P\d+: /;

const namesOf = (elements: HTMLElement[]): string[] =>
  elements.map((element) => element.getAttribute("aria-label") ?? "").filter((name) => SLOT_NAME.test(name));

describe("TeacherAvailabilityDialog", () => {
  it("gives an editor a cycle button per slot, per day column and per period row", () => {
    renderDialog(true);
    const dialog = screen.getByRole("dialog", { name: "Availability — Jane Doe" });

    expect(within(dialog).getByRole("button", { name: "Mon P1: strong (cannot)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Tue P3: soft (prefers not)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Wed P2: available" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cycle the whole Mon column" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cycle the whole P1 row" })).toBeInTheDocument();
  });

  it("gives a viewer every slot as a named, non-interactive cell", () => {
    renderDialog(false);
    const grid = screen.getByRole("grid", { name: "Availability — Jane Doe" });

    expect(within(grid).getAllByRole("gridcell")).toHaveLength(DAYS * PERIODS);
    expect(within(grid).getByRole("gridcell", { name: "Mon P1: strong (cannot)" })).toBeInTheDocument();
    expect(within(grid).getByRole("gridcell", { name: "Tue P3: soft (prefers not)" })).toBeInTheDocument();
    expect(within(grid).getByRole("gridcell", { name: "Wed P2: available" })).toBeInTheDocument();
    expect(
      within(grid)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Mon", "Tue", "Wed"]);
    expect(
      within(grid)
        .getAllByRole("rowheader")
        .map((header) => header.textContent),
    ).toEqual(["P1", "P2", "P3"]);
  });

  it("names every slot for a viewer exactly as it names it for an editor — the same data", () => {
    const { unmount } = renderDialog(true);
    const editorSlots = namesOf(within(screen.getByRole("dialog")).getAllByRole("button"));
    unmount();

    renderDialog(false);
    const viewerSlots = namesOf(within(screen.getByRole("dialog")).getAllByRole("gridcell"));

    expect(editorSlots).toHaveLength(DAYS * PERIODS);
    expect(viewerSlots).toEqual(editorSlots);
  });

  it("gives a viewer no toggle and nothing to save — only the ways out", () => {
    renderDialog(false);
    const dialog = screen.getByRole("dialog", { name: "Availability — Jane Doe" });

    expect(within(dialog).queryByRole("button", { name: /Cycle the whole/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: SLOT_NAME })).not.toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Done", "Close"]);
  });

  it("never reaches the write path from the read-only dialog, whatever is pressed", () => {
    renderDialog(false);
    const dialog = screen.getByRole("dialog");
    for (const cell of within(dialog).getAllByRole("gridcell")) fireEvent.click(cell);
    for (const button of within(dialog).getAllByRole("button")) fireEvent.click(button);

    expect(setAvailabilityCell).not.toHaveBeenCalled();
    expect(clearAvailabilityCell).not.toHaveBeenCalled();
    expect(setAvailabilityColumn).not.toHaveBeenCalled();
    expect(setAvailabilityRow).not.toHaveBeenCalled();
    expect(refreshPage).not.toHaveBeenCalled();
  });
});
