// Public surface of the chrome feature folder: the board frame components, the disclosure
// orchestration hooks the board wires in, and the pure collision-inspection selectors.
export { default as BoardHeader } from "./BoardHeader";
export { default as BoardSettingsMenu } from "./BoardSettingsMenu";
export { default as BoardShell } from "./BoardShell";
export { default as CollapsibleEdgePanel, EDGE_PANEL_ICON_BUTTON } from "./CollapsibleEdgePanel";
export { default as CohortSwitcher } from "./CohortSwitcher";
export { default as ExportMenu } from "./ExportMenu";
export { default as GenerateButton } from "./GenerateButton";
export { default as GenerationStatusStrip } from "./GenerationStatusStrip";
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
export { inspectedViolations, inspectedWeeks } from "./board-inspection";
