import { Download } from "lucide-react";
import writeXlsxFile from "write-excel-file/browser";
import { toast } from "sonner";
import { cohortLabel } from "@/shared/config";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Toaster } from "@/shared/ui";
import type { BoardSurface } from "../../lib/board-surface";
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
};

/** Canonical view order; the active focus is hoisted to the front at render time. */
const VIEW_ORDER: readonly BoardSurface[] = ["combined", "dp1", "dp2"];

/**
 * The board toolbar's export affordance: a download-icon dropdown offering Combined / DP1 / DP2, the
 * active focus first and marked current. Selecting a view builds the workbook from **live** board
 * state (`buildExportWorkbook` — timetable grid + one subject roster per exported cohort) and saves it
 * via `write-excel-file`'s browser entry. This is the sole site that binds the library; a failed export
 * surfaces as a toast (the board mounts no `Toaster`, so this component brings its own).
 */
export default function ExportMenu({ planName, focus, days, periods, teacherNames, dp1, dp2 }: Props) {
  async function exportView(view: BoardSurface) {
    try {
      const { sheets, fileName } = buildExportWorkbook({ planName, view, days, periods, teacherNames, dp1, dp2 });
      await writeXlsxFile(sheets).toFile(fileName);
    } catch {
      toast.error("Export failed — try again.");
    }
  }

  return (
    <>
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
        </DropdownMenuContent>
      </DropdownMenu>
      <Toaster />
    </>
  );
}

const orderedViews = (focus: BoardSurface): BoardSurface[] => [focus, ...VIEW_ORDER.filter((view) => view !== focus)];

const viewLabel = (view: BoardSurface): string => (view === "combined" ? "Combined" : cohortLabel(view));
