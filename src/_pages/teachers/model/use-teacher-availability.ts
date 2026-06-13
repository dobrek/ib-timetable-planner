import { useEffect, useRef, useState } from "react";
import type { AvailabilitySeverity } from "@/shared/config";
import {
  clearAvailabilityCell,
  setAvailabilityCell,
  setAvailabilityColumn,
  setAvailabilityRow,
} from "../api/teacher-client";
import {
  columnCoords,
  cycleSeverity,
  lineCells,
  reconcileCell,
  reconcileLine,
  rollbackCell,
  rollbackLine,
  rowCoords,
  setCellOptimistic,
  setLineOptimistic,
  severityAt,
  type CellCoord,
  type LocalAvailabilityCell,
} from "./availability";
import type { TeacherAvailabilityCell } from "./teacher";

type UseTeacherAvailabilityArgs = { planId: string; teacherId: string; days: number; periods: number };

export type UseTeacherAvailability = {
  cells: LocalAvailabilityCell[];
  severityAt: (day: number, period: number) => AvailabilitySeverity | null;
  cycleCell: (day: number, period: number) => void;
  setColumn: (day: number, severity: AvailabilitySeverity | null) => void;
  setRow: (period: number, severity: AvailabilitySeverity | null) => void;
  error: string | null;
  clearError: () => void;
};

/**
 * Owns island-local availability state and its optimistic write path — the same shape as
 * `useSlotBundles` (optimistic state + the api client + pure transitions, seeded from the
 * teacher row): `useLatest` ref guard, dispatch optimistically, reconcile on success,
 * roll back to the captured prior state on failure. Failures surface through `error`,
 * rendered as an inline banner in the dialog.
 *
 * `days`/`periods` (the plan grid's dimensions) size the whole-row / whole-column bulk ops.
 */
export function useTeacherAvailability(
  initial: TeacherAvailabilityCell[],
  { planId, teacherId, days, periods }: UseTeacherAvailabilityArgs,
): UseTeacherAvailability {
  const [cells, setCells] = useState<LocalAvailabilityCell[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const cellsRef = useLatest(cells);

  function cycleCell(day: number, period: number) {
    const previous = severityAt(cellsRef.current, day, period);
    const next = cycleSeverity(previous);
    setCells((prev) => setCellOptimistic(prev, day, period, next));
    void persistCell(day, period, next, previous);
  }

  async function persistCell(
    day: number,
    period: number,
    next: AvailabilitySeverity | null,
    previous: AvailabilitySeverity | null,
  ) {
    try {
      const { error: writeError } =
        next === null
          ? await clearAvailabilityCell({ planId, teacherId, day, period })
          : await setAvailabilityCell({ planId, teacherId, day, period, severity: next });
      if (writeError) throw new Error(writeError.message);
      setCells((prev) => reconcileCell(prev, day, period));
    } catch (err: unknown) {
      setCells((prev) => rollbackCell(prev, day, period, previous));
      setError(messageOf(err));
    }
  }

  function setColumn(day: number, severity: AvailabilitySeverity | null) {
    applyLine(columnCoords(day, periods), severity, () =>
      setAvailabilityColumn({ planId, teacherId, day, periods, severity }),
    );
  }

  function setRow(period: number, severity: AvailabilitySeverity | null) {
    applyLine(rowCoords(period, days), severity, () =>
      setAvailabilityRow({ planId, teacherId, period, days, severity }),
    );
  }

  // Shared optimistic write path for a whole line (column or row): capture the prior cells
  // for rollback, apply optimistically, then reconcile or roll back on the action result.
  function applyLine(
    coords: CellCoord[],
    severity: AvailabilitySeverity | null,
    persist: () => Promise<{ error: { message: string } | undefined }>,
  ) {
    const previousLine = lineCells(cellsRef.current, coords);
    setCells((prev) => setLineOptimistic(prev, coords, severity));
    void (async () => {
      try {
        const { error: writeError } = await persist();
        if (writeError) throw new Error(writeError.message);
        setCells((prev) => reconcileLine(prev, coords));
      } catch (err: unknown) {
        setCells((prev) => rollbackLine(prev, coords, previousLine));
        setError(messageOf(err));
      }
    })();
  }

  return {
    cells,
    severityAt: (day, period) => severityAt(cells, day, period),
    cycleCell,
    setColumn,
    setRow,
    error,
    clearError: () => {
      setError(null);
    },
  };
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : "Unexpected error saving availability";
