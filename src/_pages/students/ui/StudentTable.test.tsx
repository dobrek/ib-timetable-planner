import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CourseOption, StudentRow } from "../model/student";
import StudentTable from "./StudentTable";

/**
 * The student table's capability gate (S-405): a non-editor keeps the choices and "View plan", and
 * loses every write — including selection, which exists only to feed the bulk edit. Each absence is
 * pinned beside the editor's presence.
 */
const physics: CourseOption = { id: "physics", cohort: "dp1", label: "Physics (HL)", isMergeParent: false };
const student: StudentRow = { id: "student-1", cohort: "dp1", fullName: "Ada Lovelace", choiceCourseIds: ["physics"] };

const renderTable = (canEdit: boolean, rows: StudentRow[] = [student]) =>
  render(
    <StudentTable
      planId="plan-1"
      rows={rows}
      totalCount={rows.length}
      coursesById={new Map([[physics.id, physics]])}
      canEdit={canEdit}
      selectedIds={new Set()}
      onToggleRow={vi.fn()}
      onToggleAll={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onCreateFirst={vi.fn()}
    />,
  );

const openRowMenu = () => {
  fireEvent.keyDown(screen.getByRole("button", { name: "Student actions" }), { key: "Enter" });
};

describe("StudentTable", () => {
  it("gives an editor the selection checkboxes and View plan plus the two write items", () => {
    renderTable(true);

    expect(screen.getByRole("checkbox", { name: "Select all students" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Ada Lovelace" })).toBeInTheDocument();
    openRowMenu();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["View plan", "Edit", "Delete"]);
  });

  it("gives a viewer the student's choices and only View plan — no selection at all", () => {
    renderTable(false);

    expect(screen.getByText("Physics (HL)")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    openRowMenu();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["View plan"]);
    expect(screen.getByRole("menuitem", { name: "View plan" })).toHaveAttribute(
      "href",
      "/plans/plan-1/students/student-1",
    );
  });

  it("asks an editor to create the first student", () => {
    renderTable(true, []);
    expect(screen.getByText("No students yet — create your first student.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New student" })).toBeInTheDocument();
  });

  it("shows a viewer an empty catalog with no call to create", () => {
    renderTable(false, []);
    expect(screen.getByText("No students yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New student" })).not.toBeInTheDocument();
  });
});
