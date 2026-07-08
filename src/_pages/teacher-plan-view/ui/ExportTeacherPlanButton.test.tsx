import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseDisplay, PerspectiveCourseItem } from "@/entities/timetable";
import ExportTeacherPlanButton from "./ExportTeacherPlanButton";

// The library and the toast are the two side-effecting collaborators — capture both; the pure
// assembler (`buildPerspectiveWorkbook`) runs for real so this pins the button's own wiring.
const { writeXlsxMock, toFileMock, toastErrorMock } = vi.hoisted(() => {
  const toFileMock = vi.fn();
  const writeXlsxMock = vi.fn((_sheets: { sheet: string }[]) => ({ toFile: toFileMock, toBlob: vi.fn() }));
  return { writeXlsxMock, toFileMock, toastErrorMock: vi.fn() };
});
vi.mock("write-excel-file/browser", () => ({ default: writeXlsxMock }));
vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));
vi.mock("@/shared/ui", () => ({
  Button: ({ children, variant, size, ...props }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button {...props}>{children}</button>
  ),
  Toaster: () => null,
}));

const item = (courseId: string): PerspectiveCourseItem => ({
  courseId,
  cohort: "dp1",
  occurrences: [],
  hours: null,
  teacherKeys: [],
  studentKeys: [],
});

const courseDisplay: Record<string, CourseDisplay> = { math: { name: "Math", color: null } };

const renderButton = (items: PerspectiveCourseItem[]) =>
  render(
    <ExportTeacherPlanButton
      planName="IB 2027"
      teacherCode="KK"
      days={5}
      periods={6}
      dp1={{ cohort: "dp1", placements: [], courseDisplay }}
      dp2={{ cohort: "dp2", placements: [], courseDisplay: {} }}
      courseDisplay={courseDisplay}
      courseLevels={{ math: "HL" }}
      items={items}
      teacherNames={{}}
      studentNames={{}}
      viewerTeacherId="self"
    />,
  );

beforeEach(() => {
  writeXlsxMock.mockClear();
  toFileMock.mockReset().mockResolvedValue(undefined);
  toastErrorMock.mockReset();
});

describe("ExportTeacherPlanButton", () => {
  it("exposes an accessible Export trigger", () => {
    renderButton([item("math")]);
    expect(screen.getByRole("button", { name: "Export teacher plan" })).toBeInTheDocument();
  });

  it("is disabled when the teacher conducts no courses", () => {
    renderButton([]);
    expect(screen.getByRole("button", { name: "Export teacher plan" })).toBeDisabled();
  });

  it("builds the workbook (grid + one sheet per course) and saves it under the teacher filename", async () => {
    renderButton([item("math")]);
    fireEvent.click(screen.getByRole("button", { name: "Export teacher plan" }));

    await waitFor(() => {
      expect(toFileMock).toHaveBeenCalledWith("ib-2027-kk.xlsx");
    });
    const sheets = writeXlsxMock.mock.lastCall?.[0] ?? [];
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Timetable", "Math · DP1"]);
  });

  it("surfaces a failed export as a toast", async () => {
    toFileMock.mockRejectedValueOnce(new Error("boom"));
    renderButton([item("math")]);
    fireEvent.click(screen.getByRole("button", { name: "Export teacher plan" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Export failed — try again.");
    });
  });
});
