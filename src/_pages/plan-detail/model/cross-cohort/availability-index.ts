import type { AvailabilitySeverity } from "@/shared/config";
import { cellKey } from "../collision/cell-key";

/**
 * One teacher-availability cell as it arrives on the island (a JSON-serializable board
 * prop — `Map`/`Set` can't cross the server→island boundary). `teacherKey` equals the DB
 * `teacher_id`, matching a member of `GroupingCourse.teacherKeys` (availability is authored
 * per individual teacher, so the index stays single-teacher-keyed; only consumers fan out).
 */
export type BoardAvailabilityCell = {
  teacherKey: string;
  day: number;
  period: number;
  severity: AvailabilitySeverity;
};

/**
 * Membership index the board derivations consume: teacherKey → set of `cellKey` the
 * teacher is unavailable at, split by storage severity. Built once in the island from the
 * raw cells, then handed to `deriveCellViolations` (via `BoardContext`) and `deriveDropHints`.
 */
export type AvailabilityIndex = {
  strongUnavailableByTeacher: Map<string, Set<string>>;
  softUnavailableByTeacher: Map<string, Set<string>>;
};

export const EMPTY_AVAILABILITY_INDEX: AvailabilityIndex = {
  strongUnavailableByTeacher: new Map(),
  softUnavailableByTeacher: new Map(),
};

export const buildAvailabilityIndex = (cells: BoardAvailabilityCell[]): AvailabilityIndex => {
  const strong = new Map<string, Set<string>>();
  const soft = new Map<string, Set<string>>();
  for (const cell of cells) {
    const target = cell.severity === "strong" ? strong : soft;
    addToSet(target, cell.teacherKey, cellKey(cell.day, cell.period));
  }
  return { strongUnavailableByTeacher: strong, softUnavailableByTeacher: soft };
};

const addToSet = (map: Map<string, Set<string>>, key: string, value: string): void => {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
};
