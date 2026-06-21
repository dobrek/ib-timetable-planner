import { useEffect, useRef, useState } from "react";
import type { Cohort, PlacementWeek, WeekMode } from "@/shared/config";
import { createPlacement, deletePlacement, updatePlacementWeek } from "../api/placement-client";
import type { CellData } from "./drag";
import {
  addManyOptimistic,
  addOptimistic,
  addReconcile,
  addRollback,
  canAdd,
  eligibleMembers,
  moveIntent,
  moveManyOptimistic,
  moveOptimistic,
  moveReconcile,
  moveRollback,
  occupantPlacementIds,
  oppositeWeekAssignment,
  partitionBundleMove,
  removeManyOptimistic,
  removeOptimistic,
  removeRollback,
  removeTarget,
  resolveDropWeek,
  setWeekOptimistic,
  setWeekReconcile,
  setWeekRollback,
  settleMany,
  type BatchOutcome,
  type PlacementError,
} from "./placement-transitions";
import type { LocalPlacement, PlannerPlacement } from "./placement";

type UsePlacementsArgs = {
  planId: string;
  cohort: Cohort;
  /** courseId → eligibility, so the drop path resolves a bi-weekly course to a concrete week. */
  weekModeByCourseId: Map<string, WeekMode>;
};

type UsePlacements = {
  placements: LocalPlacement[];
  error: PlacementError | null;
  addCourse: (courseId: string, cell: CellData) => void;
  addGroup: (memberIds: string[], cell: CellData, opts?: { oppositeWeek?: boolean }) => void;
  movePlacement: (placementId: string, cell: CellData) => void;
  removePlacement: (placementId: string) => void;
  setWeek: (placementId: string, week: PlacementWeek) => void;
  moveBundle: (day: number, period: number, target: CellData) => void;
  removeBundle: (day: number, period: number) => void;
  clearError: () => void;
};

/**
 * Owns island-local placement state and the optimistic write path. Guards and state
 * transitions live in `placement-transitions.ts`; this hook orchestrates React state
 * and async persistence over those pure functions.
 */
