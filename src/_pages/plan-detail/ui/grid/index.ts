// Public surface of the grid feature folder (the two board grids). The folded-in slot-cell/ stays
// an internal detail consumed only by the grids via deep import.
export { default as PlannerGrid } from "./PlannerGrid";
export { default as PairedPlannerGrid, type PairedColumn } from "./PairedPlannerGrid";
