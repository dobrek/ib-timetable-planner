import { useEffect, useRef, useState } from "react";
import type { CellData } from "@/components/planner/types";
import type { LocalPlacement, PlannerPlacement } from "@/entities/placement";
import { createPlacement, deletePlacement } from "@/lib/planner/client";

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
 * Owns island-local placement state and the optimistic write path. Every add/move/remove
 * updates state synchronously, then persists, reconciling the temporary client id with the
 * server `id` (and rolling back on failure). Move/remove are gated on `pending` so a DELETE
 * never targets a temporary id. Async handlers read `placementsRef` — never a stale closure
 * snapshot (the known reactive-derivation footgun).
 */
export function usePlacements(initial: PlannerPlacement[], { variantId, cohortId }: UsePlacementsArgs): UsePlacements {
  const [placements, setPlacements] = useState<LocalPlacement[]>(initial);
  const [error, setError] = useState<string | null>(null);

  const placementsRef = useRef(placements);
  useEffect(() => {
    placementsRef.current = placements;
  }, [placements]);

  function addCourse(courseId: string, cell: CellData) {
    // placements_unique: a course sits at most once per cell — dropping a duplicate is a no-op.
    if (occupiesCell(placementsRef.current, courseId, cell)) return;

    const tempId = crypto.randomUUID();
    setPlacements((prev) => [...prev, { id: tempId, courseId, day: cell.day, period: cell.period, pending: true }]);

    createPlacement({ variantId, cohortId, courseId, day: cell.day, period: cell.period })
      .then((row) => {
        setPlacements((prev) => prev.map((p) => (p.id === tempId ? row : p)));
      })
      .catch((err: unknown) => {
        setPlacements((prev) => prev.filter((p) => p.id !== tempId));
        setError(messageOf(err));
      });
  }

  function movePlacement(placementId: string, cell: CellData) {
    const row = placementsRef.current.find((p) => p.id === placementId);
    if (!row || row.pending) return; // gated until the server id reconciles
    if (row.day === cell.day && row.period === cell.period) return; // same cell
    if (occupiesCell(placementsRef.current, row.courseId, cell)) return; // already there

    const oldId = row.id;
    const origin = { day: row.day, period: row.period };
    setPlacements((prev) =>
      prev.map((p) => (p.id === oldId ? { ...p, day: cell.day, period: cell.period, pending: true } : p)),
    );

    // Insert-before-delete: the new cell differs in (day, period) so it can't hit
    // placements_unique; if the POST fails nothing is lost.
    createPlacement({ variantId, cohortId, courseId: row.courseId, day: cell.day, period: cell.period })
      .then((created) => {
        setPlacements((prev) => prev.map((p) => (p.id === oldId ? created : p)));
        // Best-effort cleanup of the old row. A failure leaves a transient duplicate
        // (surfaced on reload), never a lost placement.
        deletePlacement(oldId).catch((err: unknown) => {
          setError(`Move saved but old cell cleanup failed: ${messageOf(err)}`);
        });
      })
      .catch((err: unknown) => {
        setPlacements((prev) =>
          prev.map((p) => (p.id === oldId ? { ...p, day: origin.day, period: origin.period, pending: false } : p)),
        );
        setError(messageOf(err));
      });
  }

  function removePlacement(placementId: string) {
    const row = placementsRef.current.find((p) => p.id === placementId);
    if (!row || row.pending) return; // gated until the server id reconciles

    setPlacements((prev) => prev.filter((p) => p.id !== placementId));
    deletePlacement(placementId).catch((err: unknown) => {
      setPlacements((prev) => [...prev, row]); // rollback
      setError(messageOf(err));
    });
  }

  function clearError() {
    setError(null);
  }

  return { placements, error, addCourse, movePlacement, removePlacement, clearError };
}

const occupiesCell = (placements: LocalPlacement[], courseId: string, cell: CellData): boolean =>
  placements.some((p) => p.courseId === courseId && p.day === cell.day && p.period === cell.period);

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : "Unexpected error persisting placement";
