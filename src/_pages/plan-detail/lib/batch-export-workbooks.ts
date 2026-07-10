import type { CourseMerge, PlanTeacher } from "@/shared/api";

/**
 * The three extra SSR reads the board loader performs for the batch export, threaded to the island as
 * one prop (deliberately OFF `SharedBoardProps`, which feeds the drag/board hooks and their fixtures).
 * The pure batch assembly (Phase 2) and the `ExportMenu` leaf (Phase 3) both consume it from `lib/`.
 */
export type BatchExportSources = {
  teachers: PlanTeacher[];
  merges: CourseMerge[];
  /** courseId → level (structural), for the per-course perspective sheet headers. */
  courseLevels: Record<string, string>;
};
