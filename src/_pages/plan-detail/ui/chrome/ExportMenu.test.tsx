import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cohort } from "@/shared/config";
import ExportMenu from "./ExportMenu";
import type { ExportCohortData } from "../../lib/export-workbook";

// The library and the toast are the two side-effecting collaborators — capture both.
const { writeXlsxMock, toFileMock, toastErrorMock } = vi.hoisted(() => {
  const toFileMock = vi.fn();
  const writeXlsxMock = vi.fn((_sheets: { sheet: string }[]) => ({ toFile: toFileMock, toBlob: vi.fn() }));
  return { writeXlsxMock, toFileMock, toastErrorMock: vi.fn() };
});
vi.mock("write-excel-file/browser", () => ({ default: writeXlsxMock }));
vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));

// The dropdown primitives are the vendored DS (Radix) — render them inline so this test pins
// ExportMenu's own contract (item order, current marker, select → export) rather than Radix's
// open/close mechanics, which the Phase 3 E2E exercises against the real browser.
vi.mock("@/shared/ui", () => ({
  Button: ({ children, variant, size, ...props }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button {...props}>{children}</button>
  ),
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?: () => void }) => (
    <div role="menuitem" onClick={onSelect}>
      {children}
    </div>
  ),
  Toaster: () => null,
}));

const cohortData = (cohort: Cohort): ExportCohortData => ({
  cohort,
  placements: [],
  courseDisplay: {},
  catalog: [],
  studentNames: {},
});

const renderMenu = (focus: Cohort | "combined") =>
  render(
    <ExportMenu
      planName="IB 2027"
      focus={focus}
      days={5}
      periods={6}
      teacherNames={{}}
      dp1={cohortData("dp1")}
      dp2={cohortData("dp2")}
    />,
  );

beforeEach(() => {
  writeXlsxMock.mockClear();
  toFileMock.mockReset().mockResolvedValue(undefined);
  toastErrorMock.mockReset();
});

describe("ExportMenu", () => {
  it("exposes an accessible Export trigger", () => {
    renderMenu("combined");
    expect(screen.getByRole("button", { name: "Export plan" })).toBeInTheDocument();
  });

  it("lists the active focus first and marks it current", () => {
    renderMenu("dp2");
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "DP2 (current)",
      "Combined",
      "DP1",
    ]);
  });

  it("orders Combined first when it is the active focus", () => {
    renderMenu("combined");
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Combined (current)",
      "DP1",
      "DP2",
    ]);
  });

  it("selecting a view builds the workbook and saves it under the view's filename", async () => {
    renderMenu("combined");
    fireEvent.click(screen.getByRole("menuitem", { name: "DP1" }));

    await waitFor(() => {
      expect(toFileMock).toHaveBeenCalledWith("ib-2027-dp1.xlsx");
    });
    // combined = 1 grid + 2 rosters; dp1 focus = 1 grid + 1 roster
    const sheets = writeXlsxMock.mock.lastCall?.[0] ?? [];
    expect(sheets.map((s) => s.sheet)).toEqual(["DP1", "DP1 subjects"]);
  });

  it("surfaces a failed export as a toast", async () => {
    toFileMock.mockRejectedValueOnce(new Error("boom"));
    renderMenu("combined");
    fireEvent.click(screen.getByRole("menuitem", { name: "Combined (current)" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Export failed — try again.");
    });
  });
});
