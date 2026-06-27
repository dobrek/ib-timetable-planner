import { useEffect, useMemo, useState } from "react";
import { buildAvailabilityIndex, type AvailabilityIndex } from "./cross-cohort/availability-index";
import { buildCrossCohortIndex, type CrossCohortIndex } from "./cross-cohort/cross-cohort-index";
import { deriveCellViolations, type CellCollisions } from "./collision/collisions";
import type { CellData, DragData, PlannerBoardProps } from "./drag";
import { deriveDropHints, resolveDragHintContext, type DragHintContext } from "./drop-hints";
import type { GroupingCourse, PlannerGrouping } from "./grouping/grouping";
import { countIncompleteCourses, deriveHours } from "./hours";
import type { LocalPlacement } from "./placement/placement";

/**
 * The pure per-cohort board derivations, lifted out of `PlannerBoard` so BOTH the single-cohort
 * board and the combined view's `useCohortBoardState` compose them from one place (no duplication,
 * no drift). Each is a framework-light memo/state composition of existing model functions — `.ts`,
 * not `.tsx`, since none render JSX. The UI-disclosure/persistence hooks (`useHintMode`,
 * `useShelfDisclosure`, `usePaletteDisclosure`) deliberately stay in the UI layer: the combined
 * shell owns them as single shell-level instances, so a per-cohort hook never needs them.
 */

// Shared course lookup, built once for both the collision and drag-hint derivations.
export function useCatalogById(catalog: GroupingCourse[]) {
  return useMemo(() => new Map(catalog.map((course) => [course.id, course])), [catalog]);
}

// Index the raw availability cells (a serializable prop) into the Maps the derivations read.
export function useAvailabilityIndex(availability: PlannerBoardProps["availability"]) {
  return useMemo(() => buildAvailabilityIndex(availability), [availability]);
}

// Index the raw sibling-occupancy cells (a serializable prop) into the cross-cohort Map.
export function useCrossCohortIndex(occupancy: PlannerBoardProps["crossCohortOccupancy"]) {
  return useMemo(() => buildCrossCohortIndex(occupancy), [occupancy]);
}

export function useCollisions(
  placements: LocalPlacement[],
  catalogById: Map<string, GroupingCourse>,
  availability: AvailabilityIndex,
  occupiedByTeacher: CrossCohortIndex,
) {
  return useMemo(
    () => deriveCellViolations(placements, catalogById, availability, occupiedByTeacher),
    [placements, catalogById, availability, occupiedByTeacher],
  );
}

// Owns the active-drag identity and derives the per-cell hint map from it. Keyed on live
// placements so marks stay correct if an optimistic placement settles or rolls back mid-drag.
// The map is null when no drag is active, so cells render no hint.
export function useDragHints(
  catalogById: Map<string, GroupingCourse>,
  placements: LocalPlacement[],
  groupings: PlannerGrouping[],
  availability: AvailabilityIndex,
  occupiedByTeacher: CrossCohortIndex,
) {
  const [context, setContext] = useState<DragHintContext | null>(null);
  const dropHints = useMemo(
    () => deriveDropHints(context, placements, catalogById, availability, occupiedByTeacher),
    [context, placements, catalogById, availability, occupiedByTeacher],
  );
  return {
    dropHints,
    startDragHints: (data: DragData) => {
      setContext(resolveDragHintContext(data, { catalogById, groupings, placements }));
    },
    clearDragHints: () => {
      setContext(null);
    },
  };
}

export function useHours(placements: LocalPlacement[], catalog: GroupingCourse[]) {
  const hours = useMemo(() => deriveHours(placements, catalog), [placements, catalog]);
  const incompleteCount = useMemo(() => countIncompleteCourses(hours), [hours]);
  return { hours, incompleteCount };
}

// Turns the hook's `lastDuplicated` outcome into a transient, self-clearing highlight the grid
// reads. The highlight is *derived* during render (active unless its nonce has been cleared), so no
// state is set synchronously in the effect; the effect only schedules the clear. `lastDuplicated`
// is a fresh object (bumped nonce) on every duplicate, so a same-cell repeat re-arms the timer and
// re-fires the highlight; the timer is cleared on unmount. The board owns this lifecycle.
const DUPLICATE_HIGHLIGHT_MS = 1200;

export function useDuplicateHighlight(last: (CellData & { nonce: number }) | null) {
  const [clearedNonce, setClearedNonce] = useState<number | null>(null);
  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => {
      setClearedNonce(last.nonce);
    }, DUPLICATE_HIGHLIGHT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [last]);
  return last && last.nonce !== clearedNonce ? last : null;
}

export type { CellCollisions };
