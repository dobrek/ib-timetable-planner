import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import writeXlsxFile from "write-excel-file/browser";
import type { Cohort } from "@/shared/config";
import { Button, Toaster } from "@/shared/ui";
import {
  buildPerspectiveWorkbook,
  type CourseDisplay,
  type PerspectiveCourseItem,
  type PlannerPlacement,
} from "@/entities/timetable";

/** One cohort's export slice — `placements` are already teacher-narrowed by the page (see TeacherPlanPage). */
type ExportCohort = {
  cohort: Cohort;
  placements: PlannerPlacement[];
  courseDisplay: Record<string, CourseDisplay>;
};

type Props = {
  planName: string;
  teacherCode: string;
  days: number;
  periods: number;
  dp1: ExportCohort;
  dp2: ExportCohort;
  courseDisplay: Record<string, CourseDisplay>;
  courseLevels: Record<string, string>;
  items: PerspectiveCourseItem[];
  teacherNames: Record<string, string>;
  studentNames: Record<string, string>;
  viewerTeacherId: string;
};

/**
 * The teacher plan view's export affordance and the sole site binding `write-excel-file`. On click it
 * assembles the workbook from the already-derived page data (`buildPerspectiveWorkbook` — the merged,
 * cohort-tagged grid plus one sheet per course), maps each named sheet to the library's descriptor
 * shape (`rows` → `data`), and saves it via the browser entry. Disabled when the teacher conducts no
 * courses; a failure surfaces as a toast (the teacher page mounts no `Toaster`, so this brings its own).
 */
export default function ExportTeacherPlanButton({
  planName,
  teacherCode,
  days,
  periods,
  dp1,
  dp2,
  courseDisplay,
  courseLevels,
  items,
  teacherNames,
  studentNames,
  viewerTeacherId,
}: Props) {
  const [exporting, setExporting] = useState(false);

  async function exportPlan() {
    setExporting(true);
    try {
      const { sheets, fileName } = buildPerspectiveWorkbook({
        planName,
        fileCode: teacherCode,
        days,
        periods,
        cohorts: [dp1, dp2],
        courseDisplay,
        courseLevels,
        items,
        teacherNames,
        studentNames,
        omitTeacherKey: viewerTeacherId,
      });
      const descriptors = sheets.map(({ name, sheet }) => ({
        data: sheet.rows,
        sheet: name,
        columns: sheet.columns,
        stickyRowsCount: sheet.stickyRowsCount,
        stickyColumnsCount: sheet.stickyColumnsCount,
      }));
      await writeXlsxFile(descriptors).toFile(fileName);
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
        title="Export teacher plan"
        aria-label="Export teacher plan"
        disabled={exporting || items.length === 0}
        onClick={() => {
          void exportPlan();
        }}
      >
        <Download />
      </Button>
    </>
  );
}
