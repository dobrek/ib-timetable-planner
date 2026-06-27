// Public surface of the palette feature folder. The four board-facing entries are exported; the
// internal pieces (GroupingBox, GroupingFilter, PaletteCourseChip, HoursCounter) stay unexported —
// their absence documents the folder boundary. Mirrors the model/constraints/ multi-export barrel.
export { default as PlannerPalette } from "./PlannerPalette";
export { default as CombinedPalettePanel, type PaletteCohortData } from "./CombinedPalettePanel";
export { default as ComputeGroupingsEmptyState } from "./ComputeGroupingsEmptyState";
export { default as GroupingStalePanel } from "./GroupingStalePanel";
