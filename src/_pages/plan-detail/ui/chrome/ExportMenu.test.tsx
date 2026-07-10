import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cohort } from "@/shared/config";
import ExportMenu from "./ExportMenu";
import type { ExportCohortData } from "../../lib/export-workbook";
import type { BatchExportSources } from "../../lib/batch-export-workbooks";

// The library, the zipper, and the toast are the side-effecting collaborators — capture all three,
// plus the object-URL download hooks (absent in jsdom) so the batch item's download can be asserted.
const { writeXlsxMock, toFileMock, toBlobMock, zipSyncMock, toastErrorMock, createObjectURLMock, revokeObjectURLMock } =
  vi.hoisted(() => {
    const toFileMock = vi.fn();
    const toBlobMock = vi.fn();
    const writeXlsxMock = vi.fn((_sheets: { sheet: string }[]) => ({ toFile: toFileMock, toBlob: toBlobMock }));
    return {
      writeXlsxMock,
      toFileMock,
      toBlobMock,
      zipSyncMock: vi.fn(),
      toastErrorMock: vi.fn(),
      createObjectURLMock: vi.fn(),
      revokeObjectURLMock: vi.fn(),
    };
  });
vi.mock("write-excel-file/browser", () => ({ default: writeXlsxMock }));
vi.mock("fflate", () => ({ zipSync: zipSyncMock }));
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
  DropdownMenuSeparator: () => <hr />,
  Toaster: () => null,
}));

const cohortData = (cohort: Cohort, over: Partial<ExportCohortData> = {}): ExportCohortData => ({
  cohort,
  placements: [],
  courseDisplay: {},
  catalog: [],
  studentNames: {},
  hours: new Map(),
  ...over,
});

const emptyBatch: BatchExportSources = { teachers: [], merges: [], courseLevels: {} };

const renderMenu = (
  focus: Cohort | "combined",
  batchExport: BatchExportSources = emptyBatch,
  dp1 = cohortData("dp1"),
) =>
  render(
    <ExportMenu
      planName="IB 2027"
      focus={focus}
      days={5}
      periods={6}
      teacherNames={{ t1: "Teacher One" }}
      dp1={dp1}
      dp2={cohortData("dp2")}
      batchExport={batchExport}
    />,
  );

// A dp1 slice with one course taught by t1, so the batch yields two workbooks (combined + t1).
const dp1WithT1 = (): ExportCohortData =>
  cohortData("dp1", {
    placements: [{ id: "m-1-1", courseId: "m", day: 1, period: 1, week: "both", isOptional: false }],
    courseDisplay: { m: { name: "Math", color: null } },
    catalog: [{ id: "m", teacherKeys: ["t1"], studentKeys: [], hours: 4, weekMode: "agnostic" }],
    hours: new Map([["m", { placed: 1, required: 4 }]]),
  });

const batchWithT1: BatchExportSources = {
  teachers: [{ id: "t1", code: "T1", fullName: null }],
  merges: [],
  courseLevels: { m: "HL" },
};

beforeEach(() => {
  writeXlsxMock.mockClear();
  toFileMock.mockReset().mockResolvedValue(undefined);
  toBlobMock.mockReset().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  zipSyncMock.mockReset().mockReturnValue(new Uint8Array([1, 2, 3]));
  toastErrorMock.mockReset();
  createObjectURLMock.mockReset().mockReturnValue("blob:mock");
  revokeObjectURLMock.mockReset();
  URL.createObjectURL = createObjectURLMock;
  URL.revokeObjectURL = revokeObjectURLMock;
  HTMLAnchorElement.prototype.click = vi.fn();
});

describe("ExportMenu", () => {
  it("exposes an accessible Export trigger", () => {
    renderMenu("combined");
    expect(screen.getByRole("button", { name: "Export plan" })).toBeInTheDocument();
  });

  it("lists the active focus first, marks it current, and ends with the batch item", () => {
    renderMenu("dp2");
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "DP2 (current)",
      "Combined",
      "DP1",
      "Download all (zip)",
    ]);
  });

  it("orders Combined first when it is the active focus, batch item last", () => {
    renderMenu("combined");
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Combined (current)",
      "DP1",
      "DP2",
      "Download all (zip)",
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

  it("surfaces a failed view export as a toast", async () => {
    toFileMock.mockRejectedValueOnce(new Error("boom"));
    renderMenu("combined");
    fireEvent.click(screen.getByRole("menuitem", { name: "Combined (current)" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Export failed — try again.");
    });
  });

  it("Download all (zip): serializes one Blob per workbook, zips at level 0, and triggers one download", async () => {
    renderMenu("combined", batchWithT1, dp1WithT1());
    fireEvent.click(screen.getByRole("menuitem", { name: "Download all (zip)" }));

    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalledTimes(1); // a single download trigger
    });
    expect(toBlobMock).toHaveBeenCalledTimes(2); // combined + the one conducting teacher
    expect(zipSyncMock).toHaveBeenCalledTimes(1);
    const [entries, opts] = (zipSyncMock.mock.lastCall ?? []) as [Record<string, Uint8Array>, { level: number }];
    expect(Object.keys(entries)).toEqual(["ib-2027-combined.xlsx", "ib-2027-t1.xlsx"]);
    expect(opts).toEqual({ level: 0 });
    // Cleanup is deferred (a macrotask past the click) so the browser reads the blob first — assert
    // the object URL is eventually revoked, guarding against a leak regression.
    await waitFor(() => {
      expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
    });
  });

  it("aborts the batch with a toast and no download when a workbook fails to serialize", async () => {
    toBlobMock.mockReset().mockRejectedValueOnce(new Error("boom"));
    renderMenu("combined", batchWithT1, dp1WithT1());
    fireEvent.click(screen.getByRole("menuitem", { name: "Download all (zip)" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Export failed — try again.");
    });
    expect(zipSyncMock).not.toHaveBeenCalled();
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });
});
