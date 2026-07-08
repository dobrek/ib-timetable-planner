// Public surface of the chrome feature folder: the board frame components plus the disclosure /
// inspection orchestration hooks both boards wire in.
export { default as BoardHeader } from "./BoardHeader";
export { default as BoardSettingsMenu } from "./BoardSettingsMenu";
export { default as BoardShell } from "./BoardShell";
export { default as CollapsibleEdgePanel, EDGE_PANEL_ICON_BUTTON } from "./CollapsibleEdgePanel";
export { default as CohortSwitcher } from "./CohortSwitcher";
export { default as ExportMenu } from "./ExportMenu";
export { default as PlanSummaryBar } from "./PlanSummaryBar";
export { default as UndoRedoControls, type UndoRedoControlsProps } from "./UndoRedoControls";
export { default as ErrorBanner } from "./ErrorBanner";
export {
  buildCoursesLeftSummary,
  type CoursesLeftCohort,
  type CoursesLeftRow,
  type CoursesLeftSummary,
} from "./courses-left-summary";
export {
  useHintMode,
  usePaletteCohortSelection,
  usePaletteDisclosure,
  useShelfDisclosure,
  useZoom,
} from "./board-disclosure";
export { inspectedViolations, inspectedWeeks, useCollisionInspection } from "./board-inspection";