export function usePlacements(
  initial: PlannerPlacement[],
  { planId, cohort, weekModeByCourseId }: UsePlacementsArgs,
): UsePlacements {
  const [placements, setPlacements] = useState<LocalPlacement[]>(initial);
  const [error, setError] = useState<PlacementError | null>(null);
  const placementsRef = useLatest(placements);

  const weekModeOf = (courseId: string): WeekMode => weekModeByCourseId.get(courseId) ?? "agnostic";

  function addCourse(courseId: string, cell: CellData) {
    void persistAdd(courseId, cell);
  }

  function addGroup(memberIds: string[], cell: CellData, opts?: { oppositeWeek?: boolean }) {
    void persistAddGroup(memberIds, cell, opts?.oppositeWeek ?? false);
  }

  function movePlacement(placementId: string, cell: CellData) {
    void persistMove(placementId, cell);
  }

  function removePlacement(placementId: string) {
    void persistRemove(placementId);
  }

  function setWeek(placementId: string, week: PlacementWeek) {
    void persistSetWeek(placementId, week);
  }

  function moveBundle(day: number, period: number, target: CellData) {
    void persistMoveBundle(day, period, target);
  }

  function removeBundle(day: number, period: number) {
    void persistRemoveBundle(day, period);
  }

  async function persistAdd(courseId: string, cell: CellData) {
    if (!canAdd(placementsRef.current, courseId, cell)) return;

    const week = resolveDropWeek(weekModeOf(courseId), placementsRef.current, cell);
    const tempId = crypto.randomUUID();
    setPlacements((prev) => addOptimistic(prev, tempId, courseId, cell, week));

    try {
      const row = await createPlacement({ planId, cohort, courseId, day: cell.day, period: cell.period, week });
      setPlacements((prev) => addReconcile(prev, tempId, row));
    } catch (err: unknown) {
      setPlacements((prev) => addRollback(prev, tempId));
      setError(errorOf(err));
    }
  }

  // Group fan-out (Option A): N parallel idempotent single inserts. Members already
  // in the cell are silently skipped; the optimistic batch and the settlement each
  // land in one state update so collision/hours derivations recompute once.
  async function persistAddGroup(memberIds: string[], cell: CellData, oppositeWeek: boolean) {
    const eligible = eligibleMembers(placementsRef.current, memberIds, cell);
    if (eligible.length === 0) return;

    // Opposite-week grouping → members land on alternating weeks (a/b). Otherwise each member
    // resolves by its own eligibility (agnostic ⇒ both, bi-weekly ⇒ first free week).
    const weekByMember = oppositeWeek ? oppositeWeekAssignment(eligible) : null;
    const weekFor = (courseId: string): PlacementWeek =>
      weekByMember?.get(courseId) ?? resolveDropWeek(weekModeOf(courseId), placementsRef.current, cell);

    const entries = eligible.map((courseId) => ({ tempId: crypto.randomUUID(), courseId, week: weekFor(courseId) }));
    setPlacements((prev) => addManyOptimistic(prev, entries, cell));

    try {
      const outcomes = await Promise.all(entries.map((entry) => persistMember(entry, cell)));
      setPlacements((prev) => settleMany(prev, outcomes));

      const failedCourseIds = outcomes.filter(({ result }) => result === null).map(({ courseId }) => courseId);
      if (failedCourseIds.length > 0) setError({ kind: "groupFailure", failedCourseIds, attempted: outcomes.length });
    } catch (err: unknown) {
      setPlacements((prev) =>
        settleMany(
          prev,
          entries.map(({ tempId }) => ({ tempId, result: null })),
        ),
      );
      setError(errorOf(err));
    }
  }

  async function persistMember(
    { tempId, courseId, week }: { tempId: string; courseId: string; week: PlacementWeek },
    cell: CellData,
  ): Promise<BatchOutcome & { courseId: string }> {
    try {
      const row = await createPlacement({ planId, cohort, courseId, day: cell.day, period: cell.period, week });
      return { tempId, courseId, result: row };
    } catch (err: unknown) {
      // The banner names which members failed; keep the underlying reason traceable.
      // eslint-disable-next-line no-console
      console.error(`[persistAddGroup] insert failed for course ${courseId}: ${messageOf(err)}`);
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
        week: intent.week,
      });
      setPlacements((prev) => moveReconcile(prev, intent.oldId, created));
      try {
        await deletePlacement(intent.oldId);
      } catch (err: unknown) {
        setError({ kind: "message", message: `Move saved but old cell cleanup failed: ${messageOf(err)}` });
      }
    } catch (err: unknown) {
      setPlacements((prev) => moveRollback(prev, intent.oldId, intent.origin));
      setError(errorOf(err));
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
      setError(errorOf(err));
    }
  }

  // Whole-slot move (POST-new for movers, DELETE-old for movers + mergers), applied as a
  // single optimistic setPlacements so the board derives only the initial and final states —
  // never a transient duplicate. The table is never touched; bundled-ness is destination state.
  async function persistMoveBundle(day: number, period: number, target: CellData) {
    if (target.day === day && target.period === period) return; // same-cell no-op
    const ids = occupantPlacementIds(placementsRef.current, { day, period });
    if (ids.length === 0) return;
    const occupants = placementsRef.current.filter((p) => ids.includes(p.id));
    if (occupants.some((p) => p.pending)) return; // batch analogue of moveIntent's pending reject

    const { movers, mergers } = partitionBundleMove(placementsRef.current, ids, target);
    const moverRows = occupants.filter((p) => movers.includes(p.id));

    setPlacements((prev) => moveManyOptimistic(prev, movers, mergers, target));

    const outcomes = await Promise.all(moverRows.map((row) => persistMover(row, target)));
    setPlacements((prev) => settleMany(prev, outcomes));

    // Source empties: delete every original row. Best-effort — cleanup failures are surfaced.
    await Promise.all([...movers, ...mergers].map((id) => deleteOld(id)));

    const failedCourseIds = outcomes.filter(({ result }) => result === null).map(({ courseId }) => courseId);
    if (failedCourseIds.length > 0) setError({ kind: "groupFailure", failedCourseIds, attempted: moverRows.length });
  }

  async function persistMover(row: LocalPlacement, target: CellData): Promise<BatchOutcome & { courseId: string }> {
    try {
      const created = await createPlacement({
        planId,
        cohort,
        courseId: row.courseId,
        day: target.day,
        period: target.period,
        week: row.week,
      });
      return { tempId: row.id, courseId: row.courseId, result: created };
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`[moveBundle] insert failed for course ${row.courseId}: ${messageOf(err)}`);
      return { tempId: row.id, courseId: row.courseId, result: null };
    }
  }

  async function deleteOld(id: string) {
    try {
      await deletePlacement(id);
    } catch (err: unknown) {
      setError({ kind: "message", message: `Move saved but old cell cleanup failed: ${messageOf(err)}` });
    }
  }

  // Whole-slot bulk remove in one optimistic setPlacements; failed deletes are restored so
  // island state stays consistent with the DB, and the failures are surfaced.
  async function persistRemoveBundle(day: number, period: number) {
    const occupants = placementsRef.current.filter((p) => p.day === day && p.period === period);
    if (occupants.length === 0) return;
    if (occupants.some((p) => p.pending)) return; // batch analogue of removeTarget's pending reject

    const ids = occupants.map((p) => p.id);
    setPlacements((prev) => removeManyOptimistic(prev, ids));

    const failed = (await Promise.all(occupants.map((row) => deleteOccupant(row)))).filter(
      (row): row is LocalPlacement => row !== null,
    );
    if (failed.length > 0) {
      setPlacements((prev) => [...prev, ...failed]);
      setError({ kind: "groupFailure", failedCourseIds: failed.map((row) => row.courseId), attempted: ids.length });
    }
  }

  async function deleteOccupant(row: LocalPlacement): Promise<LocalPlacement | null> {
    try {
      await deletePlacement(row.id);
      return null;
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`[removeBundle] delete failed for course ${row.courseId}: ${messageOf(err)}`);
      return row;
    }
  }

  // Flip a placed bi-weekly chip between the A and B lanes. Optimistic: set the new week,
  // persist via updatePlacementWeek, reconcile to the server row; on failure roll back the week.
  async function persistSetWeek(placementId: string, week: PlacementWeek) {
    const row = placementsRef.current.find((p) => p.id === placementId);
    if (!row || row.pending || row.week === week) return;
    const prevWeek = row.week;

    setPlacements((prev) => setWeekOptimistic(prev, placementId, week));

    try {
      const updated = await updatePlacementWeek(placementId, week);
      setPlacements((prev) => setWeekReconcile(prev, placementId, updated));
    } catch (err: unknown) {
      setPlacements((prev) => setWeekRollback(prev, placementId, prevWeek));
      setError(errorOf(err));
    }
  }

  return {
    placements,
    error,
    addCourse,
    addGroup,
    movePlacement,
    removePlacement,
    setWeek,
    moveBundle,
    removeBundle,
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

const errorOf = (err: unknown): PlacementError => ({ kind: "message", message: messageOf(err) });
