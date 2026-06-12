import { useEffect, useRef, useState } from "react";
import type { Cohort } from "@/shared/config";
import { createPlacement, deletePlacement } from "../api/placement-client";
import type { CellData } from "./drag";
import {
  addManyOptimistic,
  addOptimistic,
  addReconcile,
  addRollback,
  canAdd,
  eligibleMembers,
  groupFailureMessage,
  moveIntent,
  moveOptimistic,
  moveReconcile,
  moveRollback,
  removeOptimistic,
  removeRollback,
  removeTarget,
  settleMany,
  type BatchOutcome,
} from "./placement-transitions";
import type { LocalPlacement, PlannerPlacement } from "./placement";

/** `names` is used only to format persistence-failure messages — identity stays id-based. */
type UsePlacementsArgs = { planId: string; cohort: Cohort; names: Record<string, string> };

type UsePlacements = {
  placements: LocalPlacement[];
  error: string | null;
  addCourse: (courseId: string, cell: CellData) => void;
  addGroup: (memberIds: string[], cell: CellData) => void;
  movePlacement: (placementId: string, cell: CellData) => void;
  removePlacement: (placementId: string) => void;
  clearError: () => void;
};

/**
 * Owns island-local placement state and the optimistic write path. Guards and state
 * transitions live in `placement-transitions.ts`; this hook orchestrates React state
 * and async persistence over those pure functions.
 */
export function usePlacements(
  initial: PlannerPlacement[],
  { planId, cohort, names }: UsePlacementsArgs,
): UsePlacements {
  const [placements, setPlacements] = useState<LocalPlacement[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const placementsRef = useLatest(placements);

  function addCourse(courseId: string, cell: CellData) {
    void persistAdd(courseId, cell);
  }

  function addGroup(memberIds: string[], cell: CellData) {
    void persistAddGroup(memberIds, cell);
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
      const row = await createPlacement({ planId, cohort, courseId, day: cell.day, period: cell.period });
      setPlacements((prev) => addReconcile(prev, tempId, row));
    } catch (err: unknown) {
      setPlacements((prev) => addRollback(prev, tempId));
      setError(messageOf(err));
    }
  }

  // Group fan-out (Option A): N parallel idempotent single inserts. Members already
  // in the cell are silently skipped; the optimistic batch and the settlement each
  // land in one state update so collision/hours derivations recompute once.
  async function persistAddGroup(memberIds: string[], cell: CellData) {
    const eligible = eligibleMembers(placementsRef.current, memberIds, cell);
    if (eligible.length === 0) return;

    const entries = eligible.map((courseId) => ({ tempId: crypto.randomUUID(), courseId }));
    setPlacements((prev) => addManyOptimistic(prev, entries, cell));

    const outcomes = await Promise.all(entries.map((entry) => persistMember(entry, cell)));
    setPlacements((prev) => settleMany(prev, outcomes));

    const failedNames = outcomes
      .filter(({ result }) => result === null)
      .map(({ courseId }) => names[courseId] ?? courseId);
    if (failedNames.length > 0) setError(groupFailureMessage(failedNames, outcomes.length));
  }

  async function persistMember(
    { tempId, courseId }: { tempId: string; courseId: string },
    cell: CellData,
  ): Promise<BatchOutcome & { courseId: string }> {
    try {
      const row = await createPlacement({ planId, cohort, courseId, day: cell.day, period: cell.period });
      return { tempId, courseId, result: row };
    } catch {
      return { tempId, courseId, result: null };
    }
  }

  async function persistMove(placementId: string, cell: CellData) {
    const result = moveIntent(placementsRef.current, placementId, cell);
    if (!result.ok) return;
    const { value: intent } = result;

    setPlacements((prev) => moveOptimistic(prev, intent.oldId, cell));

    try {
      const created = await createPlacement({
        planId,
        cohort,
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
    addGroup,
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
