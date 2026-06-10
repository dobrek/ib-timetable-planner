import { useEffect, useRef, useState } from "react";
import { createPlacement, deletePlacement } from "@/_pages/plan-detail/api/placement-client";
import type { CellData } from "@/_pages/plan-detail/model/drag";
import {
  addOptimistic,
  addReconcile,
  addRollback,
  canAdd,
  moveIntent,
  moveOptimistic,
  moveReconcile,
  moveRollback,
  removeOptimistic,
  removeRollback,
  removeTarget,
} from "@/_pages/plan-detail/model/placement-transitions";
import type { LocalPlacement, PlannerPlacement } from "@/_pages/plan-detail/model/placement";

type UsePlacementsArgs = { variantId: string; cohortId: string };

type UsePlacements = {
  placements: LocalPlacement[];
  error: string | null;
  addCourse: (courseId: string, cell: CellData) => void;
  movePlacement: (placementId: string, cell: CellData) => void;
  removePlacement: (placementId: string) => void;
  clearError: () => void;
};

/**
 * Owns island-local placement state and the optimistic write path. Guards and state
 * transitions live in `placement-transitions.ts`; this hook orchestrates React state
 * and async persistence over those pure functions.
 */
export function usePlacements(initial: PlannerPlacement[], { variantId, cohortId }: UsePlacementsArgs): UsePlacements {
  const [placements, setPlacements] = useState<LocalPlacement[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const placementsRef = useLatest(placements);

  function addCourse(courseId: string, cell: CellData) {
    void persistAdd(courseId, cell);
  }

  function movePlacement(placementId: string, cell: CellData) {
    void persistMove(placementId, cell);
  }

  function removePlacement(placementId: string) {
    void persistRemove(placementId);
  }

  async function persistAdd(courseId: string, cell: CellData) {
    if (!canAdd(placementsRef.current, courseId, cell)) return;

    const tempId = crypto.randomUUID();
    setPlacements((prev) => addOptimistic(prev, tempId, courseId, cell));

    try {
      const row = await createPlacement({ variantId, cohortId, courseId, day: cell.day, period: cell.period });
      setPlacements((prev) => addReconcile(prev, tempId, row));
    } catch (err: unknown) {
      setPlacements((prev) => addRollback(prev, tempId));
      setError(messageOf(err));
    }
  }

  async function persistMove(placementId: string, cell: CellData) {
    const result = moveIntent(placementsRef.current, placementId, cell);
    if (!result.ok) return;
    const { value: intent } = result;

    setPlacements((prev) => moveOptimistic(prev, intent.oldId, cell));

    try {
      const created = await createPlacement({
        variantId,
        cohortId,
        courseId: intent.courseId,
        day: cell.day,
        period: cell.period,
      });
      setPlacements((prev) => moveReconcile(prev, intent.oldId, created));
      try {
        await deletePlacement(intent.oldId);
      } catch (err: unknown) {
        setError(`Move saved but old cell cleanup failed: ${messageOf(err)}`);
      }
    } catch (err: unknown) {
      setPlacements((prev) => moveRollback(prev, intent.oldId, intent.origin));
      setError(messageOf(err));
    }
  }

  async function persistRemove(placementId: string) {
    const result = removeTarget(placementsRef.current, placementId);
    if (!result.ok) return;
    const { value: row } = result;

    setPlacements((prev) => removeOptimistic(prev, placementId));

    try {
      await deletePlacement(placementId);
    } catch (err: unknown) {
      setPlacements((prev) => removeRollback(prev, row));
      setError(messageOf(err));
    }
  }

  return {
    placements,
    error,
    addCourse,
    movePlacement,
    removePlacement,
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
  err instanceof Error ? err.message : "Unexpected error persisting placement";
