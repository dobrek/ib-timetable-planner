import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import type { CellData } from "../drag";

/** The small union the write-path `persist*` callers tag each recorded edit with. */
export type EditKind =
  | "add"
  | "addGroup"
  | "move"
  | "moveBundle"
  | "remove"
  | "removeBundle"
  | "setWeek"
  | "lift"
  | "placeBack"
  | "parkMembers"
  | "discard";

/**
 * Turn an edit into a short human label for the undo/redo button tooltip — e.g.
 * `"Remove bundle at Mon · P3"`, `"Place group at Tue · P4"`, `"Park bundle"`. Cell-anchored kinds
 * format their slot via the shared grid labels; the off-board shelf kinds carry no cell.
 */
export function describeEdit(kind: EditKind, cell?: CellData): string {
  const where = cell ? ` at ${cellLabel(cell)}` : "";
  switch (kind) {
    case "add":
      return `Place course${where}`;
    case "addGroup":
      return `Place group${where}`;
    case "move":
      return `Move course${where}`;
    case "moveBundle":
      return `Move bundle${where}`;
    case "remove":
      return `Remove course${where}`;
    case "removeBundle":
      return `Remove bundle${where}`;
    case "setWeek":
      return `Flip week${where}`;
    case "lift":
      return `Lift bundle${where}`;
    case "placeBack":
      return `Place bundle${where}`;
    case "parkMembers":
      return "Park bundle";
    case "discard":
      return "Discard parked bundle";
  }
}

const cellLabel = ({ day, period }: CellData): string => `${dayLabel(day)} · ${periodLabel(period)}`;
