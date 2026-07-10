import { Download } from "lucide-react";
import { zipSync } from "fflate";
import writeXlsxFile from "write-excel-file/browser";
import { toast } from "sonner";
import { cohortLabel } from "@/shared/config";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Toaster,
} from "@/shared/ui";
import type { BoardSurface } from "../../lib/board-surface";
import { buildBatchExportWorkbooks, type BatchExportSources } from "../../lib/batch-export-workbooks";
import { buildExportWorkbook, type ExportCohortData } from "../../lib/export-workbook";

type Props = {
  planName: string;
  /** The active focus — listed first and marked current; also the default single-view export. */
  focus: BoardSurface;
  days: number;
  periods: number;
  teacherNames: Record<string, string>;
  dp1: ExportCohortData;
  dp2: ExportCohortData;
  /** Extra sources (teachers/merges/levels) the "Download all (zip)" batch export needs. */
  batchExport: BatchExportSources;
};

/** Canonical view order; the active focus is hoisted to the front at render time. */
const VIEW_ORDER: readonly BoardSurface[] = ["combined", "dp1", "dp2"];

/**
 * The board toolbar's export affordance: a download-icon dropdown offering Combined / DP1 / DP2 (the
 * active focus first and marked current) plus "Download all (zip)". Selecting a view builds the workbook
 * from **live** board state (`buildExportWorkbook`) and saves it; the batch item builds the combined plan
 * plus one workbook per conducting teacher (`buildBatchExportWorkbooks`), serializes each to a Blob, zips
 * them at compression level 0 (xlsx is already deflated), and downloads one `<plan-slug>.zip`. This is
 * the sole site binding both `write-excel-file` and `fflate`; any failure aborts the whole batch (no
 * partial zip) and surfaces as a toast — success is silent (the board mounts no `Toaster`, so it brings
 * its own).
 */
export default function ExportMenu({ planName, focus, days, periods, teacherNames, dp1, dp2, batchExport }: Props) {
  async function exportView(view: BoardSurface) {
    try {
      const { sheets, fileName } = buildExportWorkbook({ planName, view, days, periods, teacherNames, dp1, dp2 });
      await writeXlsxFile(sheets).toFile(fileName);
    } catch {
      toast.error("Export failed — try again.");
    }
  }

  async function exportAllZip() {
    try {
      const { zipFileName, files } = buildBatchExportWorkbooks({
        planName,
        days,
        periods,
        teacherNames,
        dp1,
        dp2,
        batch: batchExport,
      });
      // Serialize every workbook to bytes first; a throw here aborts the whole batch before any download.
      const entries: Record<string, Uint8Array> = {};
      for (const file of files) {
        const blob = await writeXlsxFile(file.sheets).toBlob();
        entries[file.fileName] = new Uint8Array(await blob.arrayBuffer());
      }
      const zipped = zipSync(entries, { level: 0 });
      downloadBlob(new Blob([zipped], { type: "application/zip" }), zipFileName);
    } catch {
      toast.error("Export failed — try again.");
    }
  }

  return (
    <>
      <Toaster />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            title="Export plan"
            aria-label="Export plan"
          >
            <Download />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {orderedViews(focus).map((view) => (
            <DropdownMenuItem
              key={view}
              onSelect={() => {
                void exportView(view);
              }}
            >
              {viewLabel(view)}
              {view === focus ? " (current)" : ""}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              void exportAllZip();
            }}
          >
            Download all (zip)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

const orderedViews = (focus: BoardSurface): BoardSurface[] => [focus, ...VIEW_ORDER.filter((view) => view !== focus)];

const viewLabel = (view: BoardSurface): string => (view === "combined" ? "Combined" : cohortLabel(view));

/** Trigger a one-shot download of `blob` under `fileName` via a transient object-URL anchor. */
const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  // Defer cleanup so the browser reads the blob before the object URL is revoked —
  // Firefox/Safari cancel the download if it's revoked in the same synchronous tick.
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
};
