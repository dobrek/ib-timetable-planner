import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createOverlap, deleteOverlap } from "../api/course-client";
import type { CourseRow } from "../model/course";
import CourseOverlaps from "./CourseOverlaps";

vi.mock("../api/course-client", () => ({ createOverlap: vi.fn(), deleteOverlap: vi.fn() }));

/**
 * The overlaps dialog in both of its modes (S-405). The row's overlap badge is the only place a
 * course's overlaps are shown, so a viewer still opens this dialog — and must read the same list an
 * author manages, with nothing on it that writes. Each read-only assertion has an editor twin, so an
 * absence cannot pass on a control that never existed.
 */
const course = (over: Partial<CourseRow>): CourseRow => ({
  id: "course",
  cohort: "dp1",
  name: "Course",
  level: "none",
  groupIndex: 0,
  hours: 4,
  weekMode: "agnostic",
  color: null,
  finishesEarly: false,
  teacherIds: [],
  teacherLabels: [],
  isMerged: false,
  mergeChildIds: [],
  overlaps: [],
  ...over,
});

const maths = course({ id: "maths", name: "Mathematics AA", level: "SL" });
const chemistry = course({ id: "chemistry", name: "Chemistry", level: "HL", groupIndex: 1 });
// Unlinked and same-cohort: the one candidate an author could add.
const biology = course({ id: "biology", name: "Biology", level: "HL" });
const physics = course({ id: "physics", name: "Physics", level: "HL", overlaps: ["maths", "chemistry"] });
const ALL = [maths, chemistry, biology, physics];

const renderDialog = (canEdit: boolean) =>
  render(
    <CourseOverlaps
      planId="plan-1"
      course={physics}
      courses={ALL}
      coursesById={new Map(ALL.map((row) => [row.id, row]))}
      onOverlapsChange={vi.fn()}
      onClose={vi.fn()}
      canEdit={canEdit}
    />,
  );

describe("CourseOverlaps", () => {
  it("gives an editor the list with a remove control per overlap, and the add control", () => {
    renderDialog(true);
    const dialog = screen.getByRole("dialog", { name: "Overlaps — Physics" });

    expect(within(dialog).getByText("Mathematics AA (SL)")).toBeInTheDocument();
    expect(within(dialog).getByText("Chemistry (HL) · Group 1")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Remove overlap with Mathematics AA" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Remove overlap with Chemistry" })).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("gives a viewer the same overlaps, in the same words, and nothing that writes", () => {
    renderDialog(false);
    const dialog = screen.getByRole("dialog", { name: "Overlaps — Physics" });

    expect(within(dialog).getByText("Mathematics AA (SL)")).toBeInTheDocument();
    expect(within(dialog).getByText("Chemistry (HL) · Group 1")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Remove overlap/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    // The dialog's own close control is the only button left.
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Close"]);
  });

  it("never reaches the write path from the read-only dialog, whatever is pressed", () => {
    renderDialog(false);
    for (const button of within(screen.getByRole("dialog")).getAllByRole("button")) fireEvent.click(button);

    expect(createOverlap).not.toHaveBeenCalled();
    expect(deleteOverlap).not.toHaveBeenCalled();
  });
});
