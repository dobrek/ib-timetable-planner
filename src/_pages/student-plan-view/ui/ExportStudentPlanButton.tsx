import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import writeXlsxFile from "write-excel-file/browser";
import type { Cohort } from "@/shared/config";
import { Button, Toaster } from "@/shared/ui";
import { buildTimetableSheet, type CourseDisplay, type PlannerPlacement } from "@/entities/timetable";

type Props = {
  fileName: string;
  days: number;
  periods: number;
  cohort: Cohort;
  /** Already student-narrowed by the page (see StudentPlanPage). */
  placements: PlannerPlacement[];
  courseDisplay: Record<string, CourseDisplay>;
};

/**
 * The student plan view's export affordance and the sole site binding `write-excel-file`. On click it
 * turns the already-narrowed placements into a single, tag-free grid sheet via `buildTimetableSheet`
 * (one column, no `cohortTag` — the student is single-cohort, so labels stay clean), names it
 * `"Timetable"`, and saves it through the browser entry. Disabled when the student has no placed
 * courses; a failure surfaces as a toast (the student page mounts no `Toaster`, so this brings its own).
 */
export default function ExportStudentPlanButton({ fileName, days, periods, cohort, placements, courseDisplay }: Props) {
  const [exporting, setExporting] = useState(false);

  async function exportPlan() {
    setExporting(true);
    try {
      const sheet = buildTimetableSheet({ days, periods, columns: [{ cohort, placements, courseDisplay }] });
      await writeXlsxFile([
        {
          data: sheet.rows,
          sheet: "Timetable",
          columns: sheet.columns,
          stickyRowsCount: sheet.stickyRowsCount,
          stickyColumnsCount: sheet.stickyColumnsCount,
        },
      ]).toFile(fileName);
    } catch {
      toast.error("Export failed — try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Toaster />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        title="Export student plan"
        aria-label="Export student plan"
        disabled={exporting || placements.length === 0}
        onClick={() => {
          void exportPlan();
        }}
      >
        <Download />
      </Button>
    </>
  );
}
