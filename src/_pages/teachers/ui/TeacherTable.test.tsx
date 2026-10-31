import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TeacherRow } from "../model/teacher";
import TeacherTable from "./TeacherTable";

/**
 * The teacher table's capability gate (S-405): a non-editor keeps "View plan" and the availability
 * badge, and loses every write. Each absence is pinned beside the editor's presence.
 */
const teacher: TeacherRow = {
  id: "teacher-1",
  code: "JDO",
  fullName: "Jane Doe",
  assignments: [],
  availability: [{ day: 1, period: 1, severity: "strong" }],
};

const renderTable = (canEdit: boolean, rows: TeacherRow[] = [teacher]) => {
  const handlers = { onEdit: vi.fn(), onDelete: vi.fn(), onOpenAvailability: vi.fn(), onCreateFirst: vi.fn() };
  const { unmount } = render(
    <TeacherTable
      planId="plan-1"
      rows={rows}
      totalCount={rows.length}
      cohortFilter="all"
      canEdit={canEdit}
      {...handlers}
    />,
  );
  return { ...handlers, unmount };
};

const openRowMenu = () => {
  fireEvent.keyDown(screen.getByRole("button", { name: "Teacher actions" }), { key: "Enter" });
};

describe("TeacherTable", () => {
  it("gives an editor View plan and the three write items", () => {
    renderTable(true);
    openRowMenu();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "View plan",
      "Edit",
      "Edit availability",
      "Delete",
    ]);
  });

  it("gives a viewer only View plan, still linking to the teacher's timetable", () => {
    renderTable(false);
    openRowMenu();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["View plan"]);
    expect(screen.getByRole("menuitem", { name: "View plan" })).toHaveAttribute(
      "href",
      "/plans/plan-1/teachers/teacher-1",
    );
  });

  it("keeps the availability badge for a viewer, under a name that does not promise an edit", () => {
    const editor = renderTable(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit availability for Jane Doe (1 constrained cells)" }));
    expect(editor.onOpenAvailability).toHaveBeenCalledWith(teacher);
    editor.unmount();

    const viewer = renderTable(false);
    fireEvent.click(screen.getByRole("button", { name: "View availability for Jane Doe (1 constrained cells)" }));
    expect(viewer.onOpenAvailability).toHaveBeenCalledWith(teacher);
  });

  it("asks an editor to create the first teacher", () => {
    renderTable(true, []);
    expect(screen.getByText("No teachers yet — create your first teacher.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New teacher" })).toBeInTheDocument();
  });

  it("shows a viewer an empty catalog with no call to create", () => {
    renderTable(false, []);
    expect(screen.getByText("No teachers yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New teacher" })).not.toBeInTheDocument();
  });
});
