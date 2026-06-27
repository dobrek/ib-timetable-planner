// Public surface of the chrome feature folder: the board frame components plus the disclosure /
// inspection orchestration hooks both boards wire in.
export { default as BoardHeader } from "./BoardHeader";
export { default as CohortSwitcher } from "./CohortSwitcher";
export { default as PlanSummaryBar } from "./PlanSummaryBar";
export { default as DragHintModeToggle } from "./DragHintModeToggle";
export { default as ErrorBanner } from "./ErrorBanner";
export { useHintMode, usePaletteDisclosure, useShelfDisclosure } from "./board-disclosure";
export { inspectedViolations, inspectedWeeks, useCollisionInspection } from "./board-inspection";
