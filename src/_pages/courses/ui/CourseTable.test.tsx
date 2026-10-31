import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CourseRow } from "../model/course";
import CourseTable from "./CourseTable";

/**
 * The course table's capability gate (S-405): every item in the row menu writes, so a non-editor
 * has no menu at all — but keeps the overlap badge, the only place a course's overlaps are shown.
 * Each absence is pinned beside the editor's presence.
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
const physics = course({ id: "physics", name: "Physics", level: "HL", overlaps: ["maths"] });

const renderTable = (canEdit: boolean) => {
  const onOpenOverlaps = vi.fn();
  const edit = { onEdit: vi.fn(), onManageMerge: vi.fn(), onDelete: vi.fn() };
  const { unmount } = render(
    <CourseTable
      rows={[physics]}
      coursesById={new Map([maths, physics].map((row) => [row.id, row]))}
      onOpenOverlaps={onOpenOverlaps}
      edit={canEdit ? edit : undefined}
    />,
  );
  return { onOpenOverlaps, ...edit, unmount };
};

describe("CourseTable", () => {
  it("gives an editor a row menu of write items", () => {
    renderTable(true);
    fireEvent.keyDown(screen.getByRole("button", { name: "Course actions" }), { key: "Enter" });

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Edit",
      "Manage overlaps",
      "Delete",
    ]);
  });

  it("gives a viewer no row menu, since every item in it writes", () => {
    renderTable(false);

    expect(screen.getByText("Physics")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Course actions" })).not.toBeInTheDocument();
  });

  it("keeps the overlap badge for a viewer, under a name that does not promise an edit", () => {
    const editor = renderTable(true);
    fireEvent.click(screen.getByRole("button", { name: "Manage overlaps for Physics" }));
    expect(editor.onOpenOverlaps).toHaveBeenCalledWith(physics);
    editor.unmount();

    const viewer = renderTable(false);
    const badge = screen.getByRole("button", { name: "View overlaps for Physics" });
    expect(badge).toHaveTextContent("Overlap: Mathematics AA (SL)");
    fireEvent.click(badge);
    expect(viewer.onOpenOverlaps).toHaveBeenCalledWith(physics);
  });
});
