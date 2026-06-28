// Public surface of the grid feature folder (the one parametric board grid). The folded-in slot-cell/
// stays an internal detail consumed only by the grid via deep import.
export { default as PlannerGrid, type PairedColumn, type CellWiring } from "./PlannerGrid";
export { useCellWiring } from "./use-cell-wiring";
