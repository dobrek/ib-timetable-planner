import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { placement, type CourseDisplay, type PlannerPlacement } from "@/entities/timetable";
import ExportStudentPlanButton from "./ExportStudentPlanButton";

// The library and the toast are the two side-effecting collaborators — capture both; the pure
// grid transform (`buildTimetableSheet`) runs for real so this pins the button's own wiring.
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

const courseDisplay: Record<string, CourseDisplay> = { math: { name: "Math", color: null } };

const renderButton = (placements: PlannerPlacement[]) =>
  render(
    <ExportStudentPlanButton
      fileName="ib-2027-dp1-jan-kowalski.xlsx"
      days={5}
      periods={6}
      cohort="dp1"
      placements={placements}
      courseDisplay={courseDisplay}
    />,
  );

beforeEach(() => {
  writeXlsxMock.mockClear();
  toFileMock.mockReset().mockResolvedValue(undefined);
  toastErrorMock.mockReset();
});

describe("ExportStudentPlanButton", () => {
  it("exposes an accessible Export trigger", () => {
    renderButton([placement("p1", "math", 1, 1)]);
    expect(screen.getByRole("button", { name: "Export student plan" })).toBeInTheDocument();
  });

  it("is disabled when the student has no placed courses", () => {
    renderButton([]);
    expect(screen.getByRole("button", { name: "Export student plan" })).toBeDisabled();
  });

  it("builds a single Timetable sheet and saves it under the student filename", async () => {
    renderButton([placement("p1", "math", 1, 1)]);
    fireEvent.click(screen.getByRole("button", { name: "Export student plan" }));

    await waitFor(() => {
      expect(toFileMock).toHaveBeenCalledWith("ib-2027-dp1-jan-kowalski.xlsx");
    });
    const sheets = writeXlsxMock.mock.lastCall?.[0] ?? [];
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(["Timetable"]);
  });

  it("surfaces a failed export as a toast", async () => {
    toFileMock.mockRejectedValueOnce(new Error("boom"));
    renderButton([placement("p1", "math", 1, 1)]);
    fireEvent.click(screen.getByRole("button", { name: "Export student plan" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Export failed — try again.");
    });
  });
});
